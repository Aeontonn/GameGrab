import type { Offer } from './types'

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

  return response.json()
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
