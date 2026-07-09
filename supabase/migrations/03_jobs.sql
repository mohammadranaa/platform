-- ============================================================
-- MLC PLATFORM — 03: JOBS
-- ============================================================
create sequence if not exists job_number_seq start 1001;

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  job_number          text unique not null default ('J-' || to_char(nextval('job_number_seq'), 'FM00000')),
  client_id           uuid,
  lead_id             uuid,
  assigned_to         uuid references public.profiles(id) on delete set null,
  title               text not null,
  description         text,
  service_types       text[],
  job_type            text,
  priority            text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Emergency')),
  site_address        text,
  site_postcode       text,
  access_notes        text,
  tenant_name         text,
  tenant_phone        text,
  status              text not null default 'In Progress' check (status in ('In Progress','Scheduled','Paid','Completed','Certificate Delivered','Cancelled')),
  scheduled_date      date,
  scheduled_slot      text,
  completed_date      date,
  quoted_amount       numeric default 0,
  invoice_amount      numeric default 0,
  payment_amount      numeric default 0,
  payment_status      text not null default 'Unpaid' check (payment_status in ('Unpaid', 'Partial', 'Paid')),
  invoice_number      text,
  invoice_sent_date   date,
  paid_date           date,
  certificates_issued text[],
  certificate_notes   text,
  source              text,
  booking_session_id  text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index on public.jobs (client_id);
create index on public.jobs (lead_id);
create index on public.jobs (assigned_to);
create index on public.jobs (status);
create index on public.jobs (scheduled_date);
create index on public.jobs (created_at desc);

create trigger jobs_updated_at before update on public.jobs for each row execute function update_updated_at();

create table public.job_line_items (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  description   text not null,
  item_type     text not null check (item_type in ('certificate', 'labour', 'material', 'other')),
  quantity      numeric not null default 1,
  unit          text default 'ea',
  unit_price    numeric not null default 0,
  total         numeric generated always as (quantity * unit_price) stored,
  created_at    timestamptz default now()
);
create index on public.job_line_items (job_id);

create table public.job_diary (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  author_id     uuid references public.profiles(id) on delete set null,
  author_name   text not null,
  entry_type    text not null check (entry_type in ('note','call','email','whatsapp','status_change','system')),
  content       text not null,
  created_at    timestamptz default now()
);
create index on public.job_diary (job_id, created_at desc);

create table public.client_activities (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid,
  rep_id        uuid references public.profiles(id) on delete set null,
  rep_name      text not null,
  type          text not null check (type in ('note','call','email','whatsapp','meeting','status_change','job_created','invoice_sent','payment_received')),
  content       text not null,
  created_at    timestamptz default now()
);
create index on public.client_activities (client_id, created_at desc);

alter table public.jobs               enable row level security;
alter table public.job_line_items     enable row level security;
alter table public.job_diary          enable row level security;
alter table public.client_activities  enable row level security;

create policy "Admins full access jobs" on public.jobs for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Reps see assigned jobs" on public.jobs for select using (assigned_to = auth.uid());
create policy "Reps update assigned jobs" on public.jobs for update using (assigned_to = auth.uid());
create policy "Auth users create jobs" on public.jobs for insert with check (auth.uid() is not null);
create policy "Auth users manage line items" on public.job_line_items for all using (auth.uid() is not null);
create policy "Auth users manage job diary" on public.job_diary for all using (auth.uid() is not null);
create policy "Auth users manage activities" on public.client_activities for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_diary;
alter publication supabase_realtime add table public.client_activities;
alter publication supabase_realtime add table public.job_line_items;
