-- ============================================================
-- MLC PLATFORM — 11: NUACOM CALL LOG
-- ============================================================
create table public.nuacom_calls (
  id                        uuid primary key default gen_random_uuid(),
  nuacom_call_id            text not null unique,
  call_direction            text,
  call_status               text,
  call_answered             boolean,
  call_terminated           boolean,
  call_caller_name          text,
  call_caller_number        text,
  call_caller_number_local  text,
  call_callee_name          text,
  call_callee_number        text,
  call_callee_number_local  text,
  call_answered_by          text,
  call_initiated_by         text,
  call_in_queue             text,
  call_at                   timestamptz,
  started_at_unix           bigint,
  recording_url             text,
  duration_seconds          integer,
  raw_payload               jsonb,
  matched_lead_id           uuid references public.leads(id) on delete set null,
  matched_client_id         uuid references public.clients(id) on delete set null,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);

create trigger nuacom_calls_updated_at
  before update on public.nuacom_calls
  for each row execute function update_updated_at();

create index on public.nuacom_calls (matched_lead_id);
create index on public.nuacom_calls (matched_client_id);
create index on public.nuacom_calls (created_at desc);

alter table public.nuacom_calls enable row level security;
create policy "Auth users manage nuacom calls" on public.nuacom_calls for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.nuacom_calls;
