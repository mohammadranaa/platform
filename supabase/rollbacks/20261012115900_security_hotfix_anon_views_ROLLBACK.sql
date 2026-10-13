-- ROLLBACK for supabase/migrations/20261012115900_security_hotfix_anon_views.sql
-- Restores the exact pre-hotfix state captured 12 Oct 2026. Note this re-opens
-- the token/lead exposure described in the hotfix.

begin;

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

grant all on public.leads_with_renewal      to anon;
grant all on public.campaign_eligible_leads to anon;
grant all on public.rep_kpi_targets         to anon;

commit;
