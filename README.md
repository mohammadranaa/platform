# MLC Platform — PDF/Company fix, campaign scheduling, step editing

I don't have push access to your GitHub repo, so this bundle contains the
actual working files (already build-tested with `npm run build`) for you
to drop into `mohammadranaa/platform` and push yourself. `CHANGES.diff` is
a standard git diff if you'd rather apply it with `git apply CHANGES.diff`
from the repo root.

## Already deployed for you (no action needed)
- **Supabase migration**: `quotes.company` column added (standard/remedials, default standard)
- **Supabase migration**: `campaigns.send_days` / `send_time_start` / `send_time_end` / `timezone` columns added
- **Edge function `send-sequences`**: redeployed (v2) with schedule enforcement. Your existing
  hourly cron job (`send-email-sequences`, `0 * * * *`) will now automatically skip campaigns
  outside their configured days/hours.
- `track-open` and `send-sequences` were already ACTIVE in your project before this session —
  that "pending deployment" item was already resolved.

## Files in this bundle → where they go
```
src/lib/companies.js                       NEW — single source of truth for Standard vs
                                            Remedials LTD (name/reg/bank details)
src/lib/generatePdf.js                     buildInvoicePdf/buildQuotePdf now accept a
                                            `company` param and render the correct entity
src/pages/DocumentGenerator.jsx            fixed "NONE: £0.00" row bug; now imports from
                                            the shared companies.js
src/pages/InvoiceDetail.jsx                passes company + paid into PDF builder; company
                                            toggle added to invoice header; fixed hardcoded
                                            Standard-only bank details in the send email body
src/pages/QuoteDetail.jsx                  passes `services` (was missing entirely — this is
                                            why quotes were missing the Services: line) and
                                            `company` into the PDF builder; company toggle
                                            added to quote header
src/pages/JobDetail.jsx                    invoice email now uses {{bank_name}}/{{sort_code}}/
                                            {{account_number}} template vars (auto-detected
                                            from job service types) instead of hardcoded
                                            Standard-entity bank details
src/pages/Campaigns.jsx                    added day-of-week + send-time-window scheduling
                                            UI; sequence steps are now editable in place
                                            (click subject/body to edit, not just add/delete)
supabase/functions/send-sequences/index.ts adds isWithinSendWindow() schedule check; already
                                            deployed live, included here so your repo matches
                                            what's actually running
```

## Root cause summary (what was actually broken)
Your platform grew two separate invoicing code paths at different times:
`DocumentGenerator.jsx` (the "Documents" page) knew about the Standard vs Remedials LTD
entities but had a display bug; the newer Job/Quote/Invoice-linked flow (`generatePdf.js` +
JobDetail/QuoteDetail/InvoiceDetail) never learned about the Remedials entity at all, so it
always rendered "My Landlord Certificate LTD" with Standard bank details — even for jobs
that should bill through Remedials LTD. QuoteDetail also never passed the `services` field
to the PDF builder, so quotes generated from the Quotes page were missing the "Services:"
line entirely. All of this is now unified through `src/lib/companies.js`.

## Still outstanding (not done in this session)
- `verify-emails` edge function: referenced in your notes as "built" but does not exist
  anywhere in the repo — it needs to be written from scratch (ZeroBounce + DNS fallback).
- `GOOGLE_CLIENT_SECRET`: you said you'd add this yourself.
- Campaign step *editing* now works, but the actual multi-step sequence isn't wired into
  `send-sequences` yet — that function currently only ever sends the single campaign-level
  subject/body, not the `sequence_steps` you can now edit. If you want the sequence to
  actually progress contacts through step 1 → 2 → 3 automatically, that's a follow-up.
