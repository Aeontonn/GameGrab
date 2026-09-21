import { useEffect, useState } from 'react'

// Adressen till backend. Sätts som miljövariabel vid deploy, annars används den lokala servern.
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// De tre lägen appen kan vara i medan den frågar backend.
type Status =
  | { state: 'loading' }
  | { state: 'ok' }
  | { state: 'error'; message: string }

function App() {
  const [status, setStatus] = useState<Status>({ state: 'loading' })

  //Körs en gång när sidan laddas: fråga backend om den mår bra.
  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then(async (response) => {
        const data = await response.json()

        // Servern svarade, men kunde inte nå databasen.
        if (!response.ok) {
          setStatus({ state: 'error', message: data.detail ?? 'Okänt fel' })
          return
        }

        setStatus({ state: 'ok' })
      })
      // Kom inte fram till backend alls – servern är nere eller CORS blockerar.
      .catch((error: Error) => {
        setStatus({ state: 'error', message: error.message })
      })
  }, [])

  return (
    <main>
      <h1>GameGrab</h1>
      <p>Backend: {API_URL}</p>

      {status.state === 'loading' && <p>Kontrollerar anslutning…</p>}

      {status.state === 'ok' && (
        <p style={{ color: 'green' }}>Ansluten till backend och databas</p>
      )}

      {status.state === 'error' && (
        <p style={{ color: 'red' }}>Ingen kontakt: {status.message}</p>
      )}
    </main>
  )
}

export default App
