-- ============================================================
-- MLC PLATFORM — 01: PROFILES
-- ============================================================
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         text,
  role          text not null default 'rep' check (role in ('admin', 'rep', 'engineer')),
  phone         text,
  is_active     boolean default true,
  created_at    timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, coalesce(new.raw_user_meta_data->>'role', 'rep'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
create policy "All authenticated users can view profiles" on public.profiles for select using (auth.uid() is not null);
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id);
create policy "Admins can update any profile" on public.profiles for update using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
