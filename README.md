# Martin's booking — root cause found, fixed, deployed, and backfilled

## What actually happened
Checked the edge function logs directly. `inbound-booking` was called 3
times for Martin's session, and by the last call it had everything: name,
phone, full address, both services with prices, appointment date, time
slot. But every one of those calls was labeled `"status":"Partial — Step N"`
by the Apps Script (its own internal step-tracking), and the code had this:

```js
if (isPartial) {
  // Don't create a lead for partial fills — just acknowledge
  return ...  // discards the entire payload
}
```

So all three calls -- including the one with complete data -- were thrown
away entirely. Martin then paid via Stripe before the form ever reached a
non-partial status, so when `stripe-webhook` fired, it searched for an
existing lead by session ID, found nothing (because it had been discarded),
and created a bare lead from whatever Stripe itself knows: name, email,
amount paid. No address, no services, no appointment date. That bare lead
had `status: 'Accepted'`, which correctly fired the auto-job-creation
trigger -- so a job card *was* created, just with nothing useful in it,
which is presumably why it didn't register as "a job was made."

## Fixed and deployed live
`inbound-booking` now always saves/updates the lead with whatever data is
present on every call, partial or not -- it only skips the staff
notification and activity-log entry for partial steps (matching what was
clearly the original intent -- "don't spam the team on every keystroke,"
not "don't save the data"). This means by the time a customer completes
Stripe checkout, there's already a rich lead sitting there under that same
session ID for the Stripe webhook to find and enrich, instead of a payment
falling through to a bare fallback record.

**One side effect worth knowing**: since partial fills now always get
saved, you'll start seeing more `New`-status leads from people who started
the form and abandoned it early (even at step 2, with almost nothing
filled in). That's the trade-off for never losing a real booking again --
those low-quality partial leads are easy to filter/ignore, whereas silently
losing a paid booking's details isn't.

## Backfilled two real bookings that hit this bug
Found **two** paid bookings affected (searched for `Accepted` leads with a
Stripe-created note and no address):
- **Martin Le Roux** — job J-01113. Recovered his full details (24
  Kenilworth Avenue, EICR + Gas Safety, appointment 24 Aug) from the logs
  and updated his lead, client, and job records directly.
- **James Spender** — job J-01103, £439.96, dated 10 Aug. Same bug, same
  fix -- recovered from logs (12 Colwith Road, EICR + Gas Safety + EPC +
  Fire Risk Assessment, appointment 14 Aug) and backfilled.

Both jobs now have the correct address, services, and appointment date.
Nothing else was affected by this specific bug (checked for other
`Accepted`/Stripe-created leads with missing addresses and found only
these two) -- there are two other jobs with blank addresses (J-01061,
J-01081) but neither matches this bug's signature (no Stripe note, no
session ID pattern), so I left them alone rather than guess.

## Stripe webhook signature verification — still needs your action
I wrote this fix in an earlier session but **never deployed it**, because
doing so before `STRIPE_WEBHOOK_SECRET` is set in Supabase would reject
every real payment webhook (it fails closed on purpose). Checked just now:
the currently *live* `stripe-webhook` is still the old version with no
signature check at all -- meaning right now, anyone who finds that URL
could POST a fake "payment succeeded" event and get a lead auto-marked
Accepted (which creates a real client + job).

**To close this**: Stripe Dashboard → Developers → Webhooks → your endpoint
→ copy the "Signing secret" (`whsec_...`), then run
`supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`. Tell me once that's
set and I'll deploy the signed version immediately -- it's already written
and ready.
