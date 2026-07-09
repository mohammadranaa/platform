-- ============================================================
-- MLC PLATFORM — 07: LEADS, CLIENTS & JOBS RESTRUCTURE (FIXED)
-- Run this SEVENTH in Supabase SQL Editor
-- Fix: removed generated column days_until_renewal (not immutable)
-- ============================================================

-- ── 1. LEADS TABLE ───────────────────────────────────────────
create table public.leads (
  id                    uuid primary key default gen_random_uuid(),
  lead_type             text not null check (lead_type in ('inbound', 'verified', 'cold_agent')),
  assigned_to           uuid references public.profiles(id) on delete set null,
  status                text not null default 'New',
  source                text,
  notes                 text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),

  -- ── INBOUND FIELDS ─────────────────────────────────────────
  inbound_name          text,
  inbound_email         text,
  inbound_phone         text,
  tenant_name           text,
  tenant_phone          text,
  street_address        text,
  city                  text,
  postcode              text,
  property_type         text,
  property_subtype      text,
  services_requested    text,
  additional_charges    text,
  appointment_date      date,
  time_slot             text,
  total_price           numeric,
  payment_status        text,
  booking_status        text,

  -- ── VERIFIED CUSTOMER FIELDS ───────────────────────────────
  previous_job_date     date,
  previous_job_status   text,
  company_name          text,
  contact_first         text,
  contact_last          text,
  email_address         text,
  job_telephone         text,
  job_mobile            text,
  address               text,
  billing_address       text,
  work_done             text,
  last_payment_amount   numeric,
  last_invoice_amount   numeric,
  current_payment       text,
  current_status        text,
  current_notes         text,

  -- Renewal tracking
  renewal_due_date      date,
  renewal_services      text,
  renewal_notified      boolean default false,
  -- NOTE: days_until_renewal is calculated in queries as:
  -- (renewal_due_date - current_date)::integer
  -- It cannot be a generated column because current_date is not immutable

  -- ── COLD ESTATE AGENT FIELDS ───────────────────────────────
  cold_company_name     text,
  cold_address          text,
  cold_contact_name     text,
  zoopla_number         text,
  landline_number       text,
  direct_number         text,
  cold_email            text,
  email_verified        boolean default false,
  website               text
);

create index on public.leads (lead_type);
create index on public.leads (status);
create index on public.leads (assigned_to);
create index on public.leads (renewal_due_date) where renewal_due_date is not null;

create trigger leads_updated_at
  before update on public.leads
  for each row execute function update_updated_at();

alter table public.leads enable row level security;

create policy "Admins have full access to leads"
  on public.leads for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Reps can view their assigned leads"
  on public.leads for select
  using (assigned_to = auth.uid());

create policy "Reps can update their assigned leads"
  on public.leads for update
  using (assigned_to = auth.uid());

-- ── 2. CLIENTS TABLE ─────────────────────────────────────────
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  client_type     text not null default 'Landlord'
                    check (client_type in ('Landlord', 'Estate Agent', 'Care Home', 'Other')),
  assigned_to     uuid references public.profiles(id) on delete set null,
  company_name    text,
  first_name      text,
  last_name       text,
  email           text,
  phone           text,
  phone_2         text,
  whatsapp        text,
  street_address  text,
  city            text,
  postcode        text,
  billing_name    text,
  billing_email   text,
  billing_address text,
  billing_phone   text,
  status          text not null default 'Active'
                    check (status in ('Active', 'Inactive', 'VIP', 'Blacklisted')),
  source          text,
  notes           text,
  tags            text[],
  total_jobs      integer default 0,
  total_revenue   numeric default 0,
  lead_id         uuid references public.leads(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index on public.clients (client_type);
create index on public.clients (assigned_to);
create index on public.clients (email);
create index on public.clients (company_name);
create index on public.clients (created_at desc);

create trigger clients_updated_at
  before update on public.clients
  for each row execute function update_updated_at();

alter table public.clients enable row level security;

create policy "Admins have full access to clients"
  on public.clients for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Reps can view assigned clients"
  on public.clients for select
  using (assigned_to = auth.uid());

create policy "Reps can update assigned clients"
  on public.clients for update
  using (assigned_to = auth.uid());

create policy "Authenticated users can create clients"
  on public.clients for insert
  with check (auth.uid() is not null);

-- ── 3. JOBS TABLE — update statuses ──────────────────────────
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in (
    'In Progress',
    'Scheduled',
    'Paid',
    'Completed',
    'Certificate Delivered',
    'Cancelled'
  ));

update public.jobs set status = 'In Progress'           where status = 'Quote';
update public.jobs set status = 'Paid'                  where status = 'Invoiced';
update public.jobs set status = 'Certificate Delivered' where status = 'Paid';

alter table public.jobs drop column if exists client_id cascade;
alter table public.jobs add column client_id uuid references public.clients(id) on delete set null;
alter table public.jobs add column if not exists lead_id uuid references public.leads(id) on delete set null;
create index on public.jobs (client_id);
create index on public.jobs (lead_id);

-- ── 4. REP ACTIVITIES ────────────────────────────────────────
create table public.rep_activities (
  id          uuid primary key default gen_random_uuid(),
  rep_id      uuid not null references public.profiles(id) on delete cascade,
  rep_name    text not null,
  type        text not null check (type in ('call','email','outreach','meeting','note')),
  lead_id     uuid references public.leads(id) on delete set null,
  client_id   uuid references public.clients(id) on delete set null,
  content     text,
  created_at  timestamptz default now()
);

create index on public.rep_activities (rep_id, created_at desc);
create index on public.rep_activities (type);
create index on public.rep_activities (created_at desc);

alter table public.rep_activities enable row level security;

create policy "Admins see all activities"
  on public.rep_activities for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Reps see and log their own activities"
  on public.rep_activities for all
  using (rep_id = auth.uid());

-- ── 5. UPDATED FUNCTIONS ─────────────────────────────────────
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

create or replace function calculate_renewal_date(
  p_work_done text,
  p_job_date  date
) returns date language plpgsql as $$
declare
  v_earliest date := null;
  v_candidate date;
begin
  if p_work_done ilike '%FRA%' or p_work_done ilike '%Fire Risk%' then
    v_candidate := p_job_date + interval '1 year';
    if v_earliest is null or v_candidate < v_earliest then v_earliest := v_candidate; end if;
  end if;
  if p_work_done ilike '%GSC%' or p_work_done ilike '%CP12%' or p_work_done ilike '%Gas Safety%' then
    v_candidate := p_job_date + interval '1 year';
    if v_earliest is null or v_candidate < v_earliest then v_earliest := v_candidate; end if;
  end if;
  if p_work_done ilike '%EICR%' or p_work_done ilike '%Electrical%' then
    v_candidate := p_job_date + interval '5 years';
    if v_earliest is null or v_candidate < v_earliest then v_earliest := v_candidate; end if;
  end if;
  if p_work_done ilike '%EPC%' then
    v_candidate := p_job_date + interval '10 years';
    if v_earliest is null or v_candidate < v_earliest then v_earliest := v_candidate; end if;
  end if;
  if p_work_done ilike '%PAT%' then
    v_candidate := p_job_date + interval '1 year';
    if v_earliest is null or v_candidate < v_earliest then v_earliest := v_candidate; end if;
  end if;
  if p_work_done ilike '%FSC%' or p_work_done ilike '%Fire Safety Cert%' then
    v_candidate := p_job_date + interval '1 year';
    if v_earliest is null or v_candidate < v_earliest then v_earliest := v_candidate; end if;
  end if;
  return v_earliest;
end;
$$;

-- ── 6. REALTIME ───────────────────────────────────────────────
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.rep_activities;
