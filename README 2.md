# Handoff: Internal Platform — redesigned dashboard + 12 tab pages

Paste this whole file into a Claude Code session opened on the `mohammadranaa/platform` repo.

## What this is

A full visual redesign of the internal ops platform (CRM/jobs/compliance tool used by schedulers, engineers, finance and compliance staff), covering the shell plus all 12 nav tabs: Dashboard, My Leads, Leads, Clients, Jobs, Calendar, Calls (NUACOM), Properties, Email Inbox, Templates, Invoices, Cold Email.

**This is a design reference, not code to copy in.** It's one streaming "Design Component" file (`Internal Platform Dashboard.dc.html`) — a template with `{{ }}` data holes plus one JS logic class that supplies sample data. Recreate it inside the existing React codebase (`src/pages/*.jsx`, `src/components/Layout.jsx`) using the app's real routing, data fetching and state — don't port the template syntax.

**Fidelity: high.** Colors, type, spacing, states, and the status vocabulary per tab are final. Recreate pixel-accurately. Sample row data is placeholder — wire each page to its real data source (see Data requirements).

## Visual direction

Rounded-corner SaaS look (not the square/blueprint style used elsewhere in this project) on the exact brand palette already in `src/lib/colors.js` / `src/app/globals.css`. Dense but colorful: every status gets its own hue so the eye can scan a column of badges instantly — this was an explicit revision after an earlier pass on a muted single-accent system read as too bland for a tool this data-dense.

## Tokens

### Layout
- Sidebar: 220px fixed, dark charcoal `#1F2937`, sticky full height, with a subtle grid-line + radial blue glow texture:
  ```css
  background-image:
    linear-gradient(to right, rgba(255,255,255,.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,.04) 1px, transparent 1px),
    radial-gradient(70% 120% at 100% 0%, rgba(0,147,219,.28), transparent 68%);
  background-size: 36px 36px, 36px 36px, auto;
  ```
- Topbar: white, `1px solid #E5E7EB` bottom border, `12px 28px` padding, holds page title + a period segmented control (Today/This Week/This Month, dashboard only) + date + notification bell.
- Content: `28px 28px 56px` padding, `max-width:1320px`.
- Cards: white, `1px solid #E5E7EB`, `border-radius:12px`, `box-shadow:0 1px 3px rgba(0,0,0,.06)`.
- Border radius is used throughout (8–12px) — this screen intentionally departs from any square/hairline system elsewhere in the project.

### Type
Barlow Condensed 700 for headings/numbers/nav; Barlow 400/500/600 for body. Google Fonts: `Barlow:400,500,600,700` + `Barlow Condensed:400,500,600,700`.

| Role | Size/weight |
| --- | --- |
| Page H1 | Condensed 700, 26px |
| Section label | 11px 700 uppercase `.08em`, `#6B7280` |
| KPI value | Condensed 700, 28px |
| Card/table text | Barlow 13–14.5px |
| Badge | 11–12px 700 |

### Color — brand base
| Token | Hex |
| --- | --- |
| Sidebar ground | `#1F2937` |
| Page ground | `#F5F7FA` |
| Card surface | `#fff` |
| Card border | `#E5E7EB` |
| Primary accent (buttons, active nav, links) | `#0093DB` / hover `#0077b3` |
| Brand green (revenue, "paid"-type positives) | `#80D100` accents, text `#3d7a00` / `#5a9400` |
| Body text | `#1F2937` |
| Secondary text | `#4B5563` |
| Tertiary text | `#6B7280` |
| Muted text | `#9CA3AF` |

### Color — status badges (bg / text), by domain
These are the exact per-tab status vocabularies — keep each tab's own set, don't merge them:

**Jobs / Calendar / Properties** (`statusColors`):
Quote `#EDE9FE`/`#7C3AED` · Scheduled `#E0F2FE`/`#0284C7` · In Progress `#FEF3C7`/`#D97706` · Completed `#CCFBF1`/`#0D9488` · Invoiced `#E6F4FC`/`#0093DB` · Paid `#F0FAE0`/`#5a9400` · Cancelled `#FEE2E2`/`#DC2626`

**Leads / My Leads / Inbox** (`leadColors`):
New `#F3F4F6`/`#6B7280` · Contacted `#FEF3C7`/`#D97706` · In Discussion `#EDE9FE`/`#7C3AED` · Declined `#FEE2E2`/`#DC2626` · Accepted `#F0FAE0`/`#5a9400`

**Clients** (`clientColors`):
New `#F3F4F6`/`#6B7280` · Contacted `#FEF3C7`/`#D97706` · Qualified `#EDE9FE`/`#7C3AED` · Proposal Sent `#E0F2FE`/`#0284C7` · Active Client / Closed Won `#F0FAE0`/`#5a9400` · Closed Lost `#FEE2E2`/`#DC2626` · Unsubscribed `#F3F4F6`/`#9CA3AF`

**Invoices** (`paymentColors`):
Paid `#F0FAE0`/`#5a9400` · Unpaid `#FEE2E2`/`#DC2626` · Partial `#FEF3C7`/`#D97706`

**Templates / Cold Email campaigns** (`campaignColors`):
Active `#E6F4FC`/`#0093DB` · Replied `#CCFBF1`/`#0D9488` · Bounced `#FEE2E2`/`#DC2626` · Completed `#F0FAE0`/`#5a9400`

**Calls** (`callColors`):
Answered `#F0FAE0`/`#5a9400` · Missed `#FEE2E2`/`#DC2626` · Voicemail `#FEF3C7`/`#D97706`

## Shell (every screen)

**Sidebar**, top to bottom: brand mark "◈ MLC Platform" (Condensed 700, 18px, `#0093DB`) + "CRM · Jobs · Compliance" kicker (`#80D100`); a search input; the 12-item nav (each row: 22×22 rounded monogram chip + label; active row gets `rgba(0,147,219,.16)` bg, white text, 3px left accent border, solid-blue monogram chip; inactive rows `#9CA3AF` text, translucent monogram chip); pinned bottom: user name/role + "Sign out" ghost button.

Monogram codes: Dashboard=DA, My Leads=ML, Leads=LD, Clients=CL, Jobs=JB, Calendar=CA, Calls (NUACOM)=PH, Properties=PR, Email Inbox=IN, Templates=TP, Invoices=IV, Cold Email=CM.

**Topbar**: page title (from active nav label) on the left; on Dashboard only, a 3-way pill segmented control (Today/This Week/This Month — white pill + blue text for the active segment, on a `#F5F7FA` track); date right-aligned; a rounded notification bell button with a red unread dot.

## Dashboard (tab 1)

Greeting ("Good {morning/afternoon/evening}, {name} 👋") + long date. Then, stacked sections each with an 11px uppercase section label:

1. **Company overview — {period}** — 5 KPI cards, each top-bordered 3px in its own status color: Jobs Created (blue), Revenue (green), In Progress (amber), Scheduled (sky), Cert. Delivered (teal). Value in Condensed 28px, colored; small `#9CA3AF` note under it.
2. **Lead pipeline** — 4 plain cards: Total Leads, Inbound, Verified, Cold Agents (colors: charcoal/blue/purple/amber).
3. **Jobs by status** — one pill per status (white bg, 4px left border in the status color, label + bold colored count) for all 7 job statuses, horizontal wrap.
4. **Rep performance — {period}** — table: Rep / Jobs / Revenue / Calls / Emails / Outreach. Jobs count in blue Condensed bold; Revenue in green; Calls as an amber chip; Emails plain blue text; Outreach as a purple chip.
5. **Renewals due soon** — list rows: client name + "{work type} · Due {date}", right-aligned status chip ("{n}d overdue" red / "{n}d left" amber if ≤14d / green otherwise).
6. **Recent jobs** (left) / **Recent activity** (right), two-column — jobs list with status chip per row; activity list with an emoji icon + text + "{rep} · {relative time}" meta.

Sample data (KPIs 41/£9,950/22/38/61; pipeline 486/212/168/106; job statuses Quote 14, Scheduled 38, In Progress 22, Completed 61, Invoiced 17, Paid 214, Cancelled 6; 4 reps; 4 renewals; 5 recent jobs; 6 activity entries) — all in the file's logic class, replace with real queries.

## The 11 list/table tab pages

Every non-dashboard tab shares one layout: kicker + H1 + a primary "+ New {thing}" button top-right; an optional stat-card row (Leads tab only: Total/Inbound/Estate Agents/In Campaign); a row of pill filter chips (first one shown active — blue border/tint/text, rest neutral); then a table card with a `#F5F7FA` header row (11px uppercase labels) and data rows (5 columns, last one right-aligned, 4th column always the colored status badge).

Per-tab spec (kicker / title / primary action / filter chips / column headers / status palette used):

| Tab | Title | Action | Filters | Columns | Palette |
| --- | --- | --- | --- | --- | --- |
| My Leads | Your assigned leads | + New Lead | All, Inbound, Estate Agents, Opened Email, In Campaign | Contact, Type, Last Contact, Status, Value | leadColors |
| Leads | All leads | + New Lead | All Leads, Inbound, Estate Agents, Opened Email, In Campaign | Contact, Type, Last Contact, Status, Value | leadColors |
| Clients | Client accounts | + New Client | All, Active Client, Qualified, Proposal Sent, Closed Won | Company/Contact, Type, Last Activity, Status, Properties | clientColors |
| Jobs | Job board | + New Job | All, Quote, Scheduled, In Progress, Completed, Invoiced, Paid | Job, Client, Service, Status, Amount | statusColors |
| Calendar | Engineer schedule | + Book visit | This Week, Next Week, Unassigned only | Time, Job, Engineer, Status, Postcode | statusColors |
| Calls (NUACOM) | NUACOM call log | Dial number | All, Inbound, Outbound, Missed | Time, Contact, Direction, Result, Rep | callColors |
| Properties | Managed properties | + Add property | All, Action needed, Fully compliant | Address, Landlord, Next renewal, Status, Postcode | statusColors |
| Email Inbox | Shared inbox | Compose | All, Unread, Sales, Support | From, Subject, Inbox, Status, Received | leadColors |
| Templates | Email templates | + New Template | All Templates, Verified Customer, Cold Email, Process | Template, Category, Last edited, Status, Used | campaignColors |
| Invoices | Invoices | + New Invoice | All, Paid, Unpaid, Partial | Invoice, Client, Company, Status, Amount | paymentColors |
| Cold Email | Campaigns | + New Campaign | All, Active, Replied, Bounced, Completed | Campaign, Sent, Reply rate, Status, Started | campaignColors |

Row click should navigate to the record's detail page (not built here — wire to existing `JobDetail`, `ClientDetail` etc. routes). See the file's `pages` object in the logic class for exact sample row content per tab (4-6 rows each) — carries realistic names/addresses/certificate types consistent with the rest of this project.

## Interactions

- Nav click switches the active tab (route in production: `/dashboard`, `/my-leads`, `/leads`, `/clients`, `/jobs`, `/calendar`, `/calls`, `/properties`, `/inbox`, `/templates`, `/invoices`, `/campaigns`).
- Dashboard period control re-labels "Company overview" / "Rep performance" sections (wire to a real date-range query).
- Filter chips are visual-only in this prototype — wire to real filtering, with the first chip ("All") active by default.
- "+ New X" buttons should open the existing create flows for that entity.

## Data requirements

Map each tab to its real source in this codebase rather than the sample arrays in the DC file:
- Dashboard KPIs/rep table/activity — existing `Dashboard.jsx` queries + `colors.js` status maps.
- Leads/My Leads — `Leads.jsx`/`MyLeads.jsx`, `LEAD_STATUSES`.
- Clients — `Clients.jsx`, `CLIENT_STATUS_COLORS`.
- Jobs/Calendar/Properties — `Jobs.jsx`, `CalendarView.jsx`, `Properties.jsx`, job `statusColors`, `services.js`.
- Calls — `NuacomDialer.jsx`.
- Email Inbox/Templates — `EmailInbox.jsx`, `Templates.jsx`.
- Invoices — `Invoices.jsx`/`JobDetail.jsx` `PAYMENT_STATUSES`.
- Cold Email — `Campaigns.jsx`.

## Files in this bundle

- `Internal Platform Dashboard.dc.html` — full design prototype (template + logic), all 12 screens, click the sidebar to switch.
- `support.js` — runtime to open the prototype locally only; not part of the implementation.
