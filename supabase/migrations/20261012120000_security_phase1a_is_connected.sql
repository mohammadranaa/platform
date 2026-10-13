-- Security Phase 1a — additive only, safe to apply during working hours.
--
-- Adds user_email_accounts.is_connected so the front end can stop filtering on
-- access_token. This MUST be live before the Phase 1 front-end change is deployed
-- (the new queries select/filter is_connected), and the front end MUST be live
-- before 20261012120100_security_phase1.sql revokes the token columns.

alter table public.user_email_accounts
  add column if not exists is_connected boolean
  generated always as (access_token is not null and access_token <> 'NOT_CONNECTED') stored;
