// ============================================================
// MLC PLATFORM — Edge Function: gmail-webhook
// Receives Gmail Push Notifications via Google Pub/Sub
// When a reply comes in:
//   1. Fetches the new message from Gmail API
//   2. Matches it to a campaign contact or client thread
//   3. Logs it to email_messages and email_threads
//   4. Logs to client_activities
//   5. Pauses the campaign sequence for that contact
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  // Google Pub/Sub sends a POST with a base64-encoded message
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await req.json()

    // Decode the Pub/Sub message
    const pubsubMessage = body?.message
    if (!pubsubMessage?.data) {
      return new Response('No data', { status: 200 }) // ACK to avoid retries
    }

    const decoded = JSON.parse(atob(pubsubMessage.data))
    const { emailAddress, historyId } = decoded

    if (!emailAddress || !historyId) {
      return new Response('Invalid message', { status: 200 })
    }

    // Find the user account this Gmail notification is for
    const { data: account } = await supabase
      .from('user_email_accounts')
      .select('*')
      .eq('gmail_address', emailAddress)
      .single()

    if (!account) {
      console.log('No account found for:', emailAddress)
      return new Response('OK', { status: 200 })
    }

    // Get fresh access token
    const accessToken = await refreshAccessToken(account)
    if (!accessToken) {
      console.error('Could not get access token for:', emailAddress)
      return new Response('OK', { status: 200 })
    }

    // Fetch new messages since last history ID
    const newMessages = await fetchNewMessages(
      accessToken,
      account.history_id || historyId
    )

    for (const message of newMessages) {
      await processIncomingMessage(message, account, accessToken)
    }

    // Update the history ID to the latest
    await supabase
      .from('user_email_accounts')
      .update({ history_id: historyId })
      .eq('id', account.id)

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('gmail-webhook error:', err)
    return new Response('OK', { status: 200 }) // Always ACK to avoid Pub/Sub retries
  }
})

// ── Refresh OAuth access token ────────────────────────────────
async function refreshAccessToken(account: any): Promise<string | null> {
  try {
    // Check if current token is still valid
    if (account.access_token && account.token_expiry) {
      const expiry = new Date(account.token_expiry)
      if (expiry > new Date(Date.now() + 60000)) {
        return account.access_token
      }
    }

    // Refresh the token
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
        client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
        refresh_token: account.refresh_token,
        grant_type:    'refresh_token',
      }),
    })

    const data = await res.json()
    if (!data.access_token) return null

    // Store the new token
    await supabase
      .from('user_email_accounts')
      .update({
        access_token: data.access_token,
        token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      })
      .eq('id', account.id)

    return data.access_token
  } catch (err) {
    console.error('Token refresh failed:', err)
    return null
  }
}

// ── Fetch new messages from Gmail API ────────────────────────
async function fetchNewMessages(accessToken: string, startHistoryId: string) {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded&labelIds=INBOX`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  const data = await res.json()
  const messages: any[] = []

  if (!data.history) return messages

  for (const historyItem of data.history) {
    for (const added of historyItem.messagesAdded || []) {
      // Fetch full message details
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${added.message.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const msg = await msgRes.json()
      messages.push(msg)
    }
  }

  return messages
}

// ── Process a single incoming message ────────────────────────
async function processIncomingMessage(gmailMessage: any, account: any, accessToken: string) {
  const headers = gmailMessage.payload?.headers || []
  const get = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

  const fromHeader  = get('From')
  const toHeader    = get('To')
  const subject     = get('Subject')
  const messageId   = get('Message-ID')
  const inReplyTo   = get('In-Reply-To')
  const gmailMsgId  = gmailMessage.id
  const gmailThreadId = gmailMessage.threadId

  // Parse from address
  const fromMatch   = fromHeader.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/)
  const fromName    = fromMatch?.[1]?.trim() || ''
  const fromAddress = fromMatch?.[2]?.trim() || fromHeader

  // Skip emails sent by us (outbound)
  if (fromAddress.toLowerCase() === account.gmail_address.toLowerCase()) return

  // Extract body
  const bodyText = extractBody(gmailMessage.payload, 'text/plain')
  const bodyHtml = extractBody(gmailMessage.payload, 'text/html')

  // Find or create the thread in our DB
  let thread = await findOrCreateThread({
    account,
    gmailThreadId,
    subject,
    fromAddress,
    fromName,
  })

  // Check if already stored (avoid duplicates)
  const { data: existing } = await supabase
    .from('email_messages')
    .select('id')
    .eq('gmail_message_id', gmailMsgId)
    .single()

  if (existing) return

  // Store the message
  await supabase.from('email_messages').insert({
    thread_id:       thread.id,
    gmail_message_id: gmailMsgId,
    from_address:    fromAddress,
    from_name:       fromName,
    to_addresses:    [account.gmail_address],
    subject,
    body_text:       bodyText,
    body_html:       bodyHtml,
    direction:       'inbound',
    is_read:         false,
    received_at:     new Date(parseInt(gmailMessage.internalDate)).toISOString(),
  })

  // Update thread
  await supabase.from('email_threads').update({
    last_message_at: new Date().toISOString(),
    message_count:   thread.message_count + 1,
    has_unread:      true,
  }).eq('id', thread.id)

  // If this is a reply to a campaign email — handle it
  if (thread.campaign_contact_id) {
    await handleCampaignReply(thread.campaign_contact_id, fromAddress, bodyText)
  }

  // Log to client activity if linked to a client
  if (thread.client_id) {
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', account.user_id)
      .single()

    await supabase.from('client_activities').insert({
      client_id:  thread.client_id,
      rep_id:     account.user_id,
      rep_name:   userProfile?.full_name || account.gmail_address,
      type:       'email',
      content:    `Inbound email from ${fromName || fromAddress}: "${subject}"`,
    })
  }
}

// ── Find or create a thread record ───────────────────────────
async function findOrCreateThread({ account, gmailThreadId, subject, fromAddress, fromName }: any) {
  // Try to find existing thread
  const { data: existing } = await supabase
    .from('email_threads')
    .select('*')
    .eq('gmail_thread_id', gmailThreadId)
    .single()

  if (existing) return existing

  // Try to match to a campaign contact by email
  const { data: campaignContact } = await supabase
    .from('campaign_contacts')
    .select('id, client_id, campaign_id')
    .eq('email', fromAddress)
    .in('status', ['active', 'completed'])
    .limit(1)
    .single()

  // Try to match to a client by email
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('email', fromAddress)
    .single()

  const { data: newThread } = await supabase
    .from('email_threads')
    .insert({
      account_id:           account.id,
      client_id:            client?.id || campaignContact?.client_id || null,
      campaign_contact_id:  campaignContact?.id || null,
      gmail_thread_id:      gmailThreadId,
      subject,
      participants:         [fromAddress, account.gmail_address],
      last_message_at:      new Date().toISOString(),
      message_count:        0,
      has_unread:           true,
      thread_type:          campaignContact ? 'campaign' : 'inbound',
    })
    .select()
    .single()

  return newThread
}

// ── Handle a reply to a campaign email ───────────────────────
async function handleCampaignReply(campaignContactId: string, fromAddress: string, bodyText: string) {
  // Mark contact as replied — this pauses their sequence
  await supabase
    .from('campaign_contacts')
    .update({ status: 'replied' })
    .eq('id', campaignContactId)

  // Log to email_sends
  const { data: latestSend } = await supabase
    .from('email_sends')
    .select('id')
    .eq('contact_id', campaignContactId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .single()

  if (latestSend) {
    await supabase
      .from('email_sends')
      .update({
        status:     'replied',
        replied_at: new Date().toISOString(),
      })
      .eq('id', latestSend.id)
  }

  console.log(`Reply detected from ${fromAddress} — sequence paused`)
}

// ── Extract email body from Gmail payload ─────────────────────
function extractBody(payload: any, mimeType: string): string {
  if (!payload) return ''

  if (payload.mimeType === mimeType && payload.body?.data) {
    return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'))
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractBody(part, mimeType)
      if (result) return result
    }
  }

  return ''
}
