import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { AuthError, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

// Supabase's own minimum is 6, which is too short. The same limit should also be
// set in the dashboard (Authentication → Policies), since this check only runs in
// the browser and can be bypassed.
const MIN_PASSWORD_LENGTH = 8

// Turns Supabase's error codes into text a visitor understands. Unknown codes
// get a general message, so we never show technical details on the page.
const errorText = (error: AuthError): string => {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Wrong email or password.'
    case 'email_not_confirmed':
      return 'Confirm your email first – check your inbox.'
    case 'user_already_exists':
    case 'email_exists':
      return 'There is already an account with that email. Log in instead.'
    case 'weak_password':
      return `Choose a stronger password, at least ${MIN_PASSWORD_LENGTH} characters.`
    case 'email_address_invalid':
      return "That email address doesn't look right."
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Wait a minute and try again.'
    case 'signup_disabled':
      return "New accounts can't be created right now."
    default:
      return 'Something went wrong. Try again in a moment.'
  }
}

// The logged in session. undefined while we don't know yet, null when nobody is
// logged in. Supabase keeps the session in the browser, so it survives a reload.
function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    if (!supabase) return

    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    // Called on login, logout, token refresh – and when the visitor comes back
    // from the confirmation email.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => data.subscription.unsubscribe()
  }, [])

  return session
}

type Mode = 'login' | 'signup'

// The form for logging in or creating an account.
function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shown after sign up when Supabase sends a confirmation email.
  const [sentTo, setSentTo] = useState<string | null>(null)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return

    setBusy(true)
    setError(null)

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      setBusy(false)
      if (error) return setError(errorText(error))
      return onDone()
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      // Where the link in the confirmation email leads. Must be listed under
      // Authentication → URL Configuration in Supabase, otherwise it's refused.
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return setError(errorText(error))

    // With email confirmation turned off the visitor is logged in straight away.
    if (data.session) return onDone()

    // Otherwise they have to click the link first. We say the same thing even if
    // the email already has an account – Supabase doesn't tell us, on purpose,
    // so nobody can use the form to find out who has an account.
    setSentTo(email)
    setPassword('')
  }

  if (sentTo) {
    return (
      <div className="auth-form">
        <p>
          We sent a link to <strong>{sentTo}</strong>. Click it to confirm your account,
          then log in.
        </p>
        <button type="button" onClick={() => { setSentTo(null); switchMode('login') }}>
          Back to log in
        </button>
      </div>
    )
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-tabs">
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          onClick={() => switchMode('login')}
        >
          Log in
        </button>
        <button
          type="button"
          className={mode === 'signup' ? 'active' : ''}
          onClick={() => switchMode('signup')}
        >
          Create account
        </button>
      </div>

      <label>
        Email
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label>
        Password
        {/* autoComplete tells the password manager whether to suggest a saved
            password or generate a new one. */}
        <input
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {mode === 'signup' && (
        <p className="hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Wait…' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>
    </form>
  )
}

// Top right in the header: who is logged in, or a button to log in.
export default function Account() {
  const session = useSession()
  const [open, setOpen] = useState(false)

  // Login isn't set up, or we don't know the session yet – show nothing rather
  // than a button that flickers or doesn't work.
  if (!supabase || session === undefined) return null

  if (session) {
    return (
      <div className="account">
        <span className="account-email">{session.user.email}</span>
        <button type="button" onClick={() => supabase?.auth.signOut()}>
          Log out
        </button>
      </div>
    )
  }

  return (
    <div className="account">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {open ? 'Close' : 'Log in'}
      </button>
      {open && <AuthForm onDone={() => setOpen(false)} />}
    </div>
  )
}
