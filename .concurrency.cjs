// Throwaway: true concurrency against the real production Postgres over HTTP.
// Creates disposable categories on a fake event id, hammers them, then deletes everything.
(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const fs = require('node:fs');
  const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
      .filter((l) => /^[A-Z_0-9]+=/.test(l))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const EVENT = 'zzz_conc_' + Date.now();
  const P = 'ZC' + String(Date.now()).slice(-5);
  let pass = 0, fail = 0;
  const made = new Set();
  let catA = null, catB = null, user = null;
  const ok = (m, d) => { pass++; console.log('  PASS  ' + m + (d ? ' - ' + d : '')); };
  const bad = (m, d) => { fail++; console.log('  FAIL  ' + m + (d ? ' - ' + d : '')); };
  const hdr = (t) => console.log('\n' + t + '\n' + '-'.repeat(t.length));
  const msg = (r) => (r.error ? String(r.error.message || '') : '');

  const reserve = (id, uid, items, points, maxSingle) => db.rpc('reserve_order_inventory', {
    p_reservation_id: id, p_user_id: uid || null, p_items: items,
    p_points: points || 0, p_ttl_seconds: 900, p_max_single: maxSingle || 7, p_max_group: 2,
  });

  try {
    const mk = async (name, prefix, capacity) => (await db.from('event_ticket_categories')
      .insert({ event_id: EVENT, name, prefix, price: 1, capacity, group_size: 1, active: true })
      .select('id').single()).data.id;
    catA = await mk('CONC A', P + 'A-', 10);
    catB = await mk('CONC B', P + 'B-', 10);
    user = (await db.from('profiles').select('id').limit(1).single()).data.id;
    ok('set up two disposable categories', 'capacity 10 each, fake event id');

    // 1 -------------------------------------------------------------------------------
    hdr('1. Forty buyers hit ten seats at the same instant');
    const t0 = Date.now();
    const r1 = await Promise.all(Array.from({ length: 40 }, (_, i) => reserve('c_a_' + i, null, [{ categoryId: catA, qty: 1 }])));
    r1.forEach((r, i) => { if (!r.error) made.add('c_a_' + i); });
    const won = r1.filter((r) => !r.error).length;
    const lost = r1.filter((r) => r.error);
    console.log('   ' + won + ' succeeded, ' + lost.length + ' refused, in ' + (Date.now() - t0) + 'ms');
    won === 10 ? ok('exactly 10 sold, never 11') : bad('OVERSOLD/UNDERSOLD', won + ' succeeded');
    const notSoldOut = lost.filter((r) => !/SOLD_OUT/.test(msg(r)));
    notSoldOut.length === 0 ? ok('every refusal was a clean SOLD_OUT') : bad('unexpected errors', notSoldOut.slice(0, 2).map(msg).join(' | '));
    lost.filter((r) => /deadlock/i.test(msg(r))).length === 0 ? ok('no deadlocks') : bad('DEADLOCKS');
    const numsA = (await db.from('ticket_numbers').select('number').eq('category_id', catA)).data.map((n) => n.number);
    const uniq = new Set(numsA);
    (uniq.size === 10 && Math.max.apply(null, numsA) === 10 && Math.min.apply(null, numsA) === 1)
      ? ok('numbers are exactly 1..10, no duplicates, no gaps')
      : bad('number allocation wrong', JSON.stringify(numsA.sort((a, b) => a - b)));
    const soldA = (await db.from('event_ticket_categories').select('sold').eq('id', catA).single()).data.sold;
    soldA === 10 ? ok('`sold` matches the rows exactly', 'no counter drift') : bad('counter drift', 'sold=' + soldA + ' rows=' + uniq.size);

    // 2 -------------------------------------------------------------------------------
    hdr('2. One account opens twenty-five tabs at once (cap is 7)');
    const r2 = await Promise.all(Array.from({ length: 25 }, (_, i) => reserve('c_b_' + i, user, [{ categoryId: catB, qty: 1 }])));
    r2.forEach((r, i) => { if (!r.error) made.add('c_b_' + i); });
    const w2 = r2.filter((r) => !r.error).length;
    w2 === 7 ? ok('exactly 7 allowed through') : bad('per-account cap broke under concurrency', w2 + ' got through');
    const lim = r2.filter((r) => /LIMIT_SINGLE/.test(msg(r))).length;
    lim > 0 ? ok('the rest were refused on the account cap', lim + ' refused') : bad('no LIMIT_SINGLE refusals');
    r2.filter((r) => /deadlock/i.test(msg(r))).length === 0 ? ok('no deadlocks on the profile lock') : bad('DEADLOCK on profile lock');

    // 3 -------------------------------------------------------------------------------
    hdr('3. Deadlock stress: thirty opposing two-category carts at once');
    await db.from('event_ticket_categories').update({ capacity: 500 }).eq('id', catA);
    await db.from('event_ticket_categories').update({ capacity: 500 }).eq('id', catB);
    const r3 = await Promise.all(Array.from({ length: 30 }, (_, i) => {
      const items = i % 2 === 0
        ? [{ categoryId: catA, qty: 1 }, { categoryId: catB, qty: 1 }]
        : [{ categoryId: catB, qty: 1 }, { categoryId: catA, qty: 1 }];
      return reserve('c_c_' + i, null, items);
    }));
    r3.forEach((r, i) => { if (!r.error) made.add('c_c_' + i); });
    const dl = r3.filter((r) => /deadlock/i.test(msg(r)));
    dl.length === 0 ? ok('zero deadlocks', 'the id-ordered locking holds') : bad('DEADLOCK', msg(dl[0]).slice(0, 90));
    const weird = r3.filter((r) => r.error && !/deadlock|SOLD_OUT/i.test(msg(r)));
    weird.length === 0 ? ok('no unexpected errors') : bad('unexpected', msg(weird[0]).slice(0, 90));
    console.log('   ' + r3.filter((r) => !r.error).length + '/30 reserved across both categories');

    // 4 -------------------------------------------------------------------------------
    hdr('4. One payment confirmed from five directions at once');
    const target = 'c_c_0';
    const r4 = await Promise.all(Array.from({ length: 5 }, () => db.rpc('confirm_order_inventory', { p_reservation_id: target })));
    const firsts = r4.filter((r) => !r.error && r.data && r.data.alreadyConfirmed === false).length;
    const repeats = r4.filter((r) => !r.error && r.data && r.data.alreadyConfirmed === true).length;
    (firsts === 1 && repeats === 4)
      ? ok('exactly one confirmed, four were no-ops', 'browser + webhook + poll + reconcile')
      : bad('confirm unsafe under concurrency', 'first=' + firsts + ' repeat=' + repeats + ' err=' + r4.filter((r) => r.error).length);

    // 5 -------------------------------------------------------------------------------
    hdr('5. One refund released from five directions at once');
    const r5 = await Promise.all(Array.from({ length: 5 }, () => db.rpc('release_order_inventory', { p_reservation_id: target })));
    const freed = r5.filter((r) => !r.error).map((r) => r.data || 0);
    const total = freed.reduce((a, b) => a + b, 0);
    total === 2 ? ok('seats freed exactly once', total + ' seats; the other four returned 0') : bad('released more than once', JSON.stringify(freed));

    // 6 -------------------------------------------------------------------------------
    hdr('6. Loyalty points: one balance, twenty simultaneous checkouts');
    await db.from('profiles').update({ loyalty_points: 500, loyalty_points_held: 0 }).eq('id', user);
    const r6 = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve('c_d_' + i, user, [{ categoryId: catA, qty: 1 }], 500, 1000)));
    r6.forEach((r, i) => { if (!r.error) made.add('c_d_' + i); });
    const w6 = r6.filter((r) => !r.error).length;
    w6 === 1 ? ok('exactly one checkout got the points') : bad('POINTS DOUBLE-SPEND', w6 + ' succeeded');
    const prof = (await db.from('profiles').select('loyalty_points, loyalty_points_held').eq('id', user).single()).data;
    (prof.loyalty_points === 500 && prof.loyalty_points_held === 500)
      ? ok('500 held, 0 spent until payment confirms') : bad('points accounting wrong', JSON.stringify(prof));
  } catch (e) {
    bad('aborted', String((e && e.message) || e));
  } finally {
    hdr('Cleanup');
    for (const id of made) await db.from('inventory_reservations').delete().eq('reservation_id', id);
    if (user) await db.from('profiles').update({ loyalty_points: 0, loyalty_points_held: 0 }).eq('id', user);
    if (catA) await db.from('event_ticket_categories').delete().eq('id', catA);
    if (catB) await db.from('event_ticket_categories').delete().eq('id', catB);
    const left = (await db.from('event_ticket_categories').select('id', { count: 'exact', head: true }).eq('event_id', EVENT)).count;
    left === 0 ? ok('test categories removed') : bad('categories left behind', String(left));
    console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
    process.exit(fail ? 1 : 0);
  }
})();
