import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function normalisePhone(num: string): string[] {
  if (!num) return []
  const digits = num.replace(/\D/g, '')
  const variants: string[] = [digits]
  if (digits.startsWith('00353')) variants.push('0' + digits.slice(5))
  if (digits.startsWith('353') && digits.length > 10) variants.push('0' + digits.slice(3))
  if (digits.startsWith('0044')) variants.push('0' + digits.slice(4))
  if (digits.startsWith('44') && digits.length > 10) variants.push('0' + digits.slice(2))
  if (digits.length > 10) { variants.push(digits.slice(-10)); variants.push('0' + digits.slice(-10)) }
  // Also try with + prefix stripped
  if (num.startsWith('+')) variants.push(num.slice(1))
  variants.push(num) // original
  return [...new Set(variants)]
}

async function matchPhone(phoneVariants: string[]) {
  let matchedLeadId = null, matchedClientId = null
  if (!phoneVariants.length) return { matchedLeadId, matchedClientId }

  const { data: leadMatches } = await supabase
    .from('leads').select('id')
    .or(phoneVariants.map(p => `inbound_phone.eq.${p},job_telephone.eq.${p},job_mobile.eq.${p},direct_number.eq.${p},landline_number.eq.${p}`).join(','))
    .limit(1)
  if (leadMatches?.length) matchedLeadId = leadMatches[0].id

  const { data: clientMatches } = await supabase
    .from('clients').select('id')
    .or(phoneVariants.map(p => `phone.eq.${p},phone_2.eq.${p}`).join(','))
    .limit(1)
  if (clientMatches?.length) matchedClientId = clientMatches[0].id

  return { matchedLeadId, matchedClientId }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let payload: any
  try { payload = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  console.log('NUACOM webhook:', JSON.stringify(payload))

  const isCompleted = payload.call_status === 'completed' || payload.call_terminated === true || payload.call_terminated === '1'
  const callerLocal = payload.call_caller_number_local || payload.call_caller_number || ''
  const calleeLocal = payload.call_callee_number_local || payload.call_callee_number || ''
  const customerNumber = payload.call_direction === 'inbound' ? callerLocal : calleeLocal
  const phoneVariants = normalisePhone(customerNumber)
  const { matchedLeadId, matchedClientId } = await matchPhone(phoneVariants)

  // NUACOM sends duration and recording_link (NOT recording_url)
  const duration = payload.duration ? parseInt(payload.duration) : (payload.total_duration ? parseInt(payload.total_duration) : null)
  const recordingUrl = payload.recording_link || payload.recording_url || null

  const callId = payload.id || payload.call_id || `${payload.started_at_unix}-${callerLocal}`

  const { error: callError } = await supabase
    .from('nuacom_calls')
    .upsert({
      nuacom_call_id: callId,
      call_direction: payload.call_direction,
      call_status: payload.call_status,
      call_answered: payload.call_answered === true || payload.call_answered === 'true',
      call_terminated: payload.call_terminated === true || payload.call_terminated === '1',
      call_caller_name: payload.call_caller_name,
      call_caller_number: payload.call_caller_number,
      call_caller_number_local: callerLocal,
      call_callee_name: payload.call_callee_name,
      call_callee_number: payload.call_callee_number,
      call_callee_number_local: calleeLocal,
      call_answered_by: payload.call_answered_by ? String(payload.call_answered_by) : null,
      call_initiated_by: payload.call_initiated_by ? String(payload.call_initiated_by) : null,
      call_in_queue: payload.call_in_queue,
      call_at: payload.call_at,
      started_at_unix: payload.started_at_unix ? parseInt(payload.started_at_unix) : null,
      recording_url: recordingUrl,
      duration_seconds: duration,
      raw_payload: payload,
      matched_lead_id: matchedLeadId,
      matched_client_id: matchedClientId,
    }, { onConflict: 'nuacom_call_id' })

  if (callError) {
    console.error('Error saving call:', callError)
    return new Response(JSON.stringify({ error: callError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  // Log to activity feed if matched and completed
  if (isCompleted && (matchedLeadId || matchedClientId)) {
    const direction = payload.call_direction === 'inbound' ? '📞 Inbound' : '📤 Outbound'
    const answered = payload.call_answered === true || payload.call_answered === 'true' ? 'Answered' : 'Missed'
    const durationStr = duration && duration > 0 ? ` · ${Math.floor(duration / 60)}m ${duration % 60}s` : ''
    const callerStr = payload.call_caller_name ? `${payload.call_caller_name} (${callerLocal})` : callerLocal

    await supabase.from('activities').insert({
      lead_id: matchedLeadId, client_id: matchedClientId,
      rep_id: null, rep_name: payload.call_answered_by ? `Extension ${payload.call_answered_by}` : 'NUACOM',
      activity_type: 'call',
      title: `${direction} call — ${answered}${durationStr}`,
      body: `${direction} call from ${callerStr}${recordingUrl ? '\n🎙 Recording available' : ''}`,
      metadata: { call_direction: payload.call_direction, call_answered: payload.call_answered, caller_number: callerLocal, callee_number: calleeLocal, duration, recording_url: recordingUrl, nuacom_call_id: callId },
    })
  }

  return new Response(JSON.stringify({ ok: true, matched_lead: matchedLeadId, matched_client: matchedClientId }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  })
})
