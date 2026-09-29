import { useEffect, useMemo, useState } from 'react'
import { API_URL, fetchOffers } from './api'
import { STORES } from './types'
import type { Offer } from './types'

// Kryssar i värdet om det är omarkerat, kryssar ur det om det redan är valt.
const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

// De lägen sidan kan vara i medan den hämtar erbjudanden.
type Load =
  | { state: 'loading' }
  | { state: 'ok'; offers: Offer[] }
  | { state: 'error'; message: string }

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  // Vilka butiker som är förkryssade. Tom lista betyder "visa alla".
  const [stores, setStores] = useState<string[]>([])

  // Vilka genrer som är förkryssade. Tom lista betyder "visa alla".
  const [genres, setGenres] = useState<string[]>([])

  // Körs en gång när sidan laddas: hämta erbjudandena från backend.
  useEffect(() => {
    fetchOffers()
      .then((offers) => setLoad({ state: 'ok', offers }))
      .catch((error: Error) => setLoad({ state: 'error', message: error.message }))
  }, [])

  // Genrerna som faktiskt finns bland spelen, i bokstavsordning. Hämtas ur
  // datan i stället för att skrivas in, så att filtret aldrig visar en genre
  // som inte har några spel.
  const allGenres = useMemo(() => {
    if (load.state !== 'ok') return []
    const found = new Set(load.offers.flatMap((offer) => offer.genres))
    return [...found].sort((a, b) => a.localeCompare(b, 'en'))
  }, [load])

  // Ett spel visas om det matchar någon av de valda butikerna och någon av
  // de valda genrerna. Är en grupp tom filtrerar den inte alls.
  const visible = useMemo(() => {
    if (load.state !== 'ok') return []
    return load.offers.filter(
      (offer) =>
        (stores.length === 0 || stores.includes(offer.store)) &&
        (genres.length === 0 || offer.genres.some((genre) => genres.includes(genre))),
    )
  }, [load, stores, genres])

  const anyFilter = stores.length > 0 || genres.length > 0

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
                onChange={() => setStores((current) => toggle(current, store))}
              />
              {store}
            </label>
          ))}

          <h2>Genre</h2>
          {allGenres.map((genre) => (
            <label key={genre} className="filter-option">
              <input
                type="checkbox"
                checked={genres.includes(genre)}
                onChange={() => setGenres((current) => toggle(current, genre))}
              />
              {genre}
            </label>
          ))}

          <button
            type="button"
            onClick={() => {
              setStores([])
              setGenres([])
            }}
            disabled={!anyFilter}
          >
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
                {offer.thumb && (
                  <img
                    className="game-image"
                    src={offer.thumb}
                    alt={offer.title}
                  />
                )}
                
                <span className="store">{offer.store}</span>

                <h3>{offer.title}</h3>

                {offer.genres.length > 0 && <p className="genres">{offer.genres.join(' · ')}</p>}

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
