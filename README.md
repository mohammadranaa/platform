# MLC Platform — smooth navigation + inline lead assignment

## Root cause of the "back" bug
Two separate problems were stacking up:

1. **Wrong destination.** `JobDetail.jsx`, `LeadDetail.jsx`, and
   `ClientDetail.jsx` all had a hardcoded "← Jobs" / "← Leads" / "← Clients"
   button that called `navigate('/jobs')` etc. -- always the default list,
   regardless of where you actually came from. Open a job from the Calendar
   and that back button sent you to the Jobs list, not the Calendar.
   (`QuoteDetail.jsx` and `InvoiceDetail.jsx` already did this correctly
   with `navigate(-1)` -- I just brought the other three in line with that
   existing, correct pattern.)

2. **Lost filters on remount.** Even once the *route* is right, Leads,
   Jobs, and the Calendar all kept their filters/search/sort/tab/date in
   plain component state. React Router fully unmounts a page when you
   navigate away, so even browsing back to the exact right URL reset every
   filter to its default. This is why it looked like "back" was ignoring
   where you'd been, even on pages where the destination was already right.

## Fixed
- **`JobDetail.jsx`, `LeadDetail.jsx`, `ClientDetail.jsx`**: back button is
  now `navigate(-1)` everywhere, matching Quote/Invoice.
- **`Leads.jsx`**: search, status filter, renewal filter, verified filter,
  sort field/direction, tab, and page number are now synced to the URL
  query string (e.g. `/leads?type=cold_agent&status=New&page=2`). Back
  navigation restores the exact view. Also fixed a real bug I found while
  in there: the effect that resets pagination on filter change called
  `fetchLeads()` with no page argument, which read the *stale* pre-reset
  page number (React state updates aren't synchronous) -- if you were on
  page 3 and changed a filter, it fetched page 3 of the new filtered
  results instead of page 1. Fixed alongside the URL persistence.
- **`Jobs.jsx`**: same treatment -- status, month, search, payment/source/
  service/cert filters, and sort are all in the URL now.
- **`CalendarView.jsx`**: view mode (day/week/month), the currently
  displayed date, and the engineer filter are in the URL now. Opening a
  job from the Calendar and hitting back returns to the same week/month
  you were looking at, not today.

None of this changes what any page looks like -- it's the same UI, the URL
just now reflects what you're looking at, the way most well-behaved web
apps work. Bookmarking or sharing a filtered Leads/Jobs/Calendar link also
works now as a side effect.

## Admin inline lead assignment
The "Assigned To" column in the Leads list is now a live dropdown for
admins -- pick any rep and it saves immediately, no need to open the lead
or use the bulk-select checkboxes first. Reps still see the same read-only
name plus their existing Claim/Release self-service buttons; only admins
get the dropdown.

## Not touched
`Invoices.jsx` and `Clients.jsx` list views weren't mentioned in your
report and I didn't want to guess whether they have the same issue without
you confirming it's actually bothering you there too -- say the word and
I'll do the same treatment.
