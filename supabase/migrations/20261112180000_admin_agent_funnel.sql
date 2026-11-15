-- The agent's funnel by day, for the admin's «Воронка» page.
--
-- Read only. The city's moments already land in `public.events` (`/api/track`, placement `agent`); anon may
-- only insert there, so the admin reads them through this one function, behind the beta secret
-- (`private.beta_check_secret`), like every admin read. It counts rows by day (UTC), moment and device and returns
-- nothing else: no ref beyond its device word, no path, no locale. Robots' visits (ref `<device>:bot` — our own walks
-- and shots) are left out of the rows and counted apart. No table, no column, no grant on `public.events` changes.

create or replace function public.admin_agent_funnel(p_secret text, p_days integer default 14)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 60);
  v_since timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc' - make_interval(days => v_days - 1);
begin
  perform private.beta_check_secret(p_secret);
  return jsonb_build_object(
    'since', (select min(e.created_at) from public.events e where e.placement = 'agent'),
    -- Robots' visits: one first screen each.
    'bots', (select count(*) from public.events e
              where e.placement = 'agent' and e.name = 'agent_home' and e.created_at >= v_since
                and split_part(coalesce(e.ref, ''), ':', 2) = 'bot'),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('day', t.day, 'name', t.name, 'device', t.device, 'n', t.n) order by t.day, t.name, t.device)
        from (
          select to_char(e.created_at at time zone 'utc', 'YYYY-MM-DD') as day,
                 e.name,
                 split_part(coalesce(e.ref, ''), ':', 1) as device,
                 count(*)::integer as n
            from public.events e
           where e.placement = 'agent'
             and e.created_at >= v_since
             and split_part(coalesce(e.ref, ''), ':', 1) in ('desk', 'phone', 'app')
             and split_part(coalesce(e.ref, ''), ':', 2) <> 'bot'
           group by 1, 2, 3
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_agent_funnel(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_agent_funnel(text, integer) to anon;
