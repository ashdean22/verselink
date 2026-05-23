'use client'

import { useState } from 'react'

export default function CallNowButton() {
  const [status, setStatus] = useState<'idle' | 'calling' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleCall() {
    setStatus('calling')
    setMessage('')
    try {
      const res = await fetch('/api/call-now', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data.error ?? 'Call failed')
      } else {
        setStatus('success')
        setMessage(`Your phone is ringing. ${data.remaining} call${data.remaining === 1 ? '' : 's'} left today.`)
      }
    } catch {
      setStatus('error')
      setMessage('Network error — try again')
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleCall}
        disabled={status === 'calling' || status === 'success'}
        className="w-full rounded-lg border border-stone-200 bg-white p-5 shadow-sm hover:border-stone-400 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <h2 className="font-semibold mb-1">
          {status === 'calling' ? 'Calling…' : status === 'success' ? 'Call placed' : 'Voice Devotional'}
        </h2>
        <p className="text-sm text-stone-500">
          {status === 'idle' && 'Get a Bible study conversation delivered to your phone.'}
          {status === 'calling' && 'Contacting Vapi…'}
          {status === 'success' && 'Pick up your phone.'}
          {status === 'error' && 'Something went wrong — see below.'}
        </p>
      </button>
      {message && (
        <p className={`text-xs px-1 ${status === 'error' ? 'text-red-600' : 'text-stone-500'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
