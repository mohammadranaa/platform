-- Security Phase 1 — role-by-role checks.
--
-- Run in the Supabase SQL editor (as postgres) AFTER applying the Phase 1
-- migrations. Everything runs inside BEGIN … ROLLBACK, so nothing is changed.
-- Each check prints a NOTICE starting with PASS or FAIL; it never aborts, so you
-- get the full list. Any FAIL means stop and roll back.

begin;

-- ── Fixtures (as postgres) ──────────────────────────────────────────
select set_config('t.moiz',    '46099c23-be41-4273-9bfa-ca4c6277ea43', true);
select set_config('t.mehwish', 'a11891f2-5748-4bbb-9439-f6d78b388721', true);
select set_config('t.asad',    '6c8546fd-d9e0-462d-ad74-3c3391884315', true);
select set_config('t.ali',     (select id::text from public.profiles where email = 'ali@mylandlordcertificate.co.uk'), true);
select set_config('t.portal',  (select auth_user_id::text from public.portal_users where auth_user_id is not null order by created_at limit 1), true);
select set_config('t.total_leads',     (select count(*)::text from public.leads), true);
select set_config('t.moiz_visible',    (select count(*)::text from public.leads
                                         where assigned_to = current_setting('t.moiz')::uuid
                                            or (lead_type = 'inbound' and assigned_to is null)), true);
select set_config('t.mehwish_leads',   (select count(*)::text from public.leads where assigned_to = current_setting('t.mehwish')::uuid), true);

do $$ begin
  if current_setting('t.ali', true) is null or current_setting('t.portal', true) is null then
    raise exception 'Fixture missing: Ali profile or a portal user not found';
  end if;
  raise notice 'Fixtures: total leads %, Moiz should see %, Mehwish owns %',
    current_setting('t.total_leads'), current_setting('t.moiz_visible'), current_setting('t.mehwish_leads');
end $$;


-- ── Moiz (rep) ──────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.moiz'), 'role', 'authenticated')::text, true);

do $$
declare n int; expected int := current_setting('t.moiz_visible')::int;
begin
  select count(*) into n from public.leads where assigned_to = current_setting('t.mehwish')::uuid;
  raise notice '% Moiz sees % of Mehwish''s leads (expected 0)', case when n = 0 then 'PASS' else 'FAIL' end, n;

  select count(*) into n from public.leads;
  raise notice '% Moiz sees % leads in total (expected % = own + unassigned inbound)',
    case when n = expected then 'PASS' else 'FAIL' end, n, expected;

  select count(*) into n from public.leads
   where not (assigned_to = current_setting('t.moiz')::uuid or (lead_type = 'inbound' and assigned_to is null));
  raise notice '% Moiz sees % leads outside his scope (expected 0)', case when n = 0 then 'PASS' else 'FAIL' end, n;

  select count(*) into n from public.leads_with_renewal where assigned_to = current_setting('t.mehwish')::uuid;
  raise notice '% leads_with_renewal shows Moiz % of Mehwish''s leads (expected 0)', case when n = 0 then 'PASS' else 'FAIL' end, n;

  select coalesce(sum(total), 0) into n from public.lead_type_counts();
  raise notice '% lead_type_counts() for Moiz = % (expected <= own scope %)',
    case when n <= expected then 'PASS' else 'FAIL' end, n, expected;
end $$;

do $$
declare n int;
begin
  begin
    update public.profiles set role = 'admin' where id = current_setting('t.moiz')::uuid;
    get diagnostics n = row_count;
    raise notice '% Moiz role->admin update affected % rows (expected an error or 0)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then
    raise notice 'PASS Moiz role->admin blocked: %', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    perform access_token from public.user_email_accounts limit 1;
    raise notice 'FAIL Moiz can select user_email_accounts.access_token';
  exception when insufficient_privilege then
    raise notice 'PASS Moiz denied access_token: %', sqlerrm;
  end;
  begin
    perform refresh_token from public.user_email_accounts limit 1;
    raise notice 'FAIL Moiz can select user_email_accounts.refresh_token';
  exception when insufficient_privilege then
    raise notice 'PASS Moiz denied refresh_token';
  end;
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.user_email_accounts where gmail_address is not null;
  raise notice '% Moiz can select gmail_address (% rows)', case when n > 0 then 'PASS' else 'FAIL' end, n;
  select count(*) into n from public.user_email_accounts where is_connected;
  raise notice '% Moiz can filter on is_connected (% connected)', case when n > 0 then 'PASS' else 'FAIL' end, n;
exception when others then
  raise notice 'FAIL Moiz inbox list query errored: %', sqlerrm;
end $$;

do $$
declare n int;
begin
  begin
    update public.user_email_accounts set is_active = is_active where profile_id = current_setting('t.mehwish')::uuid;
    get diagnostics n = row_count;
    raise notice '% Moiz updating Mehwish''s inbox affected % rows (expected 0)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  exception when others then
    raise notice 'PASS Moiz updating Mehwish''s inbox blocked: %', sqlerrm;
  end;
end $$;

reset role;


-- ── Portal user ─────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.portal'), 'role', 'authenticated')::text, true);

do $$
declare n int; t text;
begin
  foreach t in array array['leads', 'quotes', 'profiles', 'email_templates', 'lead_contacts', 'email_log', 'nuacom_calls', 'rep_kpi_targets'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise notice '% portal user sees % rows in % (expected 0)', case when n = 0 then 'PASS' else 'FAIL' end, n, t;
    exception when insufficient_privilege then
      raise notice 'PASS portal user denied on %', t;
    end;
  end loop;
end $$;

do $$
declare n int;
begin
  begin
    update public.portal_users set status = 'pending' where auth_user_id = current_setting('t.portal')::uuid;
    get diagnostics n = row_count;
    raise notice 'FAIL portal user changed own status (% rows)', n;
  exception when others then
    raise notice 'PASS portal user cannot change own status: %', sqlerrm;
  end;
  begin
    update public.portal_users set client_id = gen_random_uuid() where auth_user_id = current_setting('t.portal')::uuid;
    raise notice 'FAIL portal user changed own client_id';
  exception when others then
    raise notice 'PASS portal user cannot change own client_id: %', sqlerrm;
  end;
end $$;

reset role;

-- A pending user approving themselves (the attack the guard is for): flip the
-- fixture row to pending as postgres, then try as the portal user.
-- Clear the JWT first so auth.uid() is null and the guard/protect triggers allow it.
select set_config('request.jwt.claims', '', true);
update public.portal_users set status = 'pending' where auth_user_id = current_setting('t.portal')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.portal'), 'role', 'authenticated')::text, true);
do $$
begin
  update public.portal_users set status = 'approved' where auth_user_id = current_setting('t.portal')::uuid;
  raise notice 'FAIL pending portal user approved themselves';
exception when others then
  raise notice 'PASS pending portal user cannot approve themselves: %', sqlerrm;
end $$;
reset role;


-- ── Ali (admin) ─────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.ali'), 'role', 'authenticated')::text, true);

do $$
declare n int; expected int := current_setting('t.total_leads')::int;
begin
  select count(*) into n from public.leads;
  raise notice '% Ali sees % leads (expected all %)', case when n = expected then 'PASS' else 'FAIL' end, n, expected;
  select count(*) into n from public.rep_kpi_targets;
  raise notice '% Ali sees % KPI target rows', case when n > 0 then 'PASS' else 'FAIL' end, n;
end $$;

reset role;


-- ── anon (signed out, public key only) ──────────────────────────────
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int; t text;
begin
  foreach t in array array['rep_kpi_targets', 'leads_with_renewal', 'campaign_eligible_leads', 'user_email_accounts', 'leads', 'profiles'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise notice '% anon sees % rows in % (expected 0 or denied)', case when n = 0 then 'PASS' else 'FAIL' end, n, t;
    exception when insufficient_privilege then
      raise notice 'PASS anon denied on %', t;
    end;
  end loop;
  begin
    execute 'select count(*) from public.campaign_sending_accounts' into n;
    raise notice 'FAIL campaign_sending_accounts still exists (% rows)', n;
  exception when undefined_table then
    raise notice 'PASS campaign_sending_accounts is gone';
  end;
end $$;

reset role;


-- ── Structure (as postgres) ─────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
do $$
declare n int;
begin
  select count(*) into n from cron.job
   where jobname = 'daily-kpi-report' and schedule = '45 18,19 * * 1-5'
     and command like '%at time zone ''Europe/London'') = 19 then%';
  raise notice '% daily-kpi-report scheduled for 19:45 UK', case when n = 1 then 'PASS' else 'FAIL' end;

  select count(*) into n from pg_extension e join pg_namespace s on s.oid = e.extnamespace
   where e.extname = 'pg_trgm' and s.nspname = 'extensions';
  raise notice '% pg_trgm lives in schema extensions', case when n = 1 then 'PASS' else 'FAIL' end;

  -- trigram indexes still usable
  set local enable_seqscan = off;
  perform 1 from public.leads where cold_company_name ilike '%lettings%' limit 1;
  raise notice 'PASS trigram ILIKE query on leads runs';

  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prokind = 'f' and p.proconfig is null
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  raise notice '% % public functions left with a mutable search_path', case when n = 0 then 'PASS' else 'FAIL' end, n;
end $$;

rollback;
