import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: any
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  const { code, redirect_uri, client_id, user_id, account_type } = body
  const client_secret = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

  if (!code || !redirect_uri || !client_id || !client_secret) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri,
      grant_type: 'authorization_code',
    }),
  })

  const tokenData = await tokenRes.json()

  if (tokenData.error) {
    console.error('Token exchange failed:', tokenData)
    return new Response(JSON.stringify({ error: tokenData.error_description || tokenData.error }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Get user's Gmail address
  const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
  })
  const profileData = await profileRes.json()

  if (!profileData.emailAddress) {
    return new Response(JSON.stringify({ error: 'Failed to get Gmail profile' }), {
      status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Save or update the account
  const tokenExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()

  const { data: existing } = await supabase
    .from('user_email_accounts')
    .select('id')
    .eq('gmail_address', profileData.emailAddress)
    .limit(1)

  if (existing?.length) {
    // Update existing
    await supabase
      .from('user_email_accounts')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || undefined,
        token_expiry: tokenExpiry,
        account_type: account_type || 'personal',
        is_active: true,
        history_id: profileData.historyId,
      })
      .eq('id', existing[0].id)
  } else {
    // Insert new
    await supabase
      .from('user_email_accounts')
      .insert({
        user_id: user_id || null,
        gmail_address: profileData.emailAddress,
        display_name: profileData.emailAddress.split('@')[0],
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expiry: tokenExpiry,
        account_type: account_type || 'personal',
        is_active: true,
        history_id: profileData.historyId,
      })
  }

  return new Response(JSON.stringify({
    ok: true,
    email: profileData.emailAddress,
    account_type: account_type || 'personal',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
