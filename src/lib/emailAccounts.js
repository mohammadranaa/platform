// Columns the browser may read from user_email_accounts. The OAuth token columns
// (access_token, refresh_token, token_expiry) are revoked for signed-in users, so
// select('*') on this table fails with "permission denied" — always use this list.
export const INBOX_COLUMNS = [
  'id', 'user_id', 'profile_id', 'gmail_address', 'display_name', 'account_type',
  'is_active', 'is_connected', 'connected_at', 'send_as_email', 'send_as_name',
  'is_paused', 'paused_reason', 'paused_at', 'needs_reconnect', 'reconnect_reason',
  'bounce_count', 'warmup_enabled', 'warmup_started_at', 'ramp_up_start_limit',
  'ramp_up_daily_increment', 'ramp_up_cap', 'history_id', 'watch_expiry', 'pubsub_topic',
].join(', ')
