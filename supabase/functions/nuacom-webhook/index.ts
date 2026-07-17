// NUACOM Webhook Handler — Supabase Edge Function
// Receives real-time call events from NUACOM and:
// 1. Saves the call record to nuacom_calls table
// 2. Matches caller/callee number to leads and clients
// 3. Logs to the activity feed of the matched record

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Normalise phone number for matching
// NUACOM sends numbers like "00353876543219" or "0876543219"
// Our DB stores them like "07956827499" (UK format)
function normalisePhone(num: string): string[] {
  if (!num) return []
  const digits = num.replace(/\D/g, '')
  const variants: string[] = [digits]

  // 00353... → 07... (Ireland to UK)
  if (digits.startsWith('00353')) {
    variants.push('0' + digits.slice(5))
  }
  // 353... → 07...
  if (digits.startsWith('353') && digits.length > 10) {
    variants.push('0' + digits.slice(3))
  }
  // 0044... → 07...
  if (digits.startsWith('0044')) {
    variants.push('0' + digits.slice(4))
  }
  // 44... → 07...
  if (digits.startsWith('44') && digits.length > 10) {
    variants.push('0' + digits.slice(2))
  }
  // Also try last 10 digits
  if (digits.length > 10) {
    variants.push(digits.slice(-10))
    variants.push('0' + digits.slice(-10))
  }

  return [...new Set(variants)]
}

// Match a phone number against leads and clients
async function matchPhone(phoneVariants: string[]) {
  let matchedLeadId = null
  let matchedClientId = null

  if (!phoneVariants.length) return { matchedLeadId, matchedClientId }

  // Search leads (all phone fields)
  const { data: leadMatches } = await supabase
    .from('leads')
    .select('id, inbound_name, company_name, contact_first, contact_last')
    .or(
      phoneVariants.map(p =>
        `inbound_phone.eq.${p},job_telephone.eq.${p},job_mobile.eq.${p},direct_number.eq.${p},landline_number.eq.${p}`
      ).join(',')
    )
    .limit(1)

  if (leadMatches?.length) {
    matchedLeadId = leadMatches[0].id
  }

  // Search clients
  const { data: clientMatches } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name')
    .or(
      phoneVariants.map(p =>
        `phone.eq.${p},phone_2.eq.${p}`
      ).join(',')
    )
    .limit(1)

  if (clientMatches?.length) {
    matchedClientId = clientMatches[0].id
  }

  return { matchedLeadId, matchedClientId }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('NUACOM webhook received:', JSON.stringify(payload))

  // Only process completed calls (not ringing/connected events)
  // We log the final state when call_status = "completed" or call_terminated = true
  const isCompleted = payload.call_status === 'completed' || payload.call_terminated === true

  // Get the caller's local number (the one that matches UK numbers in our DB)
  const callerLocalNum  = payload.call_caller_number_local || payload.call_caller_number || ''
  const calleeLocalNum  = payload.call_callee_number_local || payload.call_callee_number || ''

  // For inbound calls: caller is the customer, callee is the MLC number
  // For outbound calls: caller is the MLC extension, callee is the customer
  const customerNumber = payload.call_direction === 'inbound' ? callerLocalNum : calleeLocalNum
  const phoneVariants  = normalisePhone(customerNumber)

  // Match to existing lead/client
  const { matchedLeadId, matchedClientId } = await matchPhone(phoneVariants)

  // Calculate duration from unix timestamp
  const duration = payload.started_at_unix
    ? Math.floor(Date.now() / 1000) - parseInt(payload.started_at_unix)
    : null

  // Upsert call record (use nuacom_call_id to avoid duplicates)
  const callId = payload.id || payload.call_id || `${payload.started_at_unix}-${callerLocalNum}`

  const { data: callRecord, error: callError } = await supabase
    .from('nuacom_calls')
    .upsert({
      nuacom_call_id:          callId,
      call_direction:          payload.call_direction,
      call_status:             payload.call_status,
      call_answered:           payload.call_answered === true || payload.call_answered === 'true',
      call_terminated:         payload.call_terminated === true || payload.call_terminated === 'true',
      call_caller_name:        payload.call_caller_name,
      call_caller_number:      payload.call_caller_number,
      call_caller_number_local: callerLocalNum,
      call_callee_name:        payload.call_callee_name,
      call_callee_number:      payload.call_callee_number,
      call_callee_number_local: calleeLocalNum,
      call_answered_by:        payload.call_answered_by,
      call_initiated_by:       payload.call_initiated_by,
      call_in_queue:           payload.call_in_queue,
      call_at:                 payload.call_at,
      started_at_unix:         payload.started_at_unix ? parseInt(payload.started_at_unix) : null,
      recording_url:           payload.recording_url,
      duration_seconds:        duration,
      raw_payload:             payload,
      matched_lead_id:         matchedLeadId,
      matched_client_id:       matchedClientId,
    }, { onConflict: 'nuacom_call_id' })
    .select()
    .single()

  if (callError) {
    console.error('Error saving call:', callError)
    return new Response(JSON.stringify({ error: callError.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Log to activity feed if matched and call is completed
  if (isCompleted && (matchedLeadId || matchedClientId)) {
    const direction  = payload.call_direction === 'inbound' ? '📞 Inbound' : '📤 Outbound'
    const answered   = payload.call_answered ? 'Answered' : 'Missed'
    const durationStr = duration && duration > 0 ? ` · ${Math.floor(duration / 60)}m ${duration % 60}s` : ''
    const callerStr  = payload.call_caller_name ? `${payload.call_caller_name} (${callerLocalNum})` : callerLocalNum

    await supabase.from('activities').insert({
      lead_id:       matchedLeadId,
      client_id:     matchedClientId,
      rep_id:        null,
      rep_name:      payload.call_answered_by ? `Extension ${payload.call_answered_by}` : 'NUACOM',
      activity_type: 'call',
      title:         `${direction} call — ${answered}${durationStr}`,
      body:          `${direction} call from ${callerStr}${payload.recording_url ? '\n🎙 Recording available' : ''}`,
      metadata: {
        call_direction:  payload.call_direction,
        call_answered:   payload.call_answered,
        caller_number:   callerLocalNum,
        callee_number:   calleeLocalNum,
        duration:        duration,
        recording_url:   payload.recording_url,
        nuacom_call_id:  callId,
        answered_by:     payload.call_answered_by,
      }
    })
  }

  return new Response(JSON.stringify({ ok: true, matched_lead: matchedLeadId, matched_client: matchedClientId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
