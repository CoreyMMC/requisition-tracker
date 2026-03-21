'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function resolveLoginToEmail(value: string) {
  const input = value.trim().toLowerCase()

  if (input.includes('@')) return input

  if (input === 'icuequip') return 'icuequip@monashhealth.org'
  if (input === 'clamendola') return 'clamendola@hotmail.co.uk'
  if (input === 'corey') return 'clamendola@hotmail.co.uk'

  return null
}

export default function LoginPage() {
  const router = useRouter()

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const email = resolveLoginToEmail(login)

    if (!email) {
      setError('Invalid username or email')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError('Invalid login or password')
      setLoading(false)
      return
    }

    router.push('/orders')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Requisition Tracker Login
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in with your username or email
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Username or Email
            </label>
            <input
              id="login"
              type="text"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
              required
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
              required
            />
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-black px-4 py-2 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          You can also type the full email address instead of the username.
        </div>
      </div>
    </main>
  )
}