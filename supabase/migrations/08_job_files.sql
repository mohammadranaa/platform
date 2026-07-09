-- ============================================================
-- MLC PLATFORM — 08: JOB FILES (CERTIFICATES + PHOTOS)
-- ============================================================
create table public.job_files (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  uploader_name text,
  file_type     text not null check (file_type in ('certificate', 'photo')),
  file_name     text not null,
  storage_path  text not null,
  file_size     bigint,
  mime_type     text,
  caption       text,
  created_at    timestamptz default now()
);

create index on public.job_files (job_id, file_type);
create index on public.job_files (job_id, created_at desc);

alter table public.job_files enable row level security;
create policy "Auth users manage job files" on public.job_files for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.job_files;
