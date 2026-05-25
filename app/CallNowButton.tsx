'use client'

import { useState, useEffect, useId } from 'react'

const E164_RE = /^\+[1-9]\d{6,14}$/
const LS_KEY = 'verselink_phone'

function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits[0] === '1') return '+' + digits
  if (hasPlus || digits.length > 11) return '+' + digits
  return digits
}

export default function CallNowButton() {
  const inputId = useId()
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [status, setStatus] = useState<'idle' | 'calling' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) setPhone(saved)
  }, [])

  function handlePhoneChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setPhone(raw)
    setPhoneError('')
    setStatus('idle')
    setMessage('')
  }

  const normalized = normalizePhone(phone)
  const isValid = E164_RE.test(normalized)

  async function handleCall() {
    if (!isValid) {
      setPhoneError('Enter a valid phone number, e.g. +1 555 123 4567 or a 10-digit US number.')
      return
    }

    localStorage.setItem(LS_KEY, phone)
    setStatus('calling')
    setMessage('')
    setPhoneError('')

    try {
      const res = await fetch('/api/call-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: normalized }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data.error ?? 'Call failed')
      } else {
        setStatus('success')
        setMessage('Your phone is ringing — pick up for your Bible study devotional.')
      }
    } catch {
      setStatus('error')
      setMessage('Network error — try again')
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm space-y-3">
      <div>
        <h2 className="text-lg font-bold mb-0.5">Voice Devotional</h2>
        <p className="text-sm text-stone-500">Get a Bible study conversation delivered to your phone.</p>
      </div>

      <div className="space-y-1">
        <label htmlFor={inputId} className="text-xs font-medium text-stone-600">
          Your phone number
        </label>
        <input
          id={inputId}
          type="tel"
          value={phone}
          onChange={handlePhoneChange}
          placeholder="+1 555 123 4567"
          disabled={status === 'calling' || status === 'success'}
          className="w-full rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 disabled:opacity-60"
        />
        {phoneError && (
          <p className="text-xs text-red-600">{phoneError}</p>
        )}
      </div>

      <button
        onClick={handleCall}
        disabled={!isValid || status === 'calling' || status === 'success'}
        className="w-full rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'calling' ? 'Calling…' : status === 'success' ? 'Call placed ✓' : 'Call Me Now'}
      </button>

      {message && (
        <p className={`text-xs ${status === 'error' ? 'text-red-600' : 'text-stone-500'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
