-- ============================================================
-- MLC PLATFORM — 04: COLD EMAIL ENGINE
-- Run this FOURTH in Supabase SQL Editor
-- Covers: SMTP inboxes, campaigns, sequence steps,
--         enrolled contacts, send log, open tracking
--
-- Designed for MLC's cold outreach to estate agents
-- but can target any client type (inbound, verified, cold_agent)
-- ============================================================

-- ── SMTP Inboxes ─────────────────────────────────────────────
-- Each inbox = one sending email account
-- Warm-up: starts at warmup_start_limit emails/day,
--          increases by warmup_step every warmup_interval_days,
--          up to warmup_max_limit per day
-- Rotation: campaigns pick the least-used inbox under its limit

create table public.inboxes (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid references public.profiles(id) on delete cascade,

  -- Display
  label                 text not null,
  -- e.g. "outreach-01@mlcservices.co.uk"

  -- SMTP credentials
  email                 text not null unique,
  smtp_host             text not null,
  -- Gmail:   smtp.gmail.com
  -- Outlook: smtp.office365.com
  -- Custom:  mail.yourdomain.com
  smtp_port             integer not null default 587,
  -- 587 = TLS (recommended), 465 = SSL
  smtp_user             text not null,
  smtp_pass             text not null,
  -- Gmail: use an App Password, not your login password
  -- Google Account → Security → 2FA → App Passwords → Mail

  -- Status
  is_active             boolean default true,

  -- Warm-up configuration
  warmup_enabled        boolean default true,
  warmup_start_limit    integer default 10,   -- start with 10/day
  warmup_step           integer default 5,    -- add 5 more every interval
  warmup_interval_days  integer default 3,    -- step up every 3 days
  warmup_max_limit      integer default 50,   -- never send more than 50/day

  -- Runtime counters (reset daily by the Edge Function cron)
  sent_today            integer default 0,
  last_reset_at         date default current_date,

  warmup_started_at     timestamptz default now(),
  created_at            timestamptz default now()
);

-- ── Campaigns ────────────────────────────────────────────────
-- A campaign = a named outreach effort with a sequence of emails
-- target_type lets you know which segment you're going after

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references public.profiles(id) on delete cascade,

  name          text not null,
  -- e.g. "Q3 Estate Agent Outreach — London"

  target_type   text not null default 'cold_agent'
                  check (target_type in ('cold_agent', 'verified', 'inbound', 'mixed')),

  status        text not null default 'draft'
                  check (status in ('draft', 'active', 'paused', 'completed')),

  from_name     text not null,
  -- e.g. "James from MLC Services"

  daily_limit   integer default 50,
  -- Max emails per day across all inboxes for this campaign

  track_opens   boolean default true,
  track_clicks  boolean default true,

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create trigger campaigns_updated_at
  before update on public.campaigns
  for each row execute function update_updated_at();

-- ── Campaign ↔ Inbox (many-to-many) ─────────────────────────
-- Assign which inboxes rotate for each campaign

create table public.campaign_inboxes (
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  inbox_id      uuid references public.inboxes(id) on delete cascade,
  primary key (campaign_id, inbox_id)
);

-- ── Sequence Steps ───────────────────────────────────────────
-- Each step = one email in the drip sequence
-- delay_days is relative to the PREVIOUS step (or enrolment for step 1)
-- Supports {{first_name}}, {{company}}, {{email}} variables

create table public.sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns(id) on delete cascade,

  step_number   integer not null,
  -- 1 = first email, 2 = follow-up, 3 = final chase

  delay_days    integer not null default 0,
  -- Step 1: 0 (send immediately on enrolment)
  -- Step 2: 3 (send 3 days after step 1)
  -- Step 3: 7 (send 7 days after step 2)

  subject       text not null,
  body_html     text not null,
  -- Write plain text with line breaks — HTML supported
  -- Variables: {{first_name}} {{last_name}} {{company}} {{email}}

  created_at    timestamptz default now(),
  unique (campaign_id, step_number)
);

-- ── Campaign Contacts ─────────────────────────────────────────
-- Each row = one person enrolled in one campaign
-- Linked to clients table where possible (cold_agent records)
-- status tracks where they are in the sequence

create table public.campaign_contacts (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references public.campaigns(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  -- Null if contact was imported directly without a client record

  -- Contact details (copied at enrolment time)
  email           text not null,
  first_name      text,
  last_name       text,
  company         text,
  custom_vars     jsonb default '{}',
  -- Any extra variables for template personalisation
  -- e.g. {"area": "North London", "service": "EICR"}

  -- Sequence tracking
  status          text not null default 'pending'
                    check (status in (
                      'pending',       -- enrolled, not yet started
                      'active',        -- sequence in progress
                      'completed',     -- all steps sent
                      'unsubscribed',  -- opted out
                      'bounced',       -- email bounced
                      'replied'        -- they replied — pause sequence
                    )),
  current_step    integer default 0,
  next_send_at    timestamptz,

  enrolled_at     timestamptz default now()
);

create index on public.campaign_contacts (campaign_id, status);
create index on public.campaign_contacts (next_send_at) where status = 'active';
create index on public.campaign_contacts (client_id);

-- ── Email Send Log ────────────────────────────────────────────
-- Every email sent is recorded here
-- tracking_id is embedded in the 1×1 open-tracking pixel URL
-- and in every link for click tracking

create table public.email_sends (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references public.campaigns(id) on delete cascade,
  contact_id      uuid references public.campaign_contacts(id) on delete cascade,
  inbox_id        uuid references public.inboxes(id) on delete set null,

  step_number     integer not null,
  subject         text,

  status          text not null default 'sent'
                    check (status in (
                      'sent',
                      'opened',
                      'clicked',
                      'replied',
                      'bounced',
                      'failed'
                    )),

  -- Tracking counters
  open_count      integer default 0,
  click_count     integer default 0,
  opened_at       timestamptz,   -- first open time
  clicked_at      timestamptz,   -- first click time
  replied_at      timestamptz,

  -- Unique ID embedded in tracking pixel and links
  tracking_id     uuid default gen_random_uuid(),

  sent_at         timestamptz default now()
);

create index on public.email_sends (tracking_id);
create index on public.email_sends (campaign_id, sent_at desc);
create index on public.email_sends (contact_id);

-- ── Helper: record an open (called by track-open Edge Function) ──
create or replace function record_open(p_tracking_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.email_sends
  set
    open_count = open_count + 1,
    opened_at  = coalesce(opened_at, now()),
    status     = case when status = 'sent' then 'opened' else status end
  where tracking_id = p_tracking_id;
end;
$$;

-- ── Row Level Security ────────────────────────────────────────

alter table public.inboxes            enable row level security;
alter table public.campaigns          enable row level security;
alter table public.campaign_inboxes   enable row level security;
alter table public.sequence_steps     enable row level security;
alter table public.campaign_contacts  enable row level security;
alter table public.email_sends        enable row level security;

-- Inboxes — admin only (SMTP passwords are sensitive)
create policy "Admins manage inboxes"
  on public.inboxes for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- Campaigns — admins manage, reps can view active ones
create policy "Admins manage campaigns"
  on public.campaigns for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Authenticated users can view campaigns"
  on public.campaigns for select
  using (auth.uid() is not null);

-- Steps — admins manage, authenticated users can read
create policy "Admins manage sequence steps"
  on public.sequence_steps for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Authenticated users can view sequence steps"
  on public.sequence_steps for select
  using (auth.uid() is not null);

-- Campaign inboxes
create policy "Admins manage campaign inboxes"
  on public.campaign_inboxes for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

-- Contacts — admins manage, reps can view
create policy "Admins manage campaign contacts"
  on public.campaign_contacts for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Authenticated users can view contacts"
  on public.campaign_contacts for select
  using (auth.uid() is not null);

-- Sends — admins manage, authenticated users can view
create policy "Admins manage email sends"
  on public.email_sends for all
  using (exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Authenticated users can view sends"
  on public.email_sends for select
  using (auth.uid() is not null);

-- ── Realtime ─────────────────────────────────────────────────
alter publication supabase_realtime add table public.campaigns;
alter publication supabase_realtime add table public.campaign_contacts;
alter publication supabase_realtime add table public.email_sends;
