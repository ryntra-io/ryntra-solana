-- A stand-in for the parts of the Supabase database the world migration
-- stands on, for checking it on a throwaway local PostgreSQL. Never run
-- against a real project.
\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create function private.beta_check_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is distinct from 'world-test-secret' then
    raise exception 'forbidden';
  end if;
end;
$$;

create table public.beta_users (
  id uuid primary key,
  telegram_id bigint unique
);

-- The default grants Supabase gives every new table and function, so the
-- migration has to take them away itself.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema private grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema private grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema private grant all on sequences to anon, authenticated, service_role;
