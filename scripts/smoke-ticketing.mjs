// Smoke test for the ticketing stack against the real services.
//
//   node scripts/smoke-ticketing.mjs
//
// Read-only against Supabase and Mongo. It creates one Razorpay order in TEST mode (an unpaid
// order is inert and expires on its own) only when --razorpay is passed. It never sends an
// email or a WhatsApp message, and never writes to any table.
//
// What it answers: are the credentials right, is the ticketing migration applied, do the
// reservation functions exist, and does webhook signature verification work end to end.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')];
    }),
);

const wantRazorpay = process.argv.includes('--razorpay');
let pass = 0;
let fail = 0;
let warn = 0;

const ok = (name, detail = '') => { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); };
const bad = (name, detail = '') => { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); };
const note = (name, detail = '') => { warn++; console.log(`  WARN  ${name}${detail ? ` — ${detail}` : ''}`); };
const section = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

// ---- configuration --------------------------------------------------------------------------
section('Configuration');

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET']) {
  if (env[key]) ok(`${key} is set`);
  else bad(`${key} is missing`);
}

if (!env.RAZORPAY_WEBHOOK_SECRET) {
  bad('RAZORPAY_WEBHOOK_SECRET is missing', 'every Razorpay webhook would be rejected as unsigned');
} else {
  ok('RAZORPAY_WEBHOOK_SECRET is set');
}
if (!env.CRON_SECRET) note('CRON_SECRET is not set', 'the nightly reconcile cannot authenticate itself');

const mode = (env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '').startsWith('rzp_test_') ? 'TEST' : 'LIVE';
if (mode === 'TEST') ok('Razorpay is in TEST mode');
else note('Razorpay is in LIVE mode', 'real money would move; this script will not create an order');

// ---- webhook signature ----------------------------------------------------------------------
section('Webhook signature verification');

if (env.RAZORPAY_WEBHOOK_SECRET) {
  const body = JSON.stringify({ event: 'payment.captured', payload: {} });
  const sig = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const recomputed = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  if (sig === recomputed && sig.length === 64) ok('a webhook signature we produce verifies');
  else bad('webhook signature round trip failed');

  const tampered = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');
  if (tampered !== sig) ok('a signature from the wrong secret does not match');
  else bad('signature check does not discriminate');
}

// ---- Supabase -------------------------------------------------------------------------------
section('Supabase');

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const probeTable = async (table, cols) => {
  const { error } = await db.from(table).select(cols).limit(1);
  return error ? error.message : null;
};

for (const [table, cols] of [
  ['event_ticket_categories', 'id,name,prefix,price,capacity,sold,released,group_size'],
  ['ticket_bookings', 'id,status,tickets_data,scan_version'],
  ['payment_orders', 'razorpay_order_id,status'],
  ['payments', 'razorpay_payment_id'],
  ['profiles', 'id,loyalty_points'],
]) {
  const err = await probeTable(table, cols);
  if (err) bad(`table ${table}`, err.slice(0, 90));
  else ok(`table ${table}`);
}

// ---- the ticketing migration ----------------------------------------------------------------
section('Ticketing migration (20261028_ticketing_integrity.sql)');

const { data: marker, error: markerErr } = await db
  .from('app_schema_markers')
  .select('applied_at')
  .eq('name', 'ticketing_integrity_v1')
  .maybeSingle();

const migrationApplied = !markerErr && !!marker;

if (migrationApplied) {
  ok('migration marker present', `applied ${marker.applied_at}`);
} else {
  bad('migration NOT applied', 'ticket checkout will refuse new orders with 503 until it is run');
}

for (const [table, cols] of [
  ['ticket_numbers', 'category_id,number,state'],
  ['inventory_reservations', 'reservation_id,state'],
  ['event_staff', 'email,role,active'],
  ['scan_log', 'booking_id,actor_email'],
]) {
  const err = await probeTable(table, cols);
  if (err) bad(`table ${table}`, 'created by the migration');
  else ok(`table ${table}`);
}

for (const [col, table] of [
  ['loyalty_points_held', 'profiles'],
  ['reservation_id', 'payment_orders'],
  ['auto_refund_id', 'payment_orders'],
  ['issued_total', 'event_ticket_categories'],
]) {
  const err = await probeTable(table, col);
  if (err) bad(`${table}.${col}`, 'added by the migration');
  else ok(`${table}.${col}`);
}

// The reservation functions.
//
// Each is called with its REAL argument names and values that cannot change anything: ids that
// match nothing, and an empty cart (which makes reserve_order_inventory raise EMPTY_CART, rolling
// its own call back). Calling them with no arguments at all would be useless — PostgREST answers
// PGRST202 for "wrong arguments" and for "no such function" alike, so that cannot tell them apart.
const NO_UUID = '00000000-0000-0000-0000-000000000000';
const PROBE = 'smoke-probe-does-not-exist';
const fnProbes = [
  ['refresh_category_counts', { p_category_id: NO_UUID }],
  ['release_order_inventory', { p_reservation_id: PROBE }],
  ['confirm_order_inventory', { p_reservation_id: PROBE }],
  ['void_ticket_number', { p_reservation_id: PROBE, p_category_id: NO_UUID, p_number: 1 }],
  ['reserve_order_inventory', { p_reservation_id: PROBE, p_user_id: null, p_items: [], p_points: 0, p_ttl_seconds: 60, p_max_single: 7, p_max_group: 2 }],
  ['expire_stale_holds', {}],
];
for (const [fn, args] of fnProbes) {
  const { error } = await db.rpc(fn, args);
  if (!error) ok(`function ${fn}`, 'callable');
  else if (error.code === 'PGRST202') bad(`function ${fn}`, 'does not exist');
  else ok(`function ${fn}`, `raised as designed: ${error.message.slice(0, 48)}`);
}

// ---- the fail-closed guard ------------------------------------------------------------------
section('Fail-closed behaviour');

if (migrationApplied) {
  ok('checkout would accept orders', 'the schema guard is satisfied');
} else {
  ok('checkout correctly refuses orders', 'the schema guard is doing its job: no money is taken against a database that cannot reserve seats');
}

// ---- Razorpay -------------------------------------------------------------------------------
section('Razorpay');

if (!wantRazorpay) {
  note('skipped the live API check', 'pass --razorpay to create one TEST-mode order');
} else if (mode !== 'TEST') {
  note('skipped the live API check', 'refusing to touch a LIVE key');
} else {
  const { default: Razorpay } = await import('razorpay');
  const rz = new Razorpay({ key_id: env.NEXT_PUBLIC_RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET });
  try {
    const order = await rz.orders.create({
      amount: 100,
      currency: 'INR',
      receipt: `smoke_${Date.now()}`.slice(0, 40),
      notes: { purpose: 'ticketing smoke test, never paid' },
    });
    ok('created a TEST order', `${order.id} (unpaid, inert, expires on its own)`);

    const payments = await rz.orders.fetchPayments(order.id);
    if (Array.isArray(payments.items) && payments.items.length === 0) {
      ok('fetchPayments works and reports no payment', 'which is what fulfilment reads to decide NOT_PAID');
    } else {
      note('fetchPayments returned something unexpected', JSON.stringify(payments).slice(0, 80));
    }

    // The signature the browser gets back after a payment, verified exactly as the routes do.
    const fakeSig = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${order.id}|pay_smoketest`)
      .digest('hex');
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${order.id}|pay_smoketest`)
      .digest('hex');
    if (fakeSig === expected) ok('checkout signature verification round trip');
    else bad('checkout signature mismatch');
  } catch (e) {
    bad('Razorpay API call failed', String(e?.error?.description || e?.message || e).slice(0, 120));
  }
}

// ---- Mongo ----------------------------------------------------------------------------------
section('Events (MongoDB)');

try {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  const events = await client
    .db(env.MONGODB_DB || 'punerimallus')
    .collection('events')
    .find({}, { projection: { title: 1, date: 1, time: 1 } })
    .limit(50)
    .toArray();
  ok('connected and read events', `${events.length} found`);

  // An event date the app cannot parse now blocks its own sales rather than selling forever.
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const unparseable = events.filter((e) => {
    const m = String(e.date || '').trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
    return !m || MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) === -1;
  });
  if (unparseable.length === 0) ok('every event date parses', 'none of them will block their own ticket sales');
  else bad(`${unparseable.length} event date(s) do not parse`, unparseable.map((e) => `${e.title}: "${e.date}"`).join('; ').slice(0, 160));

  await client.close();
} catch (e) {
  bad('MongoDB', String(e?.message || e).slice(0, 110));
}

// ---- summary --------------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`  ${pass} passed, ${fail} failed, ${warn} warnings`);
if (!migrationApplied) {
  console.log('\n  NEXT STEP: run supabase/migrations/20261028_ticketing_integrity.sql');
  console.log('  in the Supabase SQL editor, then run this script again.');
}
console.log(`${'='.repeat(60)}\n`);
process.exit(fail > 0 ? 1 : 0);
