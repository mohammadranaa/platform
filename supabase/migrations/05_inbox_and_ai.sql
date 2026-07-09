-- ============================================================
-- MLC PLATFORM — 05: INBOX & AI
-- ============================================================
create table public.user_email_accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  gmail_address   text not null,
  display_name    text,
  access_token    text,
  refresh_token   text not null,
  token_expiry    timestamptz,
  pubsub_topic    text,
  history_id      text,
  watch_expiry    timestamptz,
  is_active       boolean default true,
  connected_at    timestamptz default now(),
  unique (user_id, gmail_address)
);

create table public.email_threads (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid references public.user_email_accounts(id) on delete cascade,
  client_id           uuid,
  campaign_contact_id uuid references public.campaign_contacts(id) on delete set null,
  gmail_thread_id     text unique,
  subject             text,
  participants        text[],
  last_message_at     timestamptz,
  message_count       integer default 0,
  has_unread          boolean default false,
  is_starred          boolean default false,
  thread_type         text default 'outbound' check (thread_type in ('outbound','inbound','campaign')),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index on public.email_threads (account_id, last_message_at desc);
create index on public.email_threads (gmail_thread_id);
create trigger email_threads_updated_at before update on public.email_threads for each row execute function update_updated_at();

create table public.email_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references public.email_threads(id) on delete cascade,
  gmail_message_id text unique,
  from_address     text not null,
  from_name        text,
  to_addresses     text[],
  cc_addresses     text[],
  subject          text,
  body_text        text,
  body_html        text,
  direction        text not null check (direction in ('inbound','outbound')),
  is_read          boolean default false,
  ai_assisted      boolean default false,
  sent_at          timestamptz,
  received_at      timestamptz,
  created_at       timestamptz default now()
);
create index on public.email_messages (thread_id, created_at asc);

create table public.ai_drafts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles(id) on delete cascade,
  context_type  text not null check (context_type in ('client_email','job_email','campaign_step','inbox_compose','sidebar_chat')),
  context_id    uuid,
  prompt        text,
  response      text,
  was_used      boolean default false,
  created_at    timestamptz default now()
);

alter table public.user_email_accounts enable row level security;
alter table public.email_threads       enable row level security;
alter table public.email_messages      enable row level security;
alter table public.ai_drafts           enable row level security;

create policy "Users manage own email accounts" on public.user_email_accounts for all using (user_id = auth.uid());
create policy "Admins view all email accounts" on public.user_email_accounts for select using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
create policy "Users see own threads" on public.email_threads for all using (account_id in (select id from public.user_email_accounts where user_id = auth.uid()));
create policy "Users see messages in own threads" on public.email_messages for all using (thread_id in (select et.id from public.email_threads et join public.user_email_accounts uea on et.account_id = uea.id where uea.user_id = auth.uid()));
create policy "Users see own AI drafts" on public.ai_drafts for all using (user_id = auth.uid());

alter publication supabase_realtime add table public.email_threads;
alter publication supabase_realtime add table public.email_messages;
