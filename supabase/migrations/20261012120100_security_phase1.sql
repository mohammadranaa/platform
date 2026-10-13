-- Security Phase 1 — database lockdown.
--
-- Apply AFTER 19:45 UK, and only after:
--   1. 20261012120000_security_phase1a_is_connected.sql is applied, and
--   2. the Phase 1 front-end commit is live on Vercel (explicit user_email_accounts
--      column lists + .eq('is_connected', true)); otherwise select('*') on that
--      table starts failing with "permission denied" in step 5.
--
-- Rollback: supabase/rollbacks/20261012120100_security_phase1_ROLLBACK.sql
-- Tests:    supabase/tests/security_phase1.sql
--
-- Runs as one transaction: any error leaves the database exactly as it was.

begin;

-- ═══════════════════════════════════════════════════════════════════
-- 1. Helper functions
-- ═══════════════════════════════════════════════════════════════════
-- SECURITY DEFINER so they can read profiles without tripping profiles' own RLS.
-- Portal users have no profiles row (handle_new_user skips them), so is_staff()
-- is false for them.

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid())) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin') $$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = ''
as $$ select role from public.profiles where id = (select auth.uid()) $$;

revoke all on function public.is_staff(), public.is_admin(), public.my_role() from public, anon;
grant execute on function public.is_staff(), public.is_admin(), public.my_role() to authenticated, service_role;


-- ═══════════════════════════════════════════════════════════════════
-- 2. handle_new_user — role is always 'rep', never taken from metadata
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  -- Portal signups (tagged via raw_user_meta_data at signUp() time) must
  -- never get a staff profile.
  if new.raw_user_meta_data->>'signup_type' = 'portal' then
    return new;
  end if;

  -- Role is hard-coded: anyone could put {"role":"admin"} in signUp() metadata.
  -- Admins promote people manually from the dashboard.
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    'rep'
  );
  return new;
end;
$function$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. profiles — staff-only read, no self-promotion
-- ═══════════════════════════════════════════════════════════════════

drop policy "All authenticated can view profiles" on public.profiles;
create policy "Staff read profiles" on public.profiles
  for select to authenticated
  using ((select public.is_staff()));

drop policy "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select public.my_role()));

drop policy "Admins can update any profile" on public.profiles;
create policy "Admins manage profiles" on public.profiles
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.profiles_block_role_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- auth.uid() is null for the service role and the SQL editor: allowed.
  if (select auth.uid()) is not null
     and new.role is distinct from old.role
     and not public.is_admin() then
    raise exception 'Only admins can change a profile role' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_block_role_change() from public, anon, authenticated;

create trigger profiles_block_role_change
  before update on public.profiles
  for each row execute function public.profiles_block_role_change();


-- ═══════════════════════════════════════════════════════════════════
-- 4. portal_users — portal users cannot approve or re-link themselves
-- ═══════════════════════════════════════════════════════════════════
-- Already in place and kept:
--   * "Authenticated users can sign up" INSERT policy enforces status='pending',
--     client_id IS NULL, approved_at/approved_by NULL.
--   * protect_portal_users_admin_fields() silently reverts status/client_id/
--     approved_* for non-staff.
-- Added: an explicit guard that RAISES instead (fires first: triggers run in name
-- order and "portal_users_guard" < "portal_users_protect_admin_fields"), and also
-- covers id and auth_user_id.

create or replace function public.portal_users_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_staff() then
    if new.id           is distinct from old.id
    or new.auth_user_id is distinct from old.auth_user_id
    or new.status       is distinct from old.status
    or new.client_id    is distinct from old.client_id
    or new.approved_at  is distinct from old.approved_at
    or new.approved_by  is distinct from old.approved_by then
      raise exception 'Portal users cannot change id, auth_user_id, status, client_id or approval fields'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.portal_users_guard() from public, anon, authenticated;

create trigger portal_users_guard
  before update on public.portal_users
  for each row execute function public.portal_users_guard();

drop policy "Agent can update own portal_users row" on public.portal_users;
create policy "Agent can update own portal_users row" on public.portal_users
  for update to authenticated
  using ((select auth.uid()) = auth_user_id)
  with check ((select auth.uid()) = auth_user_id);


-- ═══════════════════════════════════════════════════════════════════
-- 5. user_email_accounts — OAuth tokens never reach the browser
-- ═══════════════════════════════════════════════════════════════════
-- Owner column: profile_id is the person the inbox belongs to (cold inboxes all
-- have user_id = Ali, profile_id = the rep). Ownership checks accept either.

-- Exposed access_token/refresh_token to every signed-in user, bypassing RLS.
-- Not referenced anywhere in src/ or supabase/ (grep checked 12 Oct).
-- "if exists": the hotfix 20261012115900 may already have dropped it.
drop view if exists public.campaign_sending_accounts;

-- is_connected is added by 20261012120000_security_phase1a_is_connected.sql.

revoke all on public.user_email_accounts from anon;
revoke select, update, truncate, references, trigger on public.user_email_accounts from authenticated;

do $$
declare cols text;
begin
  -- SELECT: every column except the three token columns (built, not hand-typed)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'user_email_accounts'
    and column_name not in ('access_token', 'refresh_token', 'token_expiry');
  execute format('grant select (%s) on public.user_email_accounts to authenticated', cols);
end $$;

-- UPDATE: only the non-token fields the UI (or an admin) edits. Today the UI only
-- writes is_active (EmailInbox/ColdInbox "disconnect").
grant update (is_active, is_paused, paused_reason, paused_at, display_name,
              send_as_email, send_as_name, needs_reconnect, reconnect_reason)
  on public.user_email_accounts to authenticated;

drop policy "Internal staff full access email accounts" on public.user_email_accounts;
create policy "Staff read email accounts" on public.user_email_accounts
  for select to authenticated
  using ((select public.is_staff()));
create policy "Admins manage email accounts" on public.user_email_accounts
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Owners update own email accounts" on public.user_email_accounts
  for update to authenticated
  using (profile_id = (select auth.uid()) or user_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()) or user_id = (select auth.uid()));
-- No INSERT/DELETE for non-admins: gmail-oauth and every other writer uses the
-- service role, which bypasses RLS.


-- ═══════════════════════════════════════════════════════════════════
-- 6. Tables that only checked "auth.uid() IS NOT NULL" → staff only
-- ═══════════════════════════════════════════════════════════════════
-- None of these tables has a portal-facing policy. lead_contacts is handled in
-- step 7 (lead-scoped instead of plain staff).

drop policy "Auth full access activity_log" on public.activity_log;
create policy "Staff full access" on public.activity_log
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth users manage activities" on public.client_activities;
create policy "Staff full access" on public.client_activities
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth full access document_settings" on public.document_settings;
create policy "Staff full access" on public.document_settings
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "All authenticated can view email log" on public.email_log;
drop policy "Auth users manage email log" on public.email_log;
create policy "Staff full access" on public.email_log
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Authenticated full access email_templates" on public.email_templates;
create policy "Staff full access" on public.email_templates
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth users manage inbound jobs" on public.inbound_jobs;
create policy "Staff full access" on public.inbound_jobs
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth full access job_line_items" on public.job_line_items;
create policy "Staff full access" on public.job_line_items
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth full access nuacom_calls" on public.nuacom_calls;
create policy "Staff full access" on public.nuacom_calls
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth full access quote_items" on public.quote_line_items;
create policy "Staff full access" on public.quote_line_items
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

drop policy "Auth full access quotes" on public.quotes;
create policy "Staff full access" on public.quotes
  for all to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));


-- ═══════════════════════════════════════════════════════════════════
-- 7. leads — per-rep scoping enforced in the database
-- ═══════════════════════════════════════════════════════════════════
-- Reps: own leads + unassigned inbound leads; may pick up an unassigned lead,
-- may not read or reassign another rep's lead. Finance: read-only. Admins: all.

drop policy "Internal staff full access leads" on public.leads;

create policy "Admins all leads" on public.leads
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Finance read leads" on public.leads
  for select to authenticated
  using ((select public.my_role()) = 'finance');

create policy "Reps own leads" on public.leads
  for all to authenticated
  using (
    (select public.my_role()) = 'rep'
    and (assigned_to = (select auth.uid()) or (lead_type = 'inbound' and assigned_to is null))
  )
  with check (
    (select public.my_role()) = 'rep'
    and (assigned_to = (select auth.uid()) or assigned_to is null)
  );

-- Child tables: a row tied to a lead is visible only if the caller can see that
-- lead. The EXISTS subquery runs under the caller's leads policies above.

drop policy "Auth full access lead_contacts" on public.lead_contacts;
create policy "Staff access via visible lead" on public.lead_contacts
  for all to authenticated
  using ((select public.is_staff()) and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_contacts.lead_id)))
  with check ((select public.is_staff()) and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_contacts.lead_id)));

-- activities: client/job rows unchanged (staff); lead rows follow the lead.
-- "Portal users read own lead activities" is kept as is.
drop policy "Internal staff full access activities" on public.activities;
create policy "Staff access via visible lead" on public.activities
  for all to authenticated
  using ((select public.is_staff()) and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id)))
  with check ((select public.is_staff()) and (lead_id is null or exists (select 1 from public.leads l where l.id = activities.lead_id)));

-- lead_type_counts() is already SECURITY INVOKER (not DEFINER), so with the
-- policies above it counts only the caller's visible leads. Only pin its search_path.
alter function public.lead_type_counts() set search_path = '';


-- ═══════════════════════════════════════════════════════════════════
-- 8. rep_kpi_targets — had RLS disabled and full anon grants
-- ═══════════════════════════════════════════════════════════════════
-- sheets-push and daily-kpi-report read it with the service role (checked 12 Oct).

alter table public.rep_kpi_targets enable row level security;
revoke all on public.rep_kpi_targets from anon;

create policy "Admins manage KPI targets" on public.rep_kpi_targets
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "Reps read own KPI targets" on public.rep_kpi_targets
  for select to authenticated
  using (profile_id = (select auth.uid()));


-- ═══════════════════════════════════════════════════════════════════
-- 9. Linter clean-up
-- ═══════════════════════════════════════════════════════════════════

-- Views run with the caller's permissions, so leads policies apply through them.
alter view public.campaign_eligible_leads set (security_invoker = true);
alter view public.leads_with_renewal      set (security_invoker = true);
revoke all on public.campaign_eligible_leads, public.leads_with_renewal from anon;  -- no-op if the hotfix ran

-- Mutable search_path → pinned to 'public, extensions'. That is the search_path
-- these functions already run with today (Supabase's default for API roles), so
-- no body needs rewriting and none of the email-engine / Stripe / trigger logic
-- changes. ('' was used only for the new or rewritten functions above.)
alter function public.bulk_insert_contacts(jsonb)                          set search_path = public, extensions;
alter function public.calculate_renewal_date(text, date)                   set search_path = public, extensions;
alter function public.campaign_contact_dedupe()                            set search_path = public, extensions;
alter function public.increment_campaign_opens(uuid)                       set search_path = public, extensions;
alter function public.increment_campaign_replied(uuid)                     set search_path = public, extensions;
alter function public.increment_campaign_sent(uuid)                        set search_path = public, extensions;
alter function public.log_invoice_changes()                                set search_path = public, extensions;
alter function public.log_job_changes()                                    set search_path = public, extensions;
alter function public.match_phone(text)                                    set search_path = public, extensions;
alter function public.normalise_phone(text)                                set search_path = public, extensions;
alter function public.normalize_certificate_type()                         set search_path = public, extensions;
alter function public.notify_mentioned_users()                             set search_path = public, extensions;
alter function public.notify_on_call()                                     set search_path = public, extensions;
alter function public.pause_campaign_on_lead_status_change()               set search_path = public, extensions;
alter function public.personalise_email(text, text, text, text, text)      set search_path = public, extensions;
alter function public.pick_campaign_inbox(uuid)                            set search_path = public, extensions;
alter function public.property_match_key(text, text)                       set search_path = public, extensions;
alter function public.protect_portal_users_admin_fields()                  set search_path = public, extensions;
alter function public.record_open(uuid)                                    set search_path = public, extensions;
alter function public.search_by_phone(text)                                set search_path = public, extensions;
alter function public.set_portal_users_updated_at()                        set search_path = public, extensions;
alter function public.set_quote_number()                                   set search_path = public, extensions;
alter function public.sync_client_totals(uuid)                             set search_path = public, extensions;
alter function public.sync_job_payment_from_invoices()                     set search_path = public, extensions;
alter function public.trg_lead_accepted_insert()                           set search_path = public, extensions;
alter function public.trg_lead_accepted_update()                           set search_path = public, extensions;
alter function public.update_updated_at()                                  set search_path = public, extensions;

-- SECURITY DEFINER functions: nobody but the service role by default.
-- Trigger functions need no EXECUTE grant (checked only at CREATE TRIGGER).
revoke execute on function
  public.bulk_insert_contacts(jsonb),
  public.bump_lead_last_contacted(),
  public.certificates_assign_property(),
  public.convert_accepted_lead(public.leads),
  public.find_or_create_property(uuid, text, text),
  public.handle_new_user(),
  public.increment_campaign_opens(uuid),
  public.increment_campaign_replied(uuid),
  public.increment_campaign_sent(uuid),
  public.jobs_assign_property(),
  public.jobs_sync_certificate_property(),
  public.log_invoice_changes(),
  public.log_job_changes(),
  public.match_phone(text),
  public.notify_mentioned_users(),
  public.notify_on_call(),
  public.pause_campaign_on_lead_status_change(),
  public.pick_campaign_inbox(uuid),
  public.portal_client_ids(),
  public.record_open(uuid),
  public.search_by_phone(text),
  public.sync_in_campaign_flag(),
  public.sync_job_payment_from_invoices(),
  public.sync_lead_engagement(),
  public.trg_lead_accepted_insert(),
  public.trg_lead_accepted_update(),
  public.trg_notify_job_assigned()
from public, anon, authenticated;

-- Called from the browser (rpc) or from RLS policies:
--   search_by_phone  → GlobalSearch.jsx
--   match_phone      → IncomingCallPopup.jsx, NuacomDialer.jsx (not on the plan's list,
--                      but revoking it would break the incoming-call popup)
--   bulk_insert_contacts, portal_client_ids (portal policies)
-- lead_type_counts is SECURITY INVOKER and keeps its default grants.
grant execute on function
  public.search_by_phone(text),
  public.match_phone(text),
  public.bulk_insert_contacts(jsonb),
  public.portal_client_ids()
to authenticated;

-- The service role keeps everything (send-sequences/track-open call record_open,
-- increment_campaign_*, pick_campaign_inbox).
grant execute on function
  public.bulk_insert_contacts(jsonb),
  public.bump_lead_last_contacted(),
  public.certificates_assign_property(),
  public.convert_accepted_lead(public.leads),
  public.find_or_create_property(uuid, text, text),
  public.handle_new_user(),
  public.increment_campaign_opens(uuid),
  public.increment_campaign_replied(uuid),
  public.increment_campaign_sent(uuid),
  public.jobs_assign_property(),
  public.jobs_sync_certificate_property(),
  public.log_invoice_changes(),
  public.log_job_changes(),
  public.match_phone(text),
  public.notify_mentioned_users(),
  public.notify_on_call(),
  public.pause_campaign_on_lead_status_change(),
  public.pick_campaign_inbox(uuid),
  public.portal_client_ids(),
  public.record_open(uuid),
  public.search_by_phone(text),
  public.sync_in_campaign_flag(),
  public.sync_job_payment_from_invoices(),
  public.sync_lead_engagement(),
  public.trg_lead_accepted_insert(),
  public.trg_lead_accepted_update(),
  public.trg_notify_job_assigned()
to service_role;

-- pg_trgm out of public. GIN indexes reference the opclass by OID and keep working;
-- nothing in public calls similarity()/% (checked 12 Oct), and the API roles'
-- search_path already includes extensions.
alter extension pg_trgm set schema extensions;


-- ═══════════════════════════════════════════════════════════════════
-- 10. Cron — daily-kpi-report at 19:45 UK all year
-- ═══════════════════════════════════════════════════════════════════
-- Same London-hour gate as daily-sheets-push. The command is rewritten in place so
-- the service-role JWT it contains is never copied into this file.

select cron.alter_job(
  job_id   := jobid,
  schedule := '45 18,19 * * 1-5',
  command  := replace(replace(command,
                '-- 6 PM UK time all year: fires at 17:00 and 18:00 UTC, sends only when it is 18:00 in London',
                '-- 19:45 UK all year: fires at 18:45 and 19:45 UTC, sends only when it is 19:xx in London'),
                'at time zone ''Europe/London'') = 18 then',
                'at time zone ''Europe/London'') = 19 then')
)
from cron.job
where jobname = 'daily-kpi-report'
  and command like '%at time zone ''Europe/London'') = 18 then%';

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'daily-kpi-report'
                 and schedule = '45 18,19 * * 1-5'
                 and command like '%at time zone ''Europe/London'') = 19 then%') then
    raise exception 'daily-kpi-report cron was not updated (command changed since 12 Oct?)';
  end if;
end $$;

commit;
