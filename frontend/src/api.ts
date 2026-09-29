import type { FreeGame, Offer } from './types'

// Adressen till backend. Sätts som miljövariabel vid deploy, annars den lokala servern.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export { API_URL }

// Hämtar alla erbjudanden. Backend sorterar redan gratis först och
// största rabatten därefter, så vi behöver inte sortera om här.
export async function fetchOffers(): Promise<Offer[]> {
  const response = await fetch(`${API_URL}/offers`)

  // Backend svarar 503 om den inte når databasen. Då ska vi visa ett fel,
  // inte en tom lista – en tom lista ser ut som "inga erbjudanden finns".
  if (!response.ok) {
    throw new Error(`Backend svarade ${response.status}`)
  }

  const offers: Offer[] = await response.json()

  // En äldre backend skickar inga genrer. Då behandlar vi dem som tomma i
  // stället för att låta sidan krascha när någon filtrerar på genre.
  // Samma sak för slutdatum: saknas fältet betyder det "okänt".
  return offers.map((offer) => ({
    ...offer,
    genres: offer.genres ?? [],
    ends_at: offer.ends_at ?? null,
  }))
}

// Hämtar spelen som alltid är gratis. Backend sorterar dem redan med de
// mest spelade först.
export async function fetchFreeGames(): Promise<FreeGame[]> {
  const response = await fetch(`${API_URL}/free-games`)

  if (!response.ok) {
    throw new Error(`Backend svarade ${response.status}`)
  }

  const games: FreeGame[] = await response.json()
  return games.map((game) => ({ ...game, genres: game.genres ?? [] }))
}

export type Health =
  | { state: 'loading' }
  | { state: 'ok' }
  | { state: 'error'; message: string }

// Kollar att backend och databasen svarar. Visas i sidhuvudet.
export async function fetchHealth(): Promise<Health> {
  try {
    const response = await fetch(`${API_URL}/health`)
    const data = await response.json()

    // Servern svarade, men kunde inte nå databasen.
    if (!response.ok) {
      return { state: 'error', message: data.detail ?? 'Okänt fel' }
    }

    return { state: 'ok' }
  } catch (error) {
    // Kom inte fram till backend alls – servern är nere eller CORS blockerar.
    return { state: 'error', message: (error as Error).message }
  }
}
