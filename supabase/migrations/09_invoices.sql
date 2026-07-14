-- ============================================================
-- MLC PLATFORM — 09: INVOICES & QUOTES
-- ============================================================
create table public.invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_number   text not null,
  doc_type         text not null default 'invoice' check (doc_type in ('invoice', 'quote')),
  company          text not null default 'standard' check (company in ('standard', 'remedials')),

  client_id        uuid references public.clients(id) on delete set null,
  client_name      text,
  client_address   text,
  client_email     text,

  job_id           uuid references public.jobs(id) on delete set null,
  site_address     text,
  work_completed   text,

  line_items       jsonb not null default '[]'::jsonb,
  subtotal         numeric default 0,
  discount         numeric default 0,
  total            numeric default 0,
  amount_paid      numeric default 0,
  balance_due      numeric default 0,

  status           text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),

  created_by       uuid references public.profiles(id) on delete set null,
  created_by_name  text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function update_updated_at();

create index on public.invoices (client_id);
create index on public.invoices (job_id);
create index on public.invoices (doc_type);
create index on public.invoices (status);
create index on public.invoices (created_at desc);

alter table public.invoices enable row level security;
create policy "Auth users manage invoices" on public.invoices for all using (auth.uid() is not null);

alter publication supabase_realtime add table public.invoices;
