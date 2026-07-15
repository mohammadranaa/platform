-- ============================================================
-- MLC PLATFORM — 10: UNIFIED ACTIVITIES & EMAIL LOG
-- ============================================================

-- ── Activities (replaces separate client/rep activity feeds) ──
create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references public.leads(id) on delete set null,
  client_id     uuid references public.clients(id) on delete set null,
  job_id        uuid references public.jobs(id) on delete set null,
  rep_id        uuid references public.profiles(id) on delete set null,
  rep_name      text,
  activity_type text not null
                  check (activity_type in (
                    'note', 'call', 'email', 'whatsapp', 'sms', 'meeting',
                    'status_change', 'assignment', 'invoice_sent', 'payment_received',
                    'certificate_issued', 'google_review_requested', 'system'
                  )),
  title         text,
  body          text,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

create index on public.activities (lead_id);
create index on public.activities (client_id);
create index on public.activities (job_id);
create index on public.activities (created_at desc);

alter table public.activities enable row level security;
create policy "Auth users manage activities" on public.activities for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.activities;

-- ── Email log (records every email sent from the platform) ────
create table public.email_log (
  id             uuid primary key default gen_random_uuid(),
  sent_by        uuid references public.profiles(id) on delete set null,
  sent_by_name   text,
  inbox_id       uuid references public.inboxes(id) on delete set null,
  lead_id        uuid references public.leads(id) on delete set null,
  client_id      uuid references public.clients(id) on delete set null,
  job_id         uuid references public.jobs(id) on delete set null,
  to_email       text not null,
  to_name        text,
  subject        text not null,
  body           text,
  template_id    uuid references public.email_templates(id) on delete set null,
  template_name  text,
  status         text not null default 'sent',
  created_at     timestamptz default now()
);

create index on public.email_log (lead_id);
create index on public.email_log (client_id);
create index on public.email_log (job_id);
create index on public.email_log (created_at desc);

alter table public.email_log enable row level security;
create policy "Auth users manage email log" on public.email_log for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.email_log;
