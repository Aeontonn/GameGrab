import { useEffect, useMemo, useState } from 'react'
import { API_URL, fetchFreeGames, fetchOffers } from './api'
import { STORES } from './types'
import type { FreeGame, Offer } from './types'

// Kryssar i värdet om det är omarkerat, kryssar ur det om det redan är valt.
const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

// Texten som visar hur länge erbjudandet gäller, eller null om butiken inte
// uppger något slutdatum. Räknar hela dygn framåt, så "2 dagar kvar" betyder
// att det finns minst 2 dygn kvar – och sista dygnet säger vi timmar, för
// "0 dagar kvar" låter som att det redan är slut.
const timeLeft = (endsAt: string | null): string | null => {
  if (!endsAt) return null

  const msLeft = new Date(endsAt).getTime() - Date.now()
  if (msLeft <= 0) return 'Slutar snart'

  const hours = Math.floor(msLeft / 3_600_000)
  if (hours < 24) return hours <= 1 ? 'Mindre än 1 timme kvar' : `${hours} timmar kvar`

  const days = Math.floor(hours / 24)
  return days === 1 ? '1 dag kvar' : `${days} dagar kvar`
}

// "Slutar snart" visar erbjudanden som går ut inom så här många dagar.
const ENDING_SOON_DAYS = 7

// Ett erbjudande som kort. Används både i "Slutar snart" och i huvudlistan.
function OfferCard({ offer }: { offer: Offer }) {
  const left = timeLeft(offer.ends_at)

  return (
    <li>
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

      {left && <p className="time-left">{left}</p>}

      {/* Lämnar sidan, så vi öppnar i ny flik. */}
      <a href={offer.claim_url} target="_blank" rel="noopener noreferrer">
        Hämta på {offer.store} →
      </a>
    </li>
  )
}

// De lägen sidan kan vara i medan den hämtar erbjudanden.
type Load =
  | { state: 'loading' }
  | { state: 'ok'; offers: Offer[] }
  | { state: 'error'; message: string }

// "Alltid gratis" laddas för sig, så att ett fel där inte tar ner erbjudandena.
type FreeLoad =
  | { state: 'loading' }
  | { state: 'ok'; games: FreeGame[] }
  | { state: 'error' }

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [freeLoad, setFreeLoad] = useState<FreeLoad>({ state: 'loading' })

  // Tiden när sidan öppnades. Avgör vad som räknas som "slutar snart".
  const [openedAt] = useState(() => Date.now())

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

  useEffect(() => {
    fetchFreeGames()
      .then((games) => setFreeLoad({ state: 'ok', games }))
      .catch(() => setFreeLoad({ state: 'error' }))
  }, [])

  const freeGames = useMemo(
    () => (freeLoad.state === 'ok' ? freeLoad.games : []),
    [freeLoad],
  )

  // Genrerna som faktiskt finns bland spelen, i bokstavsordning. Hämtas ur
  // datan i stället för att skrivas in, så att filtret aldrig visar en genre
  // som inte har några spel. Gäller båda sektionerna.
  const allGenres = useMemo(() => {
    const offers = load.state === 'ok' ? load.offers : []
    const found = new Set([
      ...offers.flatMap((offer) => offer.genres),
      ...freeGames.flatMap((game) => game.genres),
    ])
    return [...found].sort((a, b) => a.localeCompare(b, 'en'))
  }, [load, freeGames])

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

  // Erbjudanden som går ut inom en vecka, det som slutar först överst.
  // Bygger på de filtrerade erbjudandena, så att butik och genre gäller här
  // också. Spelen finns kvar i huvudlistan – sektionen är en genväg, inte
  // en egen hög. Erbjudanden utan känt slutdatum kan inte hamna här.
  //
  // Gränsen följer det kortet visar: allt som står som "7 dagar kvar" eller
  // mindre ska med. Kortet avrundar nedåt, så 7 dagar och 8 timmar visas som
  // "7 dagar kvar" – därför går gränsen vid 8 hela dygn, inte 7.
  const endingSoon = useMemo(() => {
    const limit = openedAt + (ENDING_SOON_DAYS + 1) * 24 * 3_600_000
    return visible
      .filter((offer) => offer.ends_at && new Date(offer.ends_at).getTime() < limit)
      .sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime())
  }, [visible, openedAt])

  // Genrefiltret gäller även "Alltid gratis". Butiksfiltret gör det inte,
  // eftersom de spelen nästan alla ligger på Steam.
  const visibleFree = useMemo(
    () =>
      freeGames.filter(
        (game) => genres.length === 0 || game.genres.some((genre) => genres.includes(genre)),
      ),
    [freeGames, genres],
  )

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
          {/* Döljs helt när inget slutar inom en vecka, i stället för att
              visa en tom rubrik. */}
          {endingSoon.length > 0 && (
            <section className="ending-soon">
              <h2>Slutar snart</h2>
              <p className="count">
                <strong>{endingSoon.length}</strong> erbjudanden går ut inom {ENDING_SOON_DAYS} dagar
              </p>

              <ul className="offers">
                {endingSoon.map((offer) => (
                  <OfferCard key={offer.id} offer={offer} />
                ))}
              </ul>
            </section>
          )}

          <h2>Gratis och på rea</h2>
          <p className="count">
            <strong>{visible.length}</strong> erbjudanden
          </p>

          <ul className="offers">
            {visible.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </ul>

          {freeLoad.state !== 'loading' && (
            <section className="always-free">
              <h2>Populära gratisspel</h2>

              {freeLoad.state === 'error' ? (
                <p className="error">Kunde inte hämta listan över gratisspel.</p>
              ) : (
                <>
                  <p className="count">
                    <strong>{visibleFree.length}</strong> free to play-spel
                  </p>

                  <ul className="free-games">
                    {visibleFree.map((game) => (
                      <li key={game.id}>
                        <a href={game.claim_url} target="_blank" rel="noopener noreferrer">
                          {game.title}
                        </a>
                        {game.genres.length > 0 && (
                          <span className="genres">{game.genres.slice(0, 3).join(' · ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
        </main>
      </div>
    </>
  )
}

export default App
