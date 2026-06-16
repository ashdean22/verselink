/**
 * app/api/devotional/subscribe/route.ts — start the opt-in for the daily devotional.
 *
 * Flow (verification method B — Vapi confirmation call, no SMS provider needed):
 *   1. Validate the number is E.164.
 *   2. Enforce the same per-number / global call caps as on-demand calls.
 *   3. Generate a 6-digit code, valid ~10 minutes, store it (service-role only).
 *   4. Place a short Vapi call that READS THE CODE ALOUD and hangs up.
 *   5. The user types the code back into the UI → /api/devotional/verify.
 *
 * The row is written with the service-role key and starts verified = false.
 * No call is ever placed by the daily cron until verify flips it true.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { E164_RE } from '@/lib/phone'
import { checkCallCaps, logCall } from '@/lib/callLimits'

const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function generateCode(): string {
  // 6-digit numeric code, zero-padded (e.g. "048213").
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')
}

// Spell the code out digit-by-digit so TTS reads "0, 4, 8…" not "forty-eight thousand…"
function spokenDigits(code: string): string {
  return code.split('').join(', ')
}

export async function POST(req: NextRequest) {
  const vapiKey       = process.env.VAPI_PRIVATE_KEY
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID
  const assistantId   = process.env.VAPI_ASSISTANT_ID

  if (!vapiKey || !phoneNumberId || !assistantId) {
    return NextResponse.json(
      { error: 'Vapi env vars not configured — add VAPI_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID to .env.local' },
      { status: 503 }
    )
  }

  let phoneNumber: string
  try {
    const body = await req.json()
    phoneNumber = (body.phoneNumber ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Server-side E.164 validation — never trust the client's check alone.
  if (!E164_RE.test(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid phone number. Must be E.164 format (e.g. +15551234567).' },
      { status: 400 }
    )
  }

  // Cost guardrail: a verification call counts against the daily caps too,
  // so this endpoint can't be used to spam-dial a number.
  try {
    const caps = await checkCallCaps(phoneNumber)
    if (!caps.ok) {
      return NextResponse.json({ error: caps.error }, { status: caps.status })
    }
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Could not verify daily call limit' }, { status: 500 })
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()
  const supabase = createServiceClient()

  // Upsert by phone. We do NOT touch `verified` here: a returning subscriber
  // who re-requests a code keeps any prior verified status; a new one defaults
  // to verified = false via the table default. active is (re)set true.
  const { data: existing, error: selErr } = await supabase
    .from('devotional_subscribers')
    .select('id')
    .eq('phone', phoneNumber)
    .maybeSingle()
  if (selErr) {
    console.error('subscriber lookup failed:', selErr)
    return NextResponse.json({ error: 'Could not start verification' }, { status: 500 })
  }

  const writeErr = existing
    ? (await supabase
        .from('devotional_subscribers')
        .update({ verification_code: code, code_expires_at: expiresAt, active: true })
        .eq('phone', phoneNumber)).error
    : (await supabase
        .from('devotional_subscribers')
        .insert({ phone: phoneNumber, verification_code: code, code_expires_at: expiresAt })).error
  if (writeErr) {
    console.error('subscriber write failed:', writeErr)
    return NextResponse.json({ error: 'Could not start verification' }, { status: 500 })
  }

  // Place the confirmation call. assistantOverrides lets us reuse the existing
  // assistant but replace its opening line with the spoken code, and hard-cap
  // the call duration so it can't run the full devotional.
  const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${vapiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      assistantId,
      phoneNumberId,
      customer: { number: phoneNumber },
      assistantOverrides: {
        firstMessageMode: 'assistant-speaks-first',
        firstMessage:
          `Hello from Verse Link. Your verification code is ${spokenDigits(code)}. ` +
          `Once more, ${spokenDigits(code)}. ` +
          `Enter this code on the website to confirm your daily devotional. Goodbye.`,
        maxDurationSeconds: 60,
      },
    }),
  })

  if (!vapiRes.ok) {
    const errBody = await vapiRes.text()
    console.error('Vapi verification call failed:', errBody)
    return NextResponse.json({ error: 'Could not place verification call — try again' }, { status: 502 })
  }

  // Best-effort: count this call against the daily caps.
  try {
    await logCall(phoneNumber)
  } catch (err) {
    console.error('Call log insert failed (call was still placed):', err)
  }

  return NextResponse.json({
    success: true,
    message: 'Calling you now with a 6-digit code. Enter it below to confirm.',
  })
}
