-- ============================================================
-- MLC PLATFORM — 04: COLD EMAIL ENGINE
-- ============================================================
create table public.inboxes (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid references public.profiles(id) on delete cascade,
  label                 text not null,
  email                 text not null unique,
  smtp_host             text not null,
  smtp_port             integer not null default 587,
  smtp_user             text not null,
  smtp_pass             text not null,
  is_active             boolean default true,
  warmup_enabled        boolean default true,
  warmup_start_limit    integer default 10,
  warmup_step           integer default 5,
  warmup_interval_days  integer default 3,
  warmup_max_limit      integer default 50,
  sent_today            integer default 0,
  last_reset_at         date default current_date,
  warmup_started_at     timestamptz default now(),
  created_at            timestamptz default now()
);

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references public.profiles(id) on delete cascade,
  name          text not null,
  target_type   text not null default 'cold_agent' check (target_type in ('cold_agent','verified','inbound','mixed')),
  status        text not null default 'draft' check (status in ('draft','active','paused','completed')),
  from_name     text not null,
  daily_limit   integer default 50,
  track_opens   boolean default true,
  track_clicks  boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create trigger campaigns_updated_at before update on public.campaigns for each row execute function update_updated_at();

create table public.campaign_inboxes (
  campaign_id uuid references public.campaigns(id) on delete cascade,
  inbox_id    uuid references public.inboxes(id) on delete cascade,
  primary key (campaign_id, inbox_id)
);

create table public.sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  step_number   integer not null,
  delay_days    integer not null default 0,
  subject       text not null,
  body_html     text not null,
  created_at    timestamptz default now(),
  unique (campaign_id, step_number)
);

create table public.campaign_contacts (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references public.campaigns(id) on delete cascade,
  client_id       uuid,
  email           text not null,
  first_name      text,
  last_name       text,
  company         text,
  custom_vars     jsonb default '{}',
  status          text not null default 'pending' check (status in ('pending','active','completed','unsubscribed','bounced','replied')),
  current_step    integer default 0,
  next_send_at    timestamptz,
  enrolled_at     timestamptz default now()
);
create index on public.campaign_contacts (campaign_id, status);
create index on public.campaign_contacts (next_send_at) where status = 'active';

create table public.email_sends (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references public.campaigns(id) on delete cascade,
  contact_id      uuid references public.campaign_contacts(id) on delete cascade,
  inbox_id        uuid references public.inboxes(id) on delete set null,
  step_number     integer not null,
  subject         text,
  status          text not null default 'sent' check (status in ('sent','opened','clicked','replied','bounced','failed')),
  open_count      integer default 0,
  click_count     integer default 0,
  opened_at       timestamptz,
  clicked_at      timestamptz,
  replied_at      timestamptz,
  tracking_id     uuid default gen_random_uuid(),
  sent_at         timestamptz default now()
);
create index on public.email_sends (tracking_id);
create index on public.email_sends (campaign_id, sent_at desc);

create or replace function record_open(p_tracking_id uuid)
returns void language plpgsql security definer as $$
begin
  update public.email_sends set open_count = open_count + 1, opened_at = coalesce(opened_at, now()), status = case when status = 'sent' then 'opened' else status end where tracking_id = p_tracking_id;
end;
$$;

alter table public.inboxes           enable row level security;
alter table public.campaigns         enable row level security;
alter table public.campaign_inboxes  enable row level security;
alter table public.sequence_steps    enable row level security;
alter table public.campaign_contacts enable row level security;
alter table public.email_sends       enable row level security;

create policy "Admins manage inboxes" on public.inboxes for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Admins manage campaigns" on public.campaigns for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Auth view campaigns" on public.campaigns for select using (auth.uid() is not null);
create policy "Admins manage steps" on public.sequence_steps for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Auth view steps" on public.sequence_steps for select using (auth.uid() is not null);
create policy "Admins manage campaign inboxes" on public.campaign_inboxes for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Admins manage contacts" on public.campaign_contacts for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Auth view contacts" on public.campaign_contacts for select using (auth.uid() is not null);
create policy "Admins manage sends" on public.email_sends for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Auth view sends" on public.email_sends for select using (auth.uid() is not null);

alter publication supabase_realtime add table public.campaigns;
alter publication supabase_realtime add table public.campaign_contacts;
alter publication supabase_realtime add table public.email_sends;
