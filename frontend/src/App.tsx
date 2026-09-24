import { useEffect, useMemo, useState } from 'react'
import { API_URL, fetchOffers } from './api'
import { STORES } from './types'
import type { Offer } from './types'

// De lägen sidan kan vara i medan den hämtar erbjudanden.
type Load =
  | { state: 'loading' }
  | { state: 'ok'; offers: Offer[] }
  | { state: 'error'; message: string }

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  // Vilka butiker som är förkryssade. Tom lista betyder "visa alla".
  const [stores, setStores] = useState<string[]>([])

  // Körs en gång när sidan laddas: hämta erbjudandena från backend.
  useEffect(() => {
    fetchOffers()
      .then((offers) => setLoad({ state: 'ok', offers }))
      .catch((error: Error) => setLoad({ state: 'error', message: error.message }))
  }, [])

  // Filtrerar om bara när listan eller kryssrutorna faktiskt ändrats.
  const visible = useMemo(() => {
    if (load.state !== 'ok') return []
    if (stores.length === 0) return load.offers
    return load.offers.filter((offer) => stores.includes(offer.store))
  }, [load, stores])

  // Kryssar i butiken om den är omarkerad, kryssar ur om den redan är vald.
  const toggleStore = (store: string) =>
    setStores((current) =>
      current.includes(store) ? current.filter((s) => s !== store) : [...current, store],
    )

  if (load.state === 'loading') {
    return <p className="status">Hämtar erbjudanden…</p>
  }

  if (load.state === 'error') {
    return (
      <div className="status">
        <h1>GameGrab</h1>
        <p className="error">Ingen kontakt med backend: {load.message}</p>
        <p>Kontrollera att servern kör på {API_URL}</p>
      </div>
    )
  }

  return (
    <>
      <header>
        <h1>GameGrab</h1>
        <p>Gratis och rabatterade PC-spel, samlade på ett ställe.</p>
      </header>

      <div className="layout">
        <aside>
          <h2>Butik</h2>
          {STORES.map((store) => (
            <label key={store} className="filter-option">
              <input
                type="checkbox"
                checked={stores.includes(store)}
                onChange={() => toggleStore(store)}
              />
              {store}
            </label>
          ))}

          <button type="button" onClick={() => setStores([])} disabled={stores.length === 0}>
            Visa alla
          </button>
        </aside>

        <main>
          <p className="count">
            <strong>{visible.length}</strong> erbjudanden
          </p>

          <ul className="offers">
            {visible.map((offer) => (
              <li key={offer.id}>
                <span className="store">{offer.store}</span>

                <h3>{offer.title}</h3>

                <p className="price">
                  {offer.is_free ? (
                    <strong>Gratis just nu</strong>
                  ) : (
                    <>
                      <s>${offer.normal_price.toFixed(2)}</s> ${offer.sale_price.toFixed(2)}
                    </>
                  )}{' '}
                  <span className="savings">−{Math.round(offer.savings)}%</span>
                </p>

                {/* Lämnar sidan, så vi öppnar i ny flik. */}
                <a href={offer.claim_url} target="_blank" rel="noopener noreferrer">
                  Hämta på {offer.store} →
                </a>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </>
  )
}

export default App
