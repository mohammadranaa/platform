# MLC Platform — bug audit, part 3 (Jobs, Leads, Dashboard, Templates, NuacomDialer)

## Fixed in this bundle

### 1. Deleting a job silently destroys uploaded files, with no warning 🟡
Checked the DB's foreign key rules: deleting a row from `jobs` cascades to
**permanently delete** `job_files` (certificates, photos, payment proof),
`job_diary`, and `activities`. The confirm dialog just said "Delete this
job? This cannot be undone" -- it didn't mention that any attached
certificates or payment proof photos go with it. (Related rows like
`invoices` and `quotes` are spared -- they get `job_id` set to null instead
of being deleted, so financial records survive but become disconnected from
the job.)

**Fixed**: the confirm dialog now checks how many files/diary entries are
attached and says so explicitly, e.g. *"Delete this job? This will also
permanently delete 3 uploaded files (certificates/photos) and 2 diary
entries. This cannot be undone."* Doesn't change what deletion does, just
makes sure whoever clicks it knows the actual blast radius.

### 2. Renewal countdown had the same timezone bug fixed elsewhere already 🟢
`Dashboard.jsx`'s "Renewals Due Soon" widget computed days-until-renewal
with `new Date(lead.renewal_due_date)` on a plain `YYYY-MM-DD` string --
that parses as UTC midnight, which drifts by an hour in BST and can make a
renewal look a day early/late right around midnight. Your own codebase
already has a `parseLocalDate()` helper in `lib/dateUtils.js` for exactly
this (used correctly in Jobs/Calendar) -- Dashboard just wasn't using it.
**Fixed**: now imports and uses the same helper.

## Found, not fixed -- needs a product decision

### 3. CSV lead import has no duplicate detection
`Leads.jsx`'s CSV importer inserts every row as a new lead with zero check
against existing leads by email or phone. Uploading the same file twice, or
two overlapping contact lists, creates full duplicate lead rows -- which
then means duplicate contacts in `campaign_contacts` and the same person
getting cold-emailed twice from two different lead records. I didn't fix
this because the right dedup key depends on your data (email only? phone
only? either? within a lead_type or across all three?), and getting it
wrong could silently drop legitimate leads that happen to share a phone
number (e.g. a landlord and their agent). Want me to add a dedup check --
and if so, on what field(s)?

### 4. (Confirmed working as designed, not a bug) CSV import can auto-create jobs
I initially flagged this as a bug -- importing an "inbound" CSV row with
`payment_status = paid` sets the lead's status to `Accepted`, which fires
your DB trigger to auto-create a client + job. Turned out this is
deliberate: the import flow has a specific success message ("X
auto-converted (paid)") built around it, clearly intentional for migrating
real historical paid bookings. Leaving as-is, just noting it here in case
it wasn't obvious that a "paid" row in an import file creates a real job
record, not just a lead.

## Templates.jsx and NuacomDialer.jsx
Went through both -- no credential leaks, no dangerous write paths, nothing
worth flagging. NuacomDialer doesn't handle any API keys client-side (calls
go through the `nuacom-webhook` function and read from a table), and
Templates.jsx's save/delete paths are straightforward with no cascade
surprises.

## Where this leaves the overall audit
Across all three passes I've now gone through every page and every edge
function in the repo. Summary of what's fixed vs. still open:

**Live in production**: XSS sanitization, Google OAuth secret leak (server
+ client), track-open sequence-breaking bug, reply/bounce detection restored
to match what's on GitHub.

**In this bundle, not yet pushed**: job-delete warning, Dashboard renewal
date fix.

**Written but intentionally not deployed**: Stripe webhook signature
verification (needs `STRIPE_WEBHOOK_SECRET` set first).

**Still waiting on your input**: the dead SMTP Inboxes page/table, CSV
duplicate detection, and whether to add shared-secret checks to
`inbound-booking`/`nuacom-webhook`.
