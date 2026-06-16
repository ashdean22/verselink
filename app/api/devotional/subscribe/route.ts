/**
 * app/api/devotional/subscribe/route.ts — opt in to the daily devotional.
 *
 * Just stores the number (active = true). The daily cron calls every active
 * subscriber. No verification call or code — kept deliberately simple.
 *
 * Written with the service-role key. E.164 is validated here too; never trust
 * the client's check alone.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { E164_RE } from '@/lib/phone'

export async function POST(req: NextRequest) {
  let phoneNumber: string
  try {
    const body = await req.json()
    phoneNumber = (body.phoneNumber ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!E164_RE.test(phoneNumber)) {
    return NextResponse.json(
      { error: 'Invalid phone number. Must be E.164 format (e.g. +15551234567).' },
      { status: 400 }
    )
  }

  // Upsert by phone: re-subscribing an existing (possibly deactivated) number
  // just flips it active again. created_at defaults on first insert.
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('devotional_subscribers')
    .upsert({ phone: phoneNumber, active: true }, { onConflict: 'phone' })

  if (error) {
    console.error('subscribe failed:', error)
    return NextResponse.json({ error: 'Could not subscribe — try again' }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: "You're subscribed to the daily devotional." })
}
