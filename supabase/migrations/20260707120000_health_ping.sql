-- Cheap secret-gated liveness probe for /api/health (proves DB + RPC layer + secret all work).
create or replace function public.health_ping(p_secret text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.beta_check_secret(p_secret);
  return 'ok';
end $$;

grant execute on function public.health_ping(text) to anon;
