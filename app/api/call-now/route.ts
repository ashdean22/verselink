/**
 * app/api/call-now/route.ts — Trigger an on-demand Vapi outbound call
 *
 * Rate limits:
 *   - Per phone number: 5 calls/day (prevents individual abuse)
 *   - Global:          50 calls/day (protects against credit drain from many users)
 */

import { NextRequest, NextResponse } from 'next/server'
import { E164_RE } from '@/lib/phone'
import { checkCallCaps, logCall } from '@/lib/callLimits'

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
    phoneNumber = body.phoneNumber ?? ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!E164_RE.test(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid phone number. Must be E.164 format (e.g. +15551234567).' },
      { status: 400 }
    )
  }

  try {
    const caps = await checkCallCaps(phoneNumber)
    if (!caps.ok) {
      return NextResponse.json({ error: caps.error }, { status: caps.status })
    }
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Could not verify daily call limit' }, { status: 500 })
  }

  const vapiRes = await fetch('https://api.vapi.ai/call/phone', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${vapiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      assistantId,
      customer:     { number: phoneNumber },
      phoneNumberId,
    }),
  })

  if (!vapiRes.ok) {
    const errBody = await vapiRes.text()
    console.error('Vapi call failed:', errBody)
    return NextResponse.json({ error: 'Vapi call failed — check server logs' }, { status: 502 })
  }

  try {
    await logCall(phoneNumber)
  } catch (err) {
    console.error('Call log insert failed (call was still placed):', err)
  }

  const call = await vapiRes.json()
  return NextResponse.json({ success: true, callId: call.id })
}
