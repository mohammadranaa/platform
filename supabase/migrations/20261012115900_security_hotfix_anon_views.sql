-- Security HOTFIX — safe to apply during working hours (nothing in src/ or
-- supabase/functions/ uses these objects as anon, and the views are not used
-- by the cold email engine).
--
-- Verified 12 Oct 2026 with `set role anon` (no login, only the public anon key
-- that ships in the website bundle):
--   * campaign_sending_accounts → 17 rows with Gmail access/refresh tokens
--   * leads_with_renewal        → all 3,375 leads (views bypass RLS)
--   * campaign_eligible_leads   → all verified cold leads
--   * rep_kpi_targets           → 3 rows (RLS disabled)
--
-- Rollback: supabase/rollbacks/20261012115900_security_hotfix_anon_views_ROLLBACK.sql

begin;

-- Unused anywhere; exposes OAuth tokens.
drop view if exists public.campaign_sending_accounts;

-- The signed-out role never needs these.
revoke all on public.leads_with_renewal      from anon;
revoke all on public.campaign_eligible_leads from anon;
revoke all on public.rep_kpi_targets         from anon;

commit;
