/**
 * app/api/devotional/unsubscribe/route.ts — deactivate a subscriber.
 *
 * Sets active = false (soft delete) so the daily cron stops calling them.
 * Idempotent: unknown numbers return success so we don't leak who's subscribed.
 * Service-role only.
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
    return NextResponse.json({ error: 'Invalid phone number.' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('devotional_subscribers')
    .update({ active: false })
    .eq('phone', phoneNumber)

  if (error) {
    console.error('unsubscribe failed:', error)
    return NextResponse.json({ error: 'Could not unsubscribe — try again' }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: "You've been unsubscribed from the daily devotional." })
}
