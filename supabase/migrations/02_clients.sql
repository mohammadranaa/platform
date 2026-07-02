-- ============================================================
-- MLC PLATFORM — 02: CLIENTS
-- Run this SECOND in Supabase SQL Editor
-- Covers all 3 customer types in one unified table:
--   inbound    → booked via MLC website/WhatsApp/email
--   verified   → past customers from ServiceM8 job history
--   cold_agent → estate agents being cold outreached
-- ============================================================

-- Shared updated_at trigger function (used across all tables)
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),

  -- Which of the 3 types is this client
  customer_type       text not null
                        check (customer_type in ('inbound', 'verified', 'cold_agent')),

  -- ── Core contact info (all types) ──────────────────────────
  company_name        text,
  first_name          text,
  last_name           text,
  email               text,
  phone               text,
  phone_2             text,
  whatsapp            text,

  -- ── Address (all types) ────────────────────────────────────
  street_address      text,
  city                text,
  postcode            text,

  -- ── Billing contact (verified & cold_agent often differ) ───
  billing_name        text,
  billing_email       text,
  billing_address     text,
  billing_phone       text,

  -- ── Cold estate agent specific ─────────────────────────────
  website             text,
  zoopla_phone        text,   -- separate Zoopla listing number

  -- ── Inbound booking specific ───────────────────────────────
  -- These fields come directly from the MLC online booking form
  property_type       text,   -- residential / commercial
  property_subtype    text,   -- studio / 1-3bed / 4bed / hmo / flat
  services_requested  text,   -- raw string from form e.g. "EICR, GSC, PAT"
  appointment_date    date,
  time_slot           text,   -- Morning (8am–12pm) / Afternoon (12pm–6pm)
  quoted_price        numeric,
  payment_status      text,   -- Paid / Unpaid
  booking_status      text,   -- Completed / Pending Payment / Partial — Step N
  session_id          text,   -- unique form session ID for partial bookings

  -- ── CRM pipeline fields (all types) ────────────────────────
  status              text not null default 'New'
                        check (status in (
                          'New',
                          'Contacted',
                          'Qualified',
                          'Proposal Sent',
                          'Active Client',
                          'Closed Won',
                          'Closed Lost',
                          'Unsubscribed'
                        )),
  assigned_to         uuid references public.profiles(id) on delete set null,
  source              text,   -- website / whatsapp / email / cold-email / referral / servicem8-import
  tags                text[], -- e.g. ['hmo-landlord', 'repeat', 'high-value']
  notes               text,   -- free-text internal notes

  -- ── Lifetime stats (updated automatically) ─────────────────
  total_jobs          integer default 0,
  total_revenue       numeric default 0,

  -- ── Timestamps ─────────────────────────────────────────────
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Indexes for fast filtering
create index on public.clients (customer_type);
create index on public.clients (status);
create index on public.clients (assigned_to);
create index on public.clients (email);
create index on public.clients (company_name);
create index on public.clients (created_at desc);

-- Auto-update updated_at on every change
create trigger clients_updated_at
  before update on public.clients
  for each row execute function update_updated_at();

-- ── Row Level Security ──────────────────────────────────────

alter table public.clients enable row level security;

-- Admins see and do everything
create policy "Admins have full access to clients"
  on public.clients for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Reps see only their assigned clients
create policy "Reps can view their assigned clients"
  on public.clients for select
  using (assigned_to = auth.uid());

-- Reps can update their assigned clients
create policy "Reps can update their assigned clients"
  on public.clients for update
  using (assigned_to = auth.uid());

-- Any authenticated user can create a new client
create policy "Authenticated users can create clients"
  on public.clients for insert
  with check (auth.uid() is not null);

-- ── Realtime ────────────────────────────────────────────────
alter publication supabase_realtime add table public.clients;
