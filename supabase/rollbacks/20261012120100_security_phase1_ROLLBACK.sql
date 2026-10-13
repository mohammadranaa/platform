-- ROLLBACK for supabase/migrations/20261012120100_security_phase1.sql
--
-- Restores the policies, grants, functions, views, extension schema and cron job
-- exactly as captured from the live database on 12 Oct 2026 (pg_policies,
-- pg_get_functiondef, pg_get_viewdef, information_schema grants, cron.job).
--
-- Kept in supabase/rollbacks/ (NOT migrations/) so `supabase db push` never runs it.
--
-- Not reverted on purpose:
--   * user_email_accounts.is_connected (from phase1a) stays: it is harmless and the
--     Phase 1 front end filters on it. Drop it only after reverting the front end:
--       alter table public.user_email_accounts drop column is_connected;

begin;

-- ── 10. Cron back to 18:00 UK ──────────────────────────────────────
select cron.alter_job(
  job_id   := jobid,
  schedule := '0 17,18 * * 1-5',
  command  := replace(replace(command,
                '-- 19:45 UK all year: fires at 18:45 and 19:45 UTC, sends only when it is 19:xx in London',
                '-- 6 PM UK time all year: fires at 17:00 and 18:00 UTC, sends only when it is 18:00 in London'),
                'at time zone ''Europe/London'') = 19 then',
                'at time zone ''Europe/London'') = 18 then')
)
from cron.job where jobname = 'daily-kpi-report';

-- ── 9. Linter clean-up ─────────────────────────────────────────────
alter extension pg_trgm set schema public;

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
to public, anon, authenticated, service_role;

alter function public.bulk_insert_contacts(jsonb)                          reset search_path;
alter function public.calculate_renewal_date(text, date)                   reset search_path;
alter function public.campaign_contact_dedupe()                            reset search_path;
alter function public.increment_campaign_opens(uuid)                       reset search_path;
alter function public.increment_campaign_replied(uuid)                     reset search_path;
alter function public.increment_campaign_sent(uuid)                        reset search_path;
alter function public.log_invoice_changes()                                reset search_path;
alter function public.log_job_changes()                                    reset search_path;
alter function public.match_phone(text)                                    reset search_path;
alter function public.normalise_phone(text)                                reset search_path;
alter function public.normalize_certificate_type()                         reset search_path;
alter function public.notify_mentioned_users()                             reset search_path;
alter function public.notify_on_call()                                     reset search_path;
alter function public.pause_campaign_on_lead_status_change()               reset search_path;
alter function public.personalise_email(text, text, text, text, text)      reset search_path;
alter function public.pick_campaign_inbox(uuid)                            reset search_path;
alter function public.property_match_key(text, text)                       reset search_path;
alter function public.protect_portal_users_admin_fields()                  reset search_path;
alter function public.record_open(uuid)                                    reset search_path;
alter function public.search_by_phone(text)                                reset search_path;
alter function public.set_portal_users_updated_at()                        reset search_path;
alter function public.set_quote_number()                                   reset search_path;
alter function public.sync_client_totals(uuid)                             reset search_path;
alter function public.sync_job_payment_from_invoices()                     reset search_path;
alter function public.trg_lead_accepted_insert()                           reset search_path;
alter function public.trg_lead_accepted_update()                           reset search_path;
alter function public.update_updated_at()                                  reset search_path;

alter view public.campaign_eligible_leads reset (security_invoker);
alter view public.leads_with_renewal      reset (security_invoker);
grant all on public.campaign_eligible_leads, public.leads_with_renewal to anon;

-- ── 8. rep_kpi_targets ─────────────────────────────────────────────
drop policy "Admins manage KPI targets" on public.rep_kpi_targets;
drop policy "Reps read own KPI targets" on public.rep_kpi_targets;
alter table public.rep_kpi_targets disable row level security;
grant all on public.rep_kpi_targets to anon;

-- ── 7. leads + child tables ────────────────────────────────────────
alter function public.lead_type_counts() reset search_path;

drop policy "Staff access via visible lead" on public.activities;
create policy "Internal staff full access activities" on public.activities
  for all to public
  using (exists (select 1 from profiles where profiles.id = (select auth.uid() as uid)))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid() as uid)));

drop policy "Staff access via visible lead" on public.lead_contacts;
create policy "Auth full access lead_contacts" on public.lead_contacts
  for all to public
  using ((select auth.uid() as uid) is not null)
  with check ((select auth.uid() as uid) is not null);

drop policy "Admins all leads" on public.leads;
drop policy "Finance read leads" on public.leads;
drop policy "Reps own leads" on public.leads;
create policy "Internal staff full access leads" on public.leads
  for all to public
  using (exists (select 1 from profiles where profiles.id = (select auth.uid() as uid)))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid() as uid)));

-- ── 6. auth.uid() IS NOT NULL tables ───────────────────────────────
drop policy "Staff full access" on public.activity_log;
create policy "Auth full access activity_log" on public.activity_log
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.client_activities;
create policy "Auth users manage activities" on public.client_activities
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.document_settings;
create policy "Auth full access document_settings" on public.document_settings
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.email_log;
create policy "All authenticated can view email log" on public.email_log
  for select to public using ((select auth.uid() as uid) is not null);
create policy "Auth users manage email log" on public.email_log
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.email_templates;
create policy "Authenticated full access email_templates" on public.email_templates
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.inbound_jobs;
create policy "Auth users manage inbound jobs" on public.inbound_jobs
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.job_line_items;
create policy "Auth full access job_line_items" on public.job_line_items
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.nuacom_calls;
create policy "Auth full access nuacom_calls" on public.nuacom_calls
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.quote_line_items;
create policy "Auth full access quote_items" on public.quote_line_items
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

drop policy "Staff full access" on public.quotes;
create policy "Auth full access quotes" on public.quotes
  for all to public using ((select auth.uid() as uid) is not null) with check ((select auth.uid() as uid) is not null);

-- ── 5. user_email_accounts ─────────────────────────────────────────
drop policy "Staff read email accounts" on public.user_email_accounts;
drop policy "Admins manage email accounts" on public.user_email_accounts;
drop policy "Owners update own email accounts" on public.user_email_accounts;
create policy "Internal staff full access email accounts" on public.user_email_accounts
  for all to public
  using (exists (select 1 from profiles where profiles.id = (select auth.uid() as uid)))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid() as uid)));

-- Column grants are dropped by the table-level revoke, then full table grants restored
revoke select, update on public.user_email_accounts from authenticated;
grant all on public.user_email_accounts to anon, authenticated;

-- Original view, verbatim from pg_get_viewdef (owner postgres, no security_invoker).
-- If the hotfix 20261012115900 was applied before Phase 1 and you only want to
-- undo Phase 1, delete this view block and the anon view grants in step 9 below.
create view public.campaign_sending_accounts as
 SELECT c.id AS campaign_id,
    c.name AS campaign_name,
    c.rotate_inboxes,
    c.inbox_ids,
    c.from_inbox_id,
    u.id AS account_id,
    u.gmail_address,
    u.display_name,
    u.access_token,
    u.refresh_token,
    u.token_expiry
   FROM campaigns c
     JOIN user_email_accounts u ON c.rotate_inboxes = true AND (u.id = ANY (c.inbox_ids)) OR c.rotate_inboxes = false AND u.id = c.from_inbox_id
  WHERE u.is_active = true AND u.account_type = 'cold'::text;
grant all on public.campaign_sending_accounts to anon, authenticated, service_role;

-- ── 4. portal_users ────────────────────────────────────────────────
drop trigger portal_users_guard on public.portal_users;
drop function public.portal_users_guard();
drop policy "Agent can update own portal_users row" on public.portal_users;
create policy "Agent can update own portal_users row" on public.portal_users
  for update to public
  using ((select auth.uid() as uid) = auth_user_id)
  with check ((select auth.uid() as uid) = auth_user_id);

-- ── 3. profiles ────────────────────────────────────────────────────
drop trigger profiles_block_role_change on public.profiles;
drop function public.profiles_block_role_change();

drop policy "Staff read profiles" on public.profiles;
create policy "All authenticated can view profiles" on public.profiles
  for select to public using ((select auth.uid() as uid) is not null);

drop policy "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles
  for update to public using ((select auth.uid() as uid) = id);

drop policy "Admins manage profiles" on public.profiles;
create policy "Admins can update any profile" on public.profiles
  for update to public
  using (exists (select 1 from profiles profiles_1
                 where profiles_1.id = (select auth.uid() as uid) and profiles_1.role = 'admin'::text));

-- ── 2. handle_new_user (original, verbatim) ────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- Portal signups (tagged via raw_user_meta_data at signUp() time) must
  -- never get a staff profile — that's the entire cause of portal agents
  -- seeing every client's data instead of just their own.
  if new.raw_user_meta_data->>'signup_type' = 'portal' then
    return new;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'rep')
  );
  return new;
end;
$function$;
alter function public.handle_new_user() reset search_path;

-- ── 1. Helper functions (no policy references them any more) ───────
drop function public.is_staff();
drop function public.is_admin();
drop function public.my_role();

commit;
