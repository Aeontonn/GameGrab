import type { MouseEvent } from 'react'

// True on a phone or tablet, where the store apps can be installed.
const isMobile = () => window.matchMedia('(pointer: coarse)').matches

// How long we wait for the app to take over before falling back to the web page.
const FALLBACK_MS = 1500

// The link that opens a game straight in the store's mobile app, or null if we
// don't have one. Only Steam: for GOG and Epic we have no store page to build a
// link from (claim_url is a redirect), and they have no public app link.
const appLinkFor = (store: string, steamAppId: string | null): string | null =>
  store === 'Steam' && steamAppId ? `steam://store/${steamAppId}` : null

// Click handler for a link to a game. On mobile it tries the store's app first,
// and if the app doesn't open (not installed) it goes to the web page instead.
// On desktop, or when there is no app link, the link works as usual.
export function openInApp(
  event: MouseEvent<HTMLAnchorElement>,
  store: string,
  steamAppId: string | null,
  webUrl: string,
) {
  const appLink = appLinkFor(store, steamAppId)
  if (!appLink || !isMobile()) return

  event.preventDefault()

  // If the app opens, the browser is sent to the background and the page
  // becomes hidden. If it's still visible after a moment, there is no app.
  const timer = window.setTimeout(() => {
    if (document.visibilityState === 'visible') window.location.assign(webUrl)
  }, FALLBACK_MS)

  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') window.clearTimeout(timer)
    },
    { once: true },
  )

  window.location.href = appLink
}
