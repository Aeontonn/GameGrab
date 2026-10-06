import type { FreeGame, Offer } from './types'

// The backend address. Set as an environment variable on deploy, otherwise the local server.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export { API_URL }

// Fetches all offers. The backend already sorts them by shortest time left
// (no end date last), so we don't need to re-sort here.
export async function fetchOffers(): Promise<Offer[]> {
  const response = await fetch(`${API_URL}/offers`)

  // The backend responds 503 if it can't reach the database. Then we should show
  // an error, not an empty list – an empty list looks like "there are no offers".
  if (!response.ok) {
    throw new Error(`Backend responded ${response.status}`)
  }

  const offers: Offer[] = await response.json()

  // An older backend sends no genres. We then treat them as empty instead
  // of letting the page crash when someone filters on genre.
  // Same for the end date: a missing field means "unknown".
  return offers.map((offer) => ({
    ...offer,
    genres: offer.genres ?? [],
    description: offer.description ?? null,
    ends_at: offer.ends_at ?? null,
  }))
}

// Fetches the games that are always free. The backend already sorts them
// with the most played first.
export async function fetchFreeGames(): Promise<FreeGame[]> {
  const response = await fetch(`${API_URL}/free-games`)

  if (!response.ok) {
    throw new Error(`Backend responded ${response.status}`)
  }

  const games: FreeGame[] = await response.json()
  return games.map((game) => ({ ...game, genres: game.genres ?? [] }))
}

export type Health =
  | { state: 'loading' }
  | { state: 'ok' }
  | { state: 'error'; message: string }

// Checks that the backend and the database respond. Shown in the header.
export async function fetchHealth(): Promise<Health> {
  try {
    const response = await fetch(`${API_URL}/health`)
    const data = await response.json()

    // The server responded, but couldn't reach the database.
    if (!response.ok) {
      return { state: 'error', message: data.detail ?? 'Unknown error' }
    }

    return { state: 'ok' }
  } catch (error) {
    // Couldn't reach the backend at all – the server is down or CORS is blocking.
    return { state: 'error', message: (error as Error).message }
  }
}
