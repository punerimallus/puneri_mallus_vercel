# Payments setup (do these before or with the deploy)

Test this in Razorpay **Test Mode** first. Nothing here needs live keys.

## 1. Run the database migration

Supabase dashboard > SQL editor > paste and run `supabase/migrations/20260930_payment_reliability.sql`.

It adds `payment_orders`, `payment_webhook_events`, a few columns on `ticket_bookings`, and two functions (`allocate_tickets`, `adjust_loyalty_points`). It is safe to run more than once.

If it prints *"Duplicate ticket_bookings per razorpay_order_id exist"*, some bookings were issued twice by the old replayable verify route. Run the query in the migration comment to list them, delete or merge the duplicates, then run the migration again.

**Deploy order:** migration first, then the code. The new order route refuses to open checkout if it cannot write `payment_orders`.

## 2. Environment variables (Vercel > Project > Settings > Environment Variables)

| Name | Value |
|---|---|
| `RAZORPAY_WEBHOOK_SECRET` | Any long random string. Must match the secret you enter in the Razorpay webhook (step 3). |
| `CRON_SECRET` | Any long random string. Vercel Cron sends it automatically to `/api/razorpay/reconcile`. |
| `PAYMENT_ALERT_EMAIL` | *(optional)* Where "payment needs attention" alerts go. Defaults to `EMAIL_USER`. |
| `NEXT_PUBLIC_BASE_URL` | Already used; must be the public site URL so PDF QR codes and the logo resolve. |

Existing: `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`.

## 3. Razorpay webhook

Razorpay Dashboard (Test Mode first, then Live Mode separately) > Account & Settings > Webhooks > Add New Webhook:

- **URL:** `https://<your-domain>/api/razorpay/webhook`
- **Secret:** the `RAZORPAY_WEBHOOK_SECRET` value
- **Active events:** `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`

Also check Account & Settings > Payment capture is set to **automatic** (recommended). If it isn't, the server captures authorized payments itself.

## 4. Cron

`vercel.json` schedules `/api/razorpay/reconcile` once a day at 03:30 UTC (works on the Hobby plan). On Pro you can make it more frequent, e.g. `*/15 * * * *`. Admins can also run it any time from **Admin > Payments > Run Reconcile Now**.

## 5. Payments that were lost before this change

Orders created before the migration have no `payment_orders` row, so reconcile can't recover them automatically. For each buyer who paid but got nothing:

1. Find the payment in Razorpay Dashboard > Transactions > Payments (search by email/phone). Status should be **Captured**.
2. Either refund it from there, or issue the passes by hand and email them. The Box Office "Resend" button works for any booking row.

## 6. Tests

```bash
npm test
```

Runs the unit tests in `tests/payments/` (fulfilment, idempotency, pricing, signatures, email delivery, webhooks). The manual test-mode checklist is in `USE_CASES.md` section 4.
