# WhatsApp ticket template

WhatsApp only lets a business start a conversation with a **pre-approved template**. Create this one in
Meta Business Suite → WhatsApp Manager → Message templates → Create template (approval is usually minutes).

| Setting   | Value |
|-----------|-------|
| Name      | `ticket_confirmation` (or set `WHATSAPP_TEMPLATE_NAME`) |
| Category  | **Utility** |
| Language  | English (`en`) (or set `WHATSAPP_TEMPLATE_LANG`) |
| Header    | **Document**, sample: any PDF |
| Footer    | `Puneri Mallus` |

**Body** (the six `{{n}}` are filled in by the app, in this order):

```
Hi {{1}}, your tickets for {{2}} are confirmed! 🎟️

📅 {{3}}
📍 {{4}}

Your passes are attached. Show the QR code at the entry gate with a valid ID.
You can also see them anytime here: {{5}}

Booking ref: {{6}}
```

Samples for review: `1 = Asha`, `2 = Onam Night 2026`, `3 = Sun, 18 Oct 2026, 6:00 PM`, `4 = Balewadi Sports Complex, Baner, Pune`,
`5 = https://punerimallus.com/tickets/abc`, `6 = 7F3C2A10`.

## Environment variables (Vercel)

| Variable | Value |
|----------|-------|
| `WHATSAPP_ACCESS_TOKEN` | a **permanent** System User token (the 24-hour test token in API Setup stops working after a day) |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone Number ID |
| `NEXT_PUBLIC_WHATSAPP_ENABLED` | `true` to show the checkbox at checkout (redeploy after changing) |
| `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` | optional, defaults above |

Nothing happens until the first two are set. Never commit the token.
