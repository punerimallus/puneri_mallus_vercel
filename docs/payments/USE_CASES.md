# Razorpay payments: audit and use-case matrix

Scope: every place money is taken on the site, as of September 2026.

| # | Where | Product | Client code | Server code |
|---|---|---|---|---|
| P1 | `/events/[id]/book` | Event passes (PDF e-tickets) | `app/events/[id]/book/page.tsx` | `/api/razorpay/order`, `/api/tickets/verify` |
| P2 | Membership modal | Lifetime "Inner Circle" membership | `components/Membership.tsx` | `/api/razorpay/order`, `/api/razorpay/verify` |
| P3 | `/directory/[id]` | Mallu Mart access (Monthly / Yearly / Lifetime) | `app/directory/[id]/page.tsx` | `/api/razorpay/order`, `/api/razorpay/verify` |
| (P4) | `/football/register` | Football registration | no longer takes payment | old `FOOTBALL` branch removed from order/verify |

New server pieces shared by all three: `/api/razorpay/webhook`, `/api/razorpay/status`, `/api/razorpay/reconcile` (daily cron + admin button), `/api/tickets/resend`, and the `payment_orders` table.

---

## 1. What was wrong (findings)

Severity: **Critical** = money lost or goods given away; **High** = paid users not served; **Medium** = wrong data / abuse; **Low** = UX.

| ID | Severity | Finding | Where | Fixed by |
|---|---|---|---|---|
| F1 | **High** | Tickets / membership / mart access were issued **only** from the browser's Razorpay `handler`. Closing the tab, losing network, the phone killing the browser after a UPI app switch, or any error in the verify call meant money was debited and **nothing was issued**. No webhook, no retry, no record. This is the "paid but no PDF" case. | all | Webhook + status polling + daily reconcile, all driving one idempotent `fulfilOrder` |
| F2 | **Critical** | `/api/tickets/verify` trusted `cart`, `email`, `eventId`, `totalAmount`, `pointsToRedeem` and `eventData` from the browser. The Razorpay signature only proves *some* payment for *that order*, so a user could pay for 1 cheap pass and submit a cart of 7 VIP passes. | P1 | Cart, price, email, event and points are stored in `payment_orders` when the order is created; verify only accepts the three Razorpay ids |
| F3 | **Critical** | Replaying `/api/tickets/verify` with the same valid signature issued a fresh set of passes, bumped `sold`, re-added loyalty points and re-sent email every time. | P1 | Order is claimed atomically; second call returns `ALREADY_FULFILLED`; unique index on `ticket_bookings.razorpay_order_id` |
| F4 | **Critical** | `/api/razorpay/verify` trusted `paymentType`/`plan`/`amount` from the browser: pay ₹99 for Mart Monthly, then call verify with `paymentType: "LIFETIME"` to become a lifetime member. Unknown `paymentType` or `plan` values were also priced at ₹99 by the order route. | P2, P3 | Type and plan come from `payment_orders`; unknown types/plans are rejected (400) |
| F5 | **Critical** | Negative `pointsToRedeem` passed the order route (`> 0` check skipped) and the verify route did `balance - (-N)`, minting loyalty points. | P1 | Points validated server-side (integer, ≥ 0, ≥ 50 to redeem, ≤ balance); applied once via atomic RPC |
| F6 | **High** | Ticket numbers were computed as read `sold` → add in JS → write back. Two buyers at the same moment got the **same ticket numbers** and could oversell capacity. Capacity was only checked at order time, not at issue time. | P1 | `allocate_tickets()` Postgres function reserves the whole cart in one transaction, with capacity check |
| F7 | **High** | Email failures were swallowed (`catch` + `console.error`; Resend returns `{error}` rather than throwing, so even that often didn't fire). Nobody knew a paid user got no email and there was no way to resend. | all | Email status tracked per order and booking; failed sends retried by reconcile (up to 5); "Email my passes again" button; admin resend with corrected address |
| F8 | **High** | Payments left `authorized` (if auto-capture is ever off, or a late authorization) are auto-refunded by Razorpay after a few days, but the user may already have passes. | all | Fulfilment captures authorized payments before issuing |
| F9 | **Medium** | `/api/admin/payments`, `/api/admin/boxoffice` (incl. PATCH to pause categories) and `/api/admin/tickets/scan` only required *any* logged-in user, not an admin. Anyone could read the payment ledger (emails, phones) or check tickets in. | admin | `checkAdminAccess()` on all three |
| F10 | **Medium** | Refunds were never reflected: refunded passes still scanned at the gate. | P1 | `refund.processed` webhook voids the booking; scanner rejects `REFUNDED` |
| F11 | **Medium** | Buying Mart again reset the expiry to "now + period" instead of extending it; a lifetime Mart user or lifetime member could buy Mart again, and a member could buy membership again. | P2, P3 | Expiry extends from current expiry; order route blocks redundant purchases; a duplicate paid membership (two tabs) is flagged for refund |
| F12 | **Low** | Mart page didn't check the order response (a failed order opened Razorpay with `order_id: undefined`) and the handler had no `try/catch`, leaving the spinner stuck. Event page left the button spinning after a verify error. | P1, P3 | Checked; every path resets loading state |
| F13 | **Low** | `payment.failed` from Checkout showed nothing to the user. | all | Failure reason shown; the modal stays open for a retry |

Known limits, not changed:
- Two orders created at the same time can both redeem the same loyalty points; the balance is clamped at 0, so the loss is bounded by one redemption. Fixing it needs points to be held at order time.
- The per-account 7-pass cap is checked at order time only. Two carts opened simultaneously could total more than 7.
- `/api/tickets/booking?bid=` returns any booking to any logged-in user who has the id (ids are random UUIDs).

---

## 2. How fulfilment works now

```
 order created ──► payment_orders row (CREATED) holds: user, type, plan, cart, prices, email, amount
      │
      ▼
 user pays in Razorpay
      │
      ├── browser handler ─► /api/*/verify ──┐
      ├── Razorpay webhook ─► /api/razorpay/webhook ──┤
      ├── modal closed / handler failed ─► page polls /api/razorpay/status ──┤──► fulfilOrder()
      └── daily cron / admin button ─► /api/razorpay/reconcile ──┘
                                                     │
          1. ask Razorpay for the payment (never trust the browser)
          2. atomically claim the order (only one caller proceeds)
          3. capture if only authorized; check amount + currency
          4. issue: seats via allocate_tickets() / membership / mart
          5. mark FULFILLED ──► send email (tracked, retried)
```

Whichever path arrives first does the work; the others see `ALREADY_FULFILLED`.

---

## 3. Use-case matrix

Legend: **Before** = behaviour of the code before this change. **After** = behaviour now. **Test** = automated test in `tests/payments/` (or `manual` for the checklist in section 4).

User types: **G** guest (not logged in), **U** logged-in non-member, **M** tribe member (`is_member`), **S** Mallu Mart subscriber, **A** admin.

### 3.1 Event passes (P1)

| # | User | Scenario | Expected | Before | After | Test |
|---|---|---|---|---|---|---|
| E1 | U, M | Pays successfully, stays on page | Redirect to `/tickets/[id]`, PDF emailed | ✅ | ✅ | fulfil: *issues sequential passes* |
| E2 | U, M | **Pays, then closes the Razorpay tab / browser before returning** | Passes still issued and emailed | ❌ nothing issued | ✅ webhook fulfils | fulfil: *tab closed after paying* |
| E3 | U, M | Pays, closes tab, **webhook also missed** (misconfigured / Razorpay outage) | Issued by daily reconcile or admin "Run Reconcile" | ❌ | ✅ | fulfil: *reconcile finds the captured payment* |
| E4 | U, M | Pays via UPI app; checkout modal closes without calling handler | Page polls status, redirects to passes | ❌ | ✅ | manual M4 |
| E5 | U, M | Pays; verify request fails (network/500) | Page polls status; passes issued; user told they'll be emailed | ❌ "Verification Failed", nothing issued | ✅ | fulfil: *crash after seats were reserved* |
| E6 | U, M | Handler and webhook arrive together | One booking, one email | n/a (no webhook) | ✅ | fulfil: *simultaneous requests* |
| E7 | U, M | Double-clicks "Pay" | One checkout opens | ⚠️ multiple orders | ✅ button guarded | manual M6 |
| E8 | U, M | Opens checkout, closes it without paying | Nothing issued, button re-enabled, no error | ✅ | ✅ | fulfil: *closed checkout without paying* |
| E9 | U, M | Card declined / UPI timeout, then retries in same modal and succeeds | Failure reason shown; success fulfils | ⚠️ no message | ✅ | fulfil: *failed attempt then successful retry* |
| E10 | U, M | Payment fails and user gives up | Order `FAILED`, nothing issued | ✅ | ✅ | fulfil: *only-failed payments* |
| E11 | U, M | Money debited but Razorpay marks payment failed (bank lag) | Razorpay auto-reverses; if it later captures, webhook fulfils | ❌ | ✅ | fulfil: *failed payment id still settles* |
| E12 | U, M | Payment only authorized, not captured | Captured, then issued | ❌ auto-refunded after days while user holds passes | ✅ | fulfil: *authorized-but-not-captured* |
| E13 | anyone | Replays verify call with a valid signature | No extra passes | ❌ unlimited passes | ✅ | fulfil: *replaying the verify call* |
| E14 | anyone | Tampers cart/amount/email in verify body | Ignored; server's stored cart used | ❌ | ✅ | fulfil + pricing tests |
| E15 | anyone | Sends a signature for another order's payment | Rejected | ✅ (signature) | ✅ | signature: *different payment or order*; fulfil: *payment id belonging to another order* |
| E16 | anyone | Tampers cart at order creation (bad category, negative / fractional qty, inactive category) | 400 | ⚠️ inactive allowed; bad qty unchecked | ✅ | pricing: *rejects tampered or invalid cart* |
| E17 | U, M | Category sells out between opening checkout and paying | Paid but no seat: order flagged `NEEDS_ATTENTION`, admin emailed to refund, user told | ❌ oversold with duplicate numbers | ✅ | fulfil: *sold out between checkout and payment* |
| E18 | U, M | Two buyers pay for the last seats at the same moment | Unique numbers, capacity respected | ❌ duplicate ticket numbers | ✅ | SQL `allocate_tickets` (manual M8) |
| E19 | U, M | Buys more than 7 passes across bookings | Blocked at order time | ✅ | ✅ (refunded bookings no longer count) | pricing: *7-pass cap* |
| E20 | M | Member discount applied | Discount on server price and PDF | ✅ (PDF used browser data) | ✅ (PDF uses stored price) | pricing: *member discount* |
| E21 | U, M | Redeems ≥ 50 points within balance | Discount; points deducted once | ✅ | ✅ | pricing + fulfil: *points redeemed…once* |
| E22 | U, M | Redeems negative / too few / too many points | 400 | ❌ negative points minted | ✅ | pricing: *loyalty points* |
| E23 | U, M | Points cover the full price | 400 "Invalid amount" (Razorpay needs ≥ ₹1) | ✅ | ✅ | pricing: *never lets the total reach zero* |
| E24 | U, M | Loyalty update fails | Passes still issued | ✅ | ✅ | fulfil: *loyalty failure does not block* |
| E25 | U, M | Ticket email fails (Resend down, bad address) | Booking kept; email retried up to 5 times; "Email my passes again" on ticket page; admin can resend to corrected address | ❌ silent | ✅ | delivery tests |
| E26 | U, M | Requests resend repeatedly | Once a minute | n/a | ✅ | delivery: *rate-limits user resends* |
| E27 | A | Refunds a booking in Razorpay dashboard | Passes voided; scanner rejects | ❌ still valid | ✅ | fulfil: *full refund voids*; webhook: *refund.processed* |
| E28 | A | Partial refund | Passes stay valid; admin alerted to void specific passes | ❌ | ✅ | fulfil: *partial refund* |
| E29 | G | Tries to buy without logging in | Sent to login (API returns 401) | ✅ (proxy) | ✅ | manual M1 |
| E30 | U, M | Returns to book page long after an abandoned order | New order; old order ignored | ✅ | ✅ | — |
| E31 | A | Scans a pass twice | "ALREADY SCANNED" | ✅ | ✅ | — |
| E32 | U (non-admin) | Calls scan / box-office API directly | 403 | ❌ allowed | ✅ | manual M9 |

### 3.2 Lifetime membership (P2)

| # | User | Scenario | Expected | Before | After | Test |
|---|---|---|---|---|---|---|
| L1 | U | Pays, stays on page | `is_member`, mart unlocked, membership ACTIVE, ledger row, welcome email | ✅ | ✅ | fulfil: *activates lifetime membership* |
| L2 | U | **Pays and closes tab** | Activated by webhook / reconcile | ❌ | ✅ | fulfil: *tab closed* (same engine) |
| L3 | U | Verify errors after payment | Page polls; activates | ❌ | ✅ | manual M5 |
| L4 | U | Pays Mart price then calls verify as LIFETIME | Gets Mart only | ❌ became member | ✅ | fulfil (type from server) |
| L5 | M | Tries to buy membership again | Blocked at order (409) | ❌ charged again | ✅ | manual M7 |
| L6 | U | Pays in two tabs at once | First activates; second flagged for refund | ❌ charged twice | ✅ | fulfil: *second paid lifetime order* |
| L7 | U | No `memberships` PENDING row exists | Row created as ACTIVE | ⚠️ silently skipped | ✅ | server wiring |
| L8 | U | Welcome email fails | Retried; admin sees in Payment Health | ❌ | ✅ | delivery tests |
| L9 | A | Refunds membership | Ledger marked REFUNDED; admin alerted to revoke (not automatic) | ❌ | ✅ | fulfil: *membership refunds are flagged* |
| L10 | U | Verify called twice | One ledger row | ❌ duplicate rows | ✅ | fulfil: *records the ledger once* |

### 3.3 Mallu Mart (P3)

| # | User | Scenario | Expected | Before | After | Test |
|---|---|---|---|---|---|---|
| S1 | U | Buys Monthly / Yearly / Lifetime | Unlocked; subscription row; receipt email | ✅ | ✅ | fulfil: *activates mart access* |
| S2 | U | **Pays and closes tab** | Unlocked by webhook / reconcile | ❌ | ✅ | same engine |
| S3 | U | Order creation fails | Error shown, Razorpay not opened | ❌ opened with undefined order | ✅ | manual M3 |
| S4 | U | Verify throws | Spinner reset; page polls | ❌ stuck spinner | ✅ | manual M5 |
| S5 | S | Renews Monthly while still active | Expiry extended from current expiry | ❌ reset to now + 1 month | ✅ | pricing: *extends an active subscription* |
| S6 | S (lifetime) / M | Tries to buy Mart | Blocked (409) | ❌ charged, lifetime downgraded to monthly | ✅ | manual M7 |
| S7 | anyone | Sends unknown plan (e.g. `FREE`) | 400 | ❌ charged ₹99, then unlocked as whatever verify said | ✅ | pricing: *rejects unknown plans* |
| S8 | U | Invoice email captured via gate | Receipt goes to that email | ✅ | ✅ (stored on order) | — |
| S9 | U | Verify called twice / crash mid-way and retried | Expiry extended once | ❌ | ✅ (`last_payment_id` guard) | server wiring |

### 3.4 Cross-cutting

| # | Scenario | Expected | Before | After | Test |
|---|---|---|---|---|---|
| X1 | Webhook with bad / missing signature | 400, nothing processed | n/a | ✅ | signature: *webhook* |
| X2 | Same webhook delivered twice | Second acknowledged as duplicate | n/a | ✅ | event-id log + idempotent fulfil |
| X3 | Webhook processing error | 500 so Razorpay retries; reconcile as backstop | n/a | ✅ | — |
| X4 | Webhook arrives before the order row exists / for an order made before this change | Logged, 200, no crash | n/a | ✅ | fulfil: *unknown orders* |
| X5 | Amount captured ≠ order amount | Flagged `NEEDS_ATTENTION`, admin emailed | ❌ | ✅ | fulfil: *amount mismatch* |
| X6 | Server crashes mid-fulfilment | Order left `PAID`; next webhook retry / poll / reconcile finishes it reusing reserved seats | ❌ | ✅ | fulfil: *crash after seats*, *stale claim* |
| X7 | Razorpay API down during verify | 500; order retryable; reconcile later | ❌ lost | ✅ | — |
| X8 | Resend (email) down | Fulfilment succeeds; email retried | ❌ lost | ✅ | delivery tests |
| X9 | Supabase write fails when creating the order record | User is **not** sent to Razorpay | n/a | ✅ | — |
| X10 | Admin views Payment Health | Lists stuck, flagged and email-failed orders; one-click reconcile | n/a | ✅ | manual M10 |

---

## 4. Manual test checklist (Razorpay **test mode** only)

Use test keys (`rzp_test_...`). Test cards: `4111 1111 1111 1111` (success), any future expiry, any CVV; UPI `success@razorpay` / `failure@razorpay`.

| # | Steps | Pass if |
|---|---|---|
| M1 | Logged out, open an event and press Pay | Redirected to login / clear error, no Razorpay modal |
| M2 | Buy 2 passes with test card, stay on page | Redirect to ticket page; PDF email arrives; admin Box Office shows "Emailed" |
| M3 | Mart: temporarily set an invalid plan in devtools and pay | Error toast, no modal |
| M4 | Pay with `success@razorpay`, then **close the tab immediately** after success | Within ~1 min the PDF email arrives; booking visible in Box Office with fulfilled_via = WEBHOOK |
| M5 | Block `/api/tickets/verify` in devtools (Network > Block request URL), pay | Page shows "Payment received. Confirming…" then redirects to passes |
| M6 | Double-click Pay | Only one Razorpay modal |
| M7 | As a lifetime member, try buying membership and Mart | 409 message, no modal |
| M8 | Set a category capacity to 1, open two browsers, pay in both | One gets the pass; the other is flagged in Payment Health and admin gets an alert email |
| M9 | As a non-admin, `fetch('/api/admin/payments')` in console | 403 |
| M10 | Disable the webhook in Razorpay, pay and close tab, then press "Run Reconcile Now" (after 2 minutes) | Order recovered, email sent |
| M11 | Refund a test payment fully from the Razorpay dashboard | Box Office shows "Refunded"; scanning the QR says REFUNDED |
| M12 | Use `failure@razorpay` | Failure message; can retry with a card in the same modal |
