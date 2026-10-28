# Ticketing integrity — what changed and what you have to do

This covers the change that moves seat reservation to **before** payment, puts ticket numbers in a
real table, gives volunteers a scanner-only role, and makes undeliverable payments refund
themselves.

There is **one** manual step: run the migration. Everything else deploys with the code.

---

## 1. Run the migration (required, do it first)

Supabase dashboard → SQL editor → paste and run:

```
supabase/migrations/20261028_ticketing_integrity.sql
```

It is safe to run more than once. It will:

- create `ticket_numbers`, `inventory_reservations`, `event_staff`, `scan_log`
- add `profiles.loyalty_points_held`, `payment_orders.reservation_id`, `payment_orders.auto_refund_id`,
  `event_ticket_categories.issued_total`
- create the reservation functions (`reserve_order_inventory`, `confirm_order_inventory`,
  `release_order_inventory`, `expire_stale_holds`, `void_ticket_number`)
- **backfill** every pass that already exists, so the numbers printed on people's PDFs can never
  be handed to a second buyer
- redefine `event_ticket_categories.sold` to mean *seats in use* and pin `released` to 0

It prints a notice like `ticket number backfill: 14 claimed, 0 skipped`. A non-zero *skipped*
count means some legacy pass had a category that has since been renamed or a ticket number with
no digits in it; those numbers are not protected, so check them with the query in section 5.

**Until the migration is applied, ticket checkout answers 503 and takes no money.** That is
deliberate — the alternative is selling seats the database cannot actually reserve. The admin
Payments page shows a red banner saying so, and `/api/admin/health` reports it.

Verify with:

```bash
node scripts/smoke-ticketing.mjs
```

It is read-only. Add `--razorpay` to also create one unpaid test-mode order.

---

## 2. Environment variables

Nothing new is required. Two optional ones:

| Name | Effect |
|---|---|
| `TICKET_QR_SECRET` | Key used to sign pass QR codes. If unset, one is derived from `SUPABASE_SERVICE_ROLE_KEY`, so signing always works — but rotating the service role key would then invalidate signatures on already-printed passes. Set this explicitly before an event you care about. |
| `TICKET_QR_STRICT` | `true` makes the gate refuse passes with no signature at all (everything printed before this change). Leave unset until the last pre-change event has happened. |

`RAZORPAY_WEBHOOK_SECRET` was already required but was not set in `.env.local`; without it every
webhook is rejected as unsigned, which silently removes the safety net that fulfils a payment
when the buyer's tab closes. The admin Payments page now says so plainly if it is missing.

---

## 3. How a ticket sale works now

```
  Buyer picks passes
        │
        ▼
  POST /api/razorpay/order
        │   reserve_order_inventory()  ← seats, ticket numbers and loyalty points are taken HERE,
        │                                in one transaction, under a lock on the buyer's profile
        │   ✗ SOLD_OUT / LIMIT_SINGLE / LIMIT_GROUP / POINTS_UNAVAILABLE
        │     → refused before Razorpay is ever opened. Nothing charged.
        ▼
  Razorpay order created, held for 15 minutes
        │
        ├── buyer pays ──► verify / webhook / status poll / reconcile (any of the four)
        │                       │  confirm_order_inventory()  ← the hold becomes issued passes,
        │                       │                               the reserved points are spent
        │                       ▼
        │                  booking + PDF + email (+ WhatsApp)
        │
        ├── buyer closes the window ──► POST /api/razorpay/cancel
        │                                release_order_inventory() → seats back on sale at once
        │
        └── buyer vanishes ──► expire_stale_holds() (reconcile, and before each new reservation)
                                 → seats back on sale within the hour
```

If a payment somehow arrives against a reservation that is already gone — or the amount does not
match, or it is a duplicate membership — the money is **refunded automatically** and the admin is
emailed. The order goes to `REFUND_INITIATED`. Only if Razorpay refuses the refund does it land
in `NEEDS_ATTENTION`, which now genuinely means "a human must act".

---

## 4. Gate volunteers

**Admin → Gate Volunteers.** Add the email a volunteer signs in with. They can then open the gate
scanner and nothing else — no pricing, no payments, no member data. Leave *Which event* as "All
events" or tie them to one show.

- The scanner is at **`/gate`**. Old QR codes point at `/admin/scanner` and are redirected there,
  so passes already in people's inboxes keep working.
- A pass only admits within its own event's window: from 8 hours before the start to 10 hours
  after. Outside that a volunteer is refused; an admin is asked to confirm an override.
- Every admission is written to `scan_log` with the email of whoever made it.
- A QR with a bad signature is refused outright.

To take someone off the gate, switch them off (their past scans stay in the log) or remove them.

---

## 5. Useful queries

```sql
-- Seats in use vs capacity, per category
select c.name, c.capacity, count(t.number) as in_use, c.issued_total
  from event_ticket_categories c
  left join ticket_numbers t on t.category_id = c.id
 group by c.id, c.name, c.capacity, c.issued_total
 order by c.name;

-- Checkouts currently holding stock
select reservation_id, user_id, event_id, points_held, expires_at
  from inventory_reservations
 where state = 'HELD'
 order by expires_at;

-- Hand a stuck hold back immediately
select release_order_inventory('<reservation_id>');

-- Who admitted whom, most recent first
select at, actor_email, actor_role, ticket_number, admitted, signed
  from scan_log
 where event_id = '<event id>'
 order by at desc
 limit 100;

-- Legacy passes whose number the backfill could not claim (check these by hand)
select b.id, t->>'categoryName' as category, t->>'ticketNumber' as pass
  from ticket_bookings b
  cross join lateral jsonb_array_elements(b.tickets_data) t
 where coalesce(b.status, 'CONFIRMED') <> 'REFUNDED'
   and coalesce(t->>'status', 'ISSUED') <> 'REFUNDED'
   and not exists (
     select 1 from event_ticket_categories c
      where c.event_id = b.event_id and c.name = t->>'categoryName');
```

---

## 6. Clearing test bookings before sales open

Test bookings hold real seats: a pass that exists counts against its category's capacity. To
start from a clean zero, run this **as one transaction**.

Read the two warnings first — they are the difference between this being safe and this costing
you a revenue record.

> **Do not delete from `payments`.** That ledger holds football registrations and membership
> sales — real money, unrelated to ticketing. Event tickets never reached it before this change
> (they do now), so there is nothing of yours to clean up in there anyway.
>
> **Do not delete from `payment_webhook_events`.** Those rows are what stop Razorpay re-sending
> an old webhook and having it reprocessed. With the orders gone, a replayed refund event would
> find no matching order and now raises — so Razorpay would retry it indefinitely and keep
> alerting you. Leave them.

```sql
begin;

-- Check what you are about to remove.
select count(*) from ticket_bookings;                                        -- bookings
select count(*) from payment_orders where payment_type = 'EVENT_TICKET';     -- ticket orders only
select count(*) from ticket_numbers;                                         -- seats held

-- Reservations cascade to ticket_numbers, so this frees the seats too.
delete from inventory_reservations
 where reservation_id in (
   select reservation_id from payment_orders where payment_type = 'EVENT_TICKET'
   union
   select 'legacy-' || id::text from ticket_bookings
 );

delete from payment_orders where payment_type = 'EVENT_TICKET';
delete from ticket_bookings;

-- Counters back to a true zero (sold means "seats in use"; released stays 0 by design).
update event_ticket_categories
   set sold = 0, released = 0, issued_total = 0;

-- Optional: loyalty points earned during testing, so they cannot be spent on a real sale.
update profiles set loyalty_points = 0, loyalty_points_held = 0 where loyalty_points > 0;

-- Confirm nothing is left holding a seat, then commit.
select count(*) as should_be_zero from ticket_numbers;

commit;
```

Afterwards, `select name, sold, capacity from event_ticket_categories` should show `sold = 0`
everywhere, and the first real buyer gets ticket number 001 in each category.

## 7. Voiding a single pass

`POST /api/admin/tickets/void` with `{ bookingId, ticketNumber }` (admin only) stops that one
pass scanning and puts its seat and number back on sale. It does **not** move money — refund in
Razorpay separately if that is what you mean. Before this there was no way to kill one pass; the
only lever was refunding the whole order.

---

## 8. Tests

```bash
npm test
```

- `tests/sql/reservations.test.ts` applies this migration to a real in-process PostgreSQL
  (PGlite) and exercises every reservation path, including 100 buyers against 10 seats.
- `tests/payments/load.test.ts` drives 100 concurrent buyers through the real fulfilment engine
  and asserts nothing is oversold, no pass number repeats, no points are spent twice, and nobody
  is charged for a seat they did not get.
- `tests/security/scan-route.test.ts` covers the gate: who may scan, event binding, the gate
  window, signatures and two staff scanning at once.
