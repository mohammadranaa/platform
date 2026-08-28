// ============================================================
// MLC PLATFORM — Edge Function: gmail-watch
// Subscribes (or renews a subscription for) one or all active Gmail
// accounts to Gmail Push Notifications via Google Cloud Pub/Sub, so
// gmail-webhook gets called by Google within seconds of new mail
// arriving instead of relying only on the gmail-fetch polling cron.
//
// Gmail watch subscriptions expire after 7 days — this function is
// safe to call repeatedly (each call just renews), and is scheduled
// to run daily via pg_cron.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Must exactly match the Pub/Sub topic created in Google Cloud Console,
// with gmail-api-push@system.gserviceaccount.com granted Publisher on it.
const PUBSUB_TOPIC = 'projects/mlc-503711/topics/gmail-push-notifications'

async function refreshToken(account: any, clientId: string, clientSecret: string): Promise<string> {
  if (new Date() < new Date(account.token_expiry)) return account.access_token
  if (!account.refresh_token) throw new Error(`No refresh token for ${account.gmail_address}`)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: account.refresh_token, grant_type: 'refresh_token' }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`)
  await supabase.from('user_email_accounts').update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
  }).eq('id', account.id)
  return data.access_token
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
  }

  let body: any = {}
  try { body = await req.json() } catch { /* no body */ }

  const client_id = body.client_id || Deno.env.get('GOOGLE_CLIENT_ID') || ''
  const client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

  let accountsQuery = supabase.from('user_email_accounts').select('*').eq('is_active', true)
  if (body.account_id) accountsQuery = accountsQuery.eq('id', body.account_id)
  const { data: accounts } = await accountsQuery

  if (!accounts?.length) {
    return new Response(JSON.stringify({ ok: true, watched: 0, results: [] }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  const results: any[] = []
  let watched = 0

  for (const account of accounts) {
    try {
      const token = await refreshToken(account, client_id, client_secret)

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicName: PUBSUB_TOPIC, labelIds: ['INBOX'] }),
      })
      const data = await res.json()

      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))

      await supabase.from('user_email_accounts').update({
        history_id: String(data.historyId),
        watch_expiry: new Date(Number(data.expiration)).toISOString(),
        pubsub_topic: PUBSUB_TOPIC,
      }).eq('id', account.id)

      results.push({ account: account.gmail_address, ok: true, expiry: new Date(Number(data.expiration)).toISOString() })
      watched++
    } catch (err: any) {
      console.error(`Watch failed for ${account.gmail_address}: ${err.message}`)
      results.push({ account: account.gmail_address, ok: false, error: err.message })
    }
  }

  return new Response(JSON.stringify({ ok: true, watched, total: accounts.length, results }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
