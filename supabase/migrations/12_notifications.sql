-- ============================================================
-- MLC PLATFORM — 12: NOTIFICATIONS
-- ============================================================
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  type        text not null default 'system',
  title       text not null,
  body        text,
  link        text,
  is_read     boolean default false,
  created_at  timestamptz default now()
);

create index on public.notifications (created_at desc);
create index on public.notifications (is_read);

alter table public.notifications enable row level security;
create policy "Auth users manage notifications" on public.notifications for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.notifications;
