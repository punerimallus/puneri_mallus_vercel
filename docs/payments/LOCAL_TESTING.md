# Testing the ticketing change locally

Ordered by risk. Everything here is something automated tests could **not** cover — a real
Razorpay checkout, a real phone camera, a real PDF, a real inbox. The API logic underneath is
already covered by 424 tests, so don't spend time re-checking that.

Razorpay stays in **test mode** throughout (`rzp_test_` key). No real money moves.

---

## Before you start — three things that will otherwise waste your time

**1. Point the QR codes at your machine.** `NEXT_PUBLIC_BASE_URL` is `https://punerimallus.com`,
and it is what gets baked into every pass QR. Generate a PDF locally as-is and its QR opens the
**production** site — which is still running the old code. For the run, change it in
`.env.local`:

```
NEXT_PUBLIC_BASE_URL="http://192.168.1.37:3000"   # your LAN IP, so a phone can reach it
```

`localhost` works for scanning on the same machine, but a phone cannot resolve it. Put the real
value back when you are done.

**2. Razorpay webhooks cannot reach localhost.** Nothing will call `/api/razorpay/webhook` from
the internet, so locally a payment is completed by the browser handler and the status poll
instead. That is fine — those are two of the four entry points and they are the ones a buyer
actually experiences. To exercise the real webhook path either run a tunnel
(`npx cloudflared tunnel --url http://localhost:3000`, then point the Razorpay test webhook at
`<tunnel>/api/razorpay/webhook`) or test it on a Vercel preview deployment.

**3. The eight existing test passes will now be refused at the gate.** `TICKET_QR_STRICT=true`
is on, and those PDFs were emailed before QR signing existed, so they carry no signature. A
`403 UNSIGNED` on an old pass is correct, not a bug. Issue a fresh pass to test the gate.

Start with `npm run dev`. Sign in at `/auth/login`.

---

## Must test

### 1. Buy a ticket end to end
`/events/<id>/book` → pick passes → **Proceed to Pay**.

Razorpay test card: **4111 1111 1111 1111**, any future expiry, any CVV, OTP `1234`.

- [ ] Before the modal opens, the green **"Your seats are held — 14:5x left to pay"** bar appears
- [ ] Payment succeeds and you land on `/tickets/<bookingId>`
- [ ] The passes email arrives with the PDF attached
- [ ] The PDF opens: event name, date, venue, pass numbers, QR per pass, receipt totals

### 2. Scan that pass with a phone
Point the camera at a QR in the PDF. It should open `/gate?bid=…&tno=…&sig=…` on your machine.

- [ ] Signed in as admin: the pass details load, **Verify Entry Now** admits it
- [ ] Scanning the same pass again says **ALREADY SCANNED**
- [ ] The event is in the future, so you will first get *"The gate is not open yet — confirm"*.
      That is the gate window working; confirm the override to admit. To avoid it, set the test
      event's date to today in Admin → Events.

### 3. Sold out is refused *before* payment — the headline fix
Admin → Box Office → set a category's capacity to **1**. Buy that one pass. Now from a second
account (or an incognito window), try to buy the same category.

- [ ] You are refused at **Proceed to Pay** with *"… just sold out. Nothing has been charged."*
- [ ] The Razorpay modal never opens, and nothing appears in Razorpay's test dashboard

### 4. Abandon a checkout and watch the seat come back
Start a purchase, let the modal open, then close it without paying.

- [ ] Admin → Box Office shows the seat available again within a few seconds
- [ ] Buy it again successfully

### 5. A volunteer can scan and nothing else
Admin → Gate Volunteers → add a second account's email. Sign in as that account.

- [ ] `/gate` works and they can admit a pass
- [ ] `/admin` redirects them away
- [ ] `/admin/payments`, `/admin/boxoffice` etc. are all refused
- [ ] Switch them off in Gate Volunteers → `/gate` now says *"Not on the gate list"*

---

## Should test

### 6. Group pass, partial entry
Set a category's group size to 5 in Admin → Box Office, buy one.

- [ ] Scanning asks *"Is the whole group here?"*
- [ ] **No, some are missing** → admit 2 → it says 3 still to come
- [ ] Scan again → admits the remaining 3 → now ALREADY SCANNED

### 7. Refund kills the pass and frees the seat
Refund the test payment from the Razorpay test dashboard. (Needs the webhook tunnel from above,
or press **Run Reconcile Now** on Admin → Payments.)

- [ ] The pass no longer scans — *"REFUNDED! … no longer valid"*
- [ ] The seat is back on sale in Box Office
- [ ] Any loyalty points spent on that order are back on the account

### 8. Void one pass out of several
Buy 3 passes in one booking. Admin → Box Office → click the **×** next to one pass number.

- [ ] Confirmation says plainly that no money is refunded
- [ ] That pass alone stops scanning; the other two still work
- [ ] Seats in use drops by exactly 1

### 9. Loyalty points
On an account with 50+ points, toggle **Tribe Points** at checkout.

- [ ] The discount is applied and the total drops
- [ ] After paying, the balance is reduced by what was spent and increased by what was earned
- [ ] Open a second tab and try to redeem the same points → refused as held by another checkout

### 10. Resend and the per-account cap
- [ ] Admin → Box Office → **Resend** on a booking re-sends the email
- [ ] Try to buy an 8th single pass for one event on one account → refused at 7

---

## What to watch while testing

Admin → Payments should stay quiet. Specifically:

- **Problem orders** should not gain rows. A `REFUND_INITIATED` row means we took money we could
  not deliver against and refunded it automatically — the reason column says why.
- There should be **no** `NEEDS_ATTENTION` rows from your testing. That status now means the
  automatic refund *itself* failed and needs a human.
- The banners at the top of the page should be absent except the `CRON_SECRET` one.

Event ticket sales now appear in the **Financial Ledger** — they never did before. If you buy a
ticket and it does not show up there, that is a regression worth telling me about.

---

## Putting it back

```
NEXT_PUBLIC_BASE_URL="https://punerimallus.com"
```

and restore any capacities or group sizes you changed. If you cleared the test bookings with the
SQL in section 6 of TICKETING_INTEGRITY.md, re-check that every category reads `sold = 0`.
