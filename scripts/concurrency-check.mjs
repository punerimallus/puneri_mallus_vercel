// Concurrency check against the real database.
//
//   node scripts/concurrency-check.mjs
//
// Everything the automated suite proves is either against an in-memory fake or against an
// in-process Postgres running one statement at a time. This is the only test that fires genuinely
// parallel requests at a real Postgres and so is the only one that can catch a deadlock, a lock
// held too long, or a race the single-threaded tests cannot express.
//
// It is safe to run against production:
//   * it creates its own categories under a made-up event id that no real event uses,
//   * it never touches a real category, booking, order or payment,
//   * it deletes everything it created, and reports whether the cleanup succeeded.
//
// It does write to the database, which is why it is a script you run rather than part of
// `npm test`. Run it before a big on-sale, and after any change to the reservation SQL.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const EVENT = 'zzz_conc_' + Date.now();
const PREFIX = 'ZC' + String(Date.now()).slice(-5);
let pass = 0;
let fail = 0;
const made = new Set();
let catA = null;
let catB = null;
let user = null;
let pointsBefore = null;

const ok = (m, d) => { pass++; console.log('  PASS  ' + m + (d ? ' - ' + d : '')); };
const bad = (m, d) => { fail++; console.log('  FAIL  ' + m + (d ? ' - ' + d : '')); };
const hdr = (t) => console.log('\n' + t + '\n' + '-'.repeat(t.length));
const msg = (r) => (r.error ? String(r.error.message || '') : '');

const reserve = (id, uid, items, points = 0, maxSingle = 7) => db.rpc('reserve_order_inventory', {
  p_reservation_id: id, p_user_id: uid || null, p_items: items,
  p_points: points, p_ttl_seconds: 900, p_max_single: maxSingle, p_max_group: 2,
});

try {
  const mk = async (name, prefix, capacity) => (await db.from('event_ticket_categories')
    .insert({ event_id: EVENT, name, prefix, price: 1, capacity, group_size: 1, active: true })
    .select('id').single()).data.id;
  catA = await mk('CONC A', PREFIX + 'A-', 10);
  catB = await mk('CONC B', PREFIX + 'B-', 10);
  // The points test needs a real account, because the balance lives on `profiles` and that
  // table is tied to real auth users — there is no throwaway profile to make. So borrow one
  // that currently has NOTHING to lose: zero balance, zero held. Then even if this process is
  // killed before the restore in `finally`, the worst case is a named account left holding test
  // points, not somebody's real balance overwritten.
  const { data: candidates } = await db.from('profiles')
    .select('id, email, loyalty_points, loyalty_points_held')
    .eq('loyalty_points', 0)
    .eq('loyalty_points_held', 0)
    .limit(1);
  const who = candidates?.[0];
  if (!who) {
    bad('no spare account', 'every profile holds points; skipping the points test rather than touching a real balance');
  } else {
    user = who.id;
    pointsBefore = { loyalty_points: 0, loyalty_points_held: 0 };
  }
  ok('created two disposable categories', 'capacity 10 each, on a made-up event id');
  if (who) ok('borrowed an empty account for the points test', who.email + ' (0 points, restored at the end)');

  hdr('1. Forty buyers hit ten seats at the same instant');
  const t0 = Date.now();
  const r1 = await Promise.all(Array.from({ length: 40 }, (_, i) => reserve('c_a_' + i, null, [{ categoryId: catA, qty: 1 }])));
  r1.forEach((r, i) => { if (!r.error) made.add('c_a_' + i); });
  const won = r1.filter((r) => !r.error).length;
  const lost = r1.filter((r) => r.error);
  console.log('   ' + won + ' succeeded, ' + lost.length + ' refused, in ' + (Date.now() - t0) + 'ms');
  won === 10 ? ok('exactly 10 sold, never 11') : bad('OVERSOLD / UNDERSOLD', won + ' succeeded');
  const notSoldOut = lost.filter((r) => !/SOLD_OUT/.test(msg(r)));
  notSoldOut.length === 0 ? ok('every refusal was a clean SOLD_OUT') : bad('unexpected errors', notSoldOut.slice(0, 2).map(msg).join(' | '));
  lost.filter((r) => /deadlock/i.test(msg(r))).length === 0 ? ok('no deadlocks') : bad('DEADLOCKS DETECTED');
  const numsA = (await db.from('ticket_numbers').select('number').eq('category_id', catA)).data.map((n) => n.number);
  (new Set(numsA).size === 10 && Math.min(...numsA) === 1 && Math.max(...numsA) === 10)
    ? ok('numbers are exactly 1..10, no duplicates, no gaps')
    : bad('number allocation wrong', JSON.stringify(numsA.sort((a, b) => a - b)));
  const soldA = (await db.from('event_ticket_categories').select('sold').eq('id', catA).single()).data.sold;
  soldA === 10 ? ok('`sold` matches the rows exactly', 'no counter drift') : bad('counter drift', 'sold=' + soldA);

  hdr('2. One account opens twenty-five tabs at once (cap is 7)');
  const r2 = await Promise.all(Array.from({ length: 25 }, (_, i) => reserve('c_b_' + i, user, [{ categoryId: catB, qty: 1 }])));
  r2.forEach((r, i) => { if (!r.error) made.add('c_b_' + i); });
  const w2 = r2.filter((r) => !r.error).length;
  w2 === 7 ? ok('exactly 7 allowed through') : bad('per-account cap broke under concurrency', w2 + ' got through');
  const lim = r2.filter((r) => /LIMIT_SINGLE/.test(msg(r))).length;
  lim > 0 ? ok('the rest were refused on the account cap', lim + ' refused') : bad('no LIMIT_SINGLE refusals seen');
  r2.filter((r) => /deadlock/i.test(msg(r))).length === 0 ? ok('no deadlocks on the profile lock') : bad('DEADLOCK on the profile lock');

  hdr('3. Deadlock stress: thirty opposing two-category carts at once');
  await db.from('event_ticket_categories').update({ capacity: 500 }).eq('id', catA);
  await db.from('event_ticket_categories').update({ capacity: 500 }).eq('id', catB);
  const r3 = await Promise.all(Array.from({ length: 30 }, (_, i) => reserve('c_c_' + i, null,
    i % 2 === 0
      ? [{ categoryId: catA, qty: 1 }, { categoryId: catB, qty: 1 }]
      : [{ categoryId: catB, qty: 1 }, { categoryId: catA, qty: 1 }])));
  r3.forEach((r, i) => { if (!r.error) made.add('c_c_' + i); });
  const dl = r3.filter((r) => /deadlock/i.test(msg(r)));
  dl.length === 0 ? ok('zero deadlocks', 'the id-ordered category locking holds') : bad('DEADLOCK', msg(dl[0]).slice(0, 90));
  const weird = r3.filter((r) => r.error && !/deadlock|SOLD_OUT/i.test(msg(r)));
  weird.length === 0 ? ok('no unexpected errors') : bad('unexpected', msg(weird[0]).slice(0, 90));
  console.log('   ' + r3.filter((r) => !r.error).length + '/30 reserved across both categories');

  hdr('4. One payment confirmed from five directions at once');
  const target = r3.findIndex((r) => !r.error) >= 0 ? 'c_c_' + r3.findIndex((r) => !r.error) : null;
  if (!target) {
    bad('nothing to confirm', 'step 3 reserved nothing');
  } else {
    const r4 = await Promise.all(Array.from({ length: 5 }, () => db.rpc('confirm_order_inventory', { p_reservation_id: target })));
    const firsts = r4.filter((r) => !r.error && r.data?.alreadyConfirmed === false).length;
    const repeats = r4.filter((r) => !r.error && r.data?.alreadyConfirmed === true).length;
    (firsts === 1 && repeats === 4)
      ? ok('exactly one confirmed it, four were no-ops', 'browser + webhook + status poll + reconcile')
      : bad('confirm is unsafe under concurrency', 'first=' + firsts + ' repeat=' + repeats);

    hdr('5. One refund released from five directions at once');
    const r5 = await Promise.all(Array.from({ length: 5 }, () => db.rpc('release_order_inventory', { p_reservation_id: target })));
    const freed = r5.filter((r) => !r.error).map((r) => r.data || 0);
    const total = freed.reduce((a, b) => a + b, 0);
    total === 2 ? ok('seats freed exactly once', total + ' seats; the other four returned 0') : bad('released more than once', JSON.stringify(freed));
  }

  hdr('6. Loyalty points: one balance, twenty simultaneous checkouts');
  if (!user) {
    console.log('   skipped — no empty account was free to borrow');
    throw new Error('SKIP_POINTS');
  }
  await db.from('profiles').update({ loyalty_points: 500, loyalty_points_held: 0 }).eq('id', user);
  const r6 = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve('c_d_' + i, user, [{ categoryId: catA, qty: 1 }], 500, 1000)));
  r6.forEach((r, i) => { if (!r.error) made.add('c_d_' + i); });
  const w6 = r6.filter((r) => !r.error).length;
  w6 === 1 ? ok('exactly one checkout got the points') : bad('POINTS DOUBLE-SPEND', w6 + ' succeeded');
  const prof = (await db.from('profiles').select('loyalty_points, loyalty_points_held').eq('id', user).single()).data;
  (prof.loyalty_points === 500 && prof.loyalty_points_held === 500)
    ? ok('500 held, nothing spent until the payment confirms') : bad('points accounting wrong', JSON.stringify(prof));
} catch (e) {
  // A deliberate skip is not a failure.
  if (String(e?.message) !== 'SKIP_POINTS') bad('aborted', String(e?.message || e));
} finally {
  hdr('Cleanup');
  for (const id of made) await db.from('inventory_reservations').delete().eq('reservation_id', id);
  if (user && pointsBefore) await db.from('profiles').update(pointsBefore).eq('id', user);
  if (catA) await db.from('event_ticket_categories').delete().eq('id', catA);
  if (catB) await db.from('event_ticket_categories').delete().eq('id', catB);
  const left = (await db.from('event_ticket_categories').select('id', { count: 'exact', head: true }).eq('event_id', EVENT)).count;
  left === 0 ? ok('test categories removed') : bad('categories left behind', String(left));

  if (user) {
    const after = (await db.from('profiles').select('loyalty_points, loyalty_points_held').eq('id', user).single()).data;
    (after?.loyalty_points === 0 && after?.loyalty_points_held === 0)
      ? ok('borrowed account put back to zero')
      : bad('BORROWED ACCOUNT NOT RESTORED', 'set loyalty_points and loyalty_points_held to 0 for profile ' + user);
  }
  console.log('\n' + '='.repeat(60) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(60) + '\n');
  process.exit(fail ? 1 : 0);
}
