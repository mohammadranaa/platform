// ============================================================
// MLC PLATFORM — Edge Function: track-open
// Called when a recipient opens an email
// Returns a 1x1 transparent GIF
// Records the open in the email_sends table
// URL: /functions/v1/track-open?id=TRACKING_UUID
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// 1x1 transparent GIF (43 bytes)
const PIXEL = new Uint8Array([
  0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,
  0x01,0x00,0x80,0x00,0x00,0xFF,0xFF,0xFF,
  0x00,0x00,0x00,0x21,0xF9,0x04,0x00,0x00,
  0x00,0x00,0x00,0x2C,0x00,0x00,0x00,0x00,
  0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,
  0x01,0x00,0x3B,
])

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url)
    const trackingId = url.searchParams.get('id')

    if (trackingId) {
      // Fire and forget — don't block the pixel response
      supabase.rpc('record_open', { p_tracking_id: trackingId }).then(() => {
        console.log('Recorded open for:', trackingId)
      }).catch(err => {
        console.error('Failed to record open:', err)
      })
    }
  } catch (err) {
    console.error('track-open error:', err)
  }

  // Always return the pixel immediately, regardless of DB result
  return new Response(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  })
})
