import { createClient } from '@supabase/supabase-js'

// The address of our Supabase project and its publishable key. Both end up in
// the visitor's browser, so they are not secret – the tables are protected by
// Row Level Security instead. The secret key (sb_secret_… / service_role) must
// never be put here.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// null when the variables are missing. The rest of the site works without an
// account, so a missing setting only turns off login instead of crashing the page.
export const supabase =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          // PKCE: the link in the confirmation email carries a one-time code
          // instead of the login token itself, so the token never ends up in
          // the address bar or the browser history.
          flowType: 'pkce',
        },
      })
    : null

if (!supabase) {
  console.warn('VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set – login is turned off')
}
