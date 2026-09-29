-- Repo mirror of the migration applied to Supabase project `ryntra` (lbphobwqzwdkbmyedlwb).
-- CTA analytics events. Anon key may only INSERT (no read-back).

create table if not exists public.events (
  id bigint generated always as identity primary key,
  name text not null,
  placement text,
  locale text,
  path text,
  ref text,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "anon insert events" on public.events
  for insert to anon with check (true);

create index if not exists events_created_at_idx on public.events (created_at);
create index if not exists events_name_idx on public.events (name);
