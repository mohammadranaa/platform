-- ============================================================
-- MLC PLATFORM — 03: JOBS
-- Run this THIRD in Supabase SQL Editor
-- Covers: job records, line items, job diary, client activity log
--
-- MLC service types supported:
--   EICR   — Electrical Installation Condition Report
--   GSC    — Gas Safety Certificate (CP12)
--   EPC    — Energy Performance Certificate
--   FRA    — Fire Risk Assessment
--   FSC    — Fire Safety Certificate
--   PAT    — PAT Testing
--   Remedial — Remedial / repair works
--   Consumer Unit — Consumer unit replacement
--   Diagnostics — Electrical / gas diagnostics
--   Other  — anything else
-- ============================================================

-- Auto-incrementing job number sequence (starts at J-1001)
create sequence if not exists job_number_seq start 1001;

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),

  -- Human-readable job reference e.g. J-01001
  job_number          text unique not null
                        default ('J-' || to_char(nextval('job_number_seq'), 'FM00000')),

  -- Links
  client_id           uuid references public.clients(id) on delete set null,
  assigned_to         uuid references public.profiles(id) on delete set null,

  -- ── Job details ─────────────────────────────────────────────
  title               text not null,
  description         text,
  service_types       text[],
  -- e.g. ARRAY['EICR','GSC','PAT'] — multiple services per job

  job_type            text,
  -- Inspection / Installation / Repair / Maintenance / Survey / Remedial

  priority            text not null default 'Medium'
                        check (priority in ('Low', 'Medium', 'High', 'Emergency')),

  -- ── Site / access info ──────────────────────────────────────
  -- Often different from the client's billing address
  site_address        text,
  site_postcode       text,
  access_notes        text,
  -- e.g. "Call tenant 30 mins before arrival. Key under mat."
  tenant_name         text,
  tenant_phone        text,

  -- ── Lifecycle status ────────────────────────────────────────
  status              text not null default 'Quote'
                        check (status in (
                          'Quote',
                          'Scheduled',
                          'In Progress',
                          'Completed',
                          'Invoiced',
                          'Paid',
                          'Cancelled'
                        )),

  -- ── Scheduling ──────────────────────────────────────────────
  scheduled_date      date,
  scheduled_slot      text,   -- Morning (8am–12pm) / Afternoon (12pm–6pm)
  completed_date      date,

  -- ── Financial ───────────────────────────────────────────────
  quoted_amount       numeric default 0,
  invoice_amount      numeric default 0,  -- sum of line items
  payment_amount      numeric default 0,  -- amount actually received
  payment_status      text not null default 'Unpaid'
                        check (payment_status in ('Unpaid', 'Partial', 'Paid')),

  -- ── Invoice ─────────────────────────────────────────────────
  invoice_number      text,
  invoice_sent_date   date,
  paid_date           date,

  -- ── Compliance certificates ──────────────────────────────────
  -- Which certificates were issued after job completion
  certificates_issued text[],
  -- e.g. ARRAY['EICR Pass','CP12','EPC Band C']
  certificate_notes   text,

  -- ── Traceability ────────────────────────────────────────────
  source              text,
  -- online-booking / manual / servicem8-import / whatsapp
  booking_session_id  text,   -- links back to inbound form if applicable

  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Indexes
create index on public.jobs (client_id);
create index on public.jobs (assigned_to);
create index on public.jobs (status);
create index on public.jobs (scheduled_date);
create index on public.jobs (created_at desc);

create trigger jobs_updated_at
  before update on public.jobs
  for each row execute function update_updated_at();

-- ── Line Items ───────────────────────────────────────────────
-- Each job has one or more billable line items
-- Types mirror what MLC charges for:
--   certificate  → EICR, GSC, EPC, FRA, FSC, PAT (fixed-price)
--   labour       → hourly engineer time
--   material     → parts, consumer units, alarms, cables
--   other        → call-out fees, travel, admin

create table public.job_line_items (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  description   text not null,
  item_type     text not null
                  check (item_type in ('certificate', 'labour', 'material', 'other')),
  quantity      numeric not null default 1,
  unit          text default 'ea',  -- ea / hr / m / set
  unit_price    numeric not null default 0,
  total         numeric generated always as (quantity * unit_price) stored,
  created_at    timestamptz default now()
);

create index on public.job_line_items (job_id);

-- ── Job Diary ────────────────────────────────────────────────
-- Chronological log of everything that happens on a job
-- Engineers and office staff both write entries here
-- This is the ServiceM8 "diary" equivalent

create table public.job_diary (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  author_id     uuid references public.profiles(id) on delete set null,
  author_name   text not null,   -- stored so it survives profile deletion
  entry_type    text not null
                  check (entry_type in (
                    'note',           -- general note
                    'call',           -- phone call with client/tenant
                    'email',          -- email sent or received
                    'whatsapp',       -- WhatsApp message
                    'status_change',  -- auto-logged when status changes
                    'system'          -- auto-logged by the platform
                  )),
  content       text not null,
  created_at    timestamptz default now()
);

create index on public.job_diary (job_id, created_at desc);

-- ── Client Activity Log ──────────────────────────────────────
-- Separate from job diary — tracks CRM-level interactions
-- e.g. cold call to an estate agent, WhatsApp follow-up,
--      status change from New → Contacted, email sent from campaign

create table public.client_activities (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  rep_id        uuid references public.profiles(id) on delete set null,
  rep_name      text not null,
  type          text not null
                  check (type in (
                    'note',
                    'call',
                    'email',
                    'whatsapp',
                    'meeting',
                    'status_change',
                    'job_created',
                    'invoice_sent',
                    'payment_received'
                  )),
  content       text not null,
  created_at    timestamptz default now()
);

create index on public.client_activities (client_id, created_at desc);

-- ── Row Level Security ───────────────────────────────────────

alter table public.jobs               enable row level security;
alter table public.job_line_items     enable row level security;
alter table public.job_diary          enable row level security;
alter table public.client_activities  enable row level security;

-- Jobs
create policy "Admins have full access to jobs"
  on public.jobs for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Reps and engineers see assigned jobs"
  on public.jobs for select
  using (assigned_to = auth.uid());

create policy "Reps can update assigned jobs"
  on public.jobs for update
  using (assigned_to = auth.uid());

create policy "Any authenticated user can create a job"
  on public.jobs for insert
  with check (auth.uid() is not null);

-- Line items, diary, activities — any authenticated user
create policy "Authenticated users manage line items"
  on public.job_line_items for all
  using (auth.uid() is not null);

create policy "Authenticated users manage job diary"
  on public.job_diary for all
  using (auth.uid() is not null);

create policy "Authenticated users manage client activities"
  on public.client_activities for all
  using (auth.uid() is not null);

-- ── Realtime ─────────────────────────────────────────────────
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_diary;
alter publication supabase_realtime add table public.client_activities;
alter publication supabase_realtime add table public.job_line_items;

-- ── Helper function: update client totals after job changes ──
-- Call this after any job is completed or paid
create or replace function sync_client_totals(p_client_id uuid)
returns void language plpgsql as $$
begin
  update public.clients
  set
    total_jobs    = (select count(*) from public.jobs where client_id = p_client_id and status != 'Cancelled'),
    total_revenue = (select coalesce(sum(payment_amount), 0) from public.jobs where client_id = p_client_id and payment_status = 'Paid')
  where id = p_client_id;
end;
$$;
