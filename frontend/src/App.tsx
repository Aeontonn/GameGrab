import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_URL, fetchFreeGames, fetchOffers } from './api'
import { STORES } from './types'
import type { FreeGame, Offer } from './types'

// Checks the value if it's unchecked, unchecks it if it's already selected.
const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

// The text that shows how long the offer lasts, or null if the store doesn't
// provide an end date. Counts whole days ahead, so "2 days left" means there
// are at least 2 full days left – and on the last day we say hours, because
// "0 days left" sounds like it has already ended.
const timeLeft = (endsAt: string | null): string | null => {
  if (!endsAt) return null

  const msLeft = new Date(endsAt).getTime() - Date.now()
  if (msLeft <= 0) return 'Ending soon'

  const hours = Math.floor(msLeft / 3_600_000)
  if (hours < 24) return hours <= 1 ? 'Less than 1 hour left' : `${hours} hours left`

  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day left' : `${days} days left`
}

// The "Ends within 2 days" option shows offers that expire within this many days.
// With 7 days nearly every offer was included, so the option said nothing.
const ENDING_SOON_DAYS = 2

// One offer as a card.
function OfferCard({ offer }: { offer: Offer }) {
  const left = timeLeft(offer.ends_at)

  return (
    <li>
      {offer.thumb && <img className="game-image" src={offer.thumb} alt={offer.title} />}

      <span className="store">{offer.store}</span>

      <h3>{offer.title}</h3>

      {offer.genres.length > 0 && <p className="genres">{offer.genres.join(' · ')}</p>}

      <p className="price">
        {offer.is_free ? (
          <>
            <s>${offer.normal_price.toFixed(2)}</s>{' '}
            <strong>Free right now</strong>
          </>
        ) : (
          <>
            <s>${offer.normal_price.toFixed(2)}</s>{' '}
            ${offer.sale_price.toFixed(2)}
          </>
        )}{' '}
        <span className="savings">−{Math.round(offer.savings)}%</span>
      </p>

      {left && <p className="time-left">{left}</p>}

      {/* Leaves the site, so we open in a new tab. */}
      <a href={offer.claim_url} target="_blank" rel="noopener noreferrer">
        Get it on {offer.store} →
      </a>
    </li>
  )
}

// The states the page can be in while it fetches offers.
type Load =
  | { state: 'loading' }
  | { state: 'ok'; offers: Offer[] }
  | { state: 'error'; message: string }

// "Always free" loads separately, so an error there doesn't take down the offers.
type FreeLoad =
  | { state: 'loading' }
  | { state: 'ok'; games: FreeGame[] }
  | { state: 'error' }

function App() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [freeLoad, setFreeLoad] = useState<FreeLoad>({ state: 'loading' })

  // The time the page was opened. Decides what counts as "ending soon".
  const [openedAt] = useState(() => Date.now())

  // Which stores are checked. An empty list means "show all".
  const [stores, setStores] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  // Which genres are checked. An empty list means "show all".
  const [genres, setGenres] = useState<string[]>([])

  // Whether only offers ending soon should be shown. Off by default – the
  // visitor has to actively choose it.
  const [endingSoonOnly, setEndingSoonOnly] = useState(false)

  // Runs once when the page loads: fetch the offers from the backend.
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

  // The genres that actually exist among the games, in alphabetical order. Taken
  // from the data instead of being hardcoded, so the filter never shows a genre
  // that has no games. Applies to both sections.
  const allGenres = useMemo(() => {
    const offers = load.state === 'ok' ? load.offers : []
    const found = new Set([
      ...offers.flatMap((offer) => offer.genres),
      ...freeGames.flatMap((game) => game.genres),
    ])
    return [...found].sort((a, b) => a.localeCompare(b, 'en'))
  }, [load, freeGames])

  // The search field matches on the title, case-insensitively.
  const matchesSearch = useCallback(
    (title: string) => title.toLowerCase().includes(searchTerm.trim().toLowerCase()),
    [searchTerm],
  )

  // A game is shown if it matches any of the selected stores and any of the
  // selected genres. An empty group doesn't filter at all.
  //
  // With "Ends within 2 days" checked, only offers with a known end date
  // within the limit are shown, and whatever ends first is at the top.
  // The limit follows what the card shows: everything shown as "2 days left"
  // or less should be included. The card rounds down, so 2 days and 8 hours
  // shows as "2 days left" – that's why the limit is one extra day.
  const visible = useMemo(() => {
    if (load.state !== 'ok') return []

    const filtered = load.offers.filter(
      (offer) =>
        (stores.length === 0 || stores.includes(offer.store)) &&
        (genres.length === 0 || offer.genres.some((genre) => genres.includes(genre))) &&
        matchesSearch(offer.title),
    )
    if (!endingSoonOnly) return filtered

    const limit = openedAt + (ENDING_SOON_DAYS + 1) * 24 * 3_600_000
    return filtered
      .filter((offer) => offer.ends_at && new Date(offer.ends_at).getTime() < limit)
      .sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime())
  }, [load, stores, genres, endingSoonOnly, openedAt, matchesSearch])

  // The genre filter also applies to "Always free". The store filter doesn't,
  // since nearly all of those games are on Steam.
  const visibleFree = useMemo(
    () =>
      freeGames.filter(
        (game) =>
          (genres.length === 0 || game.genres.some((genre) => genres.includes(genre))) &&
          matchesSearch(game.title),
      ),
    [freeGames, genres, matchesSearch],
  )

  const anyFilter = stores.length > 0 || genres.length > 0 || endingSoonOnly

  if (load.state === 'loading') {
    return <p className="status">Fetching offers…</p>
  }

  if (load.state === 'error') {
    return (
      <div className="status">
        <h1>GameGrab</h1>
        <p className="error">Can't reach the backend: {load.message}</p>
        <p>Check that the server is running on {API_URL}</p>
      </div>
    )
  }

  return (
    <>
      <header>
        <h1>GameGrab</h1>
        <p>Free and discounted PC games, all in one place.</p>
      </header>

      <div className="layout">
        <aside>
          <h2>Store</h2>
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
              setEndingSoonOnly(false)
            }}
            disabled={!anyFilter}
          >
            Show all
          </button>

          {/* Sits below "Show all", separate from store and genre: it's a
              choice you make actively, not one of the regular filters. */}
          <div className="time-filter">
            <h2>Time left</h2>
            <label className="filter-option">
              <input
                type="checkbox"
                checked={endingSoonOnly}
                onChange={() => setEndingSoonOnly((current) => !current)}
              />
              Ends within {ENDING_SOON_DAYS} days
            </label>
          </div>
        </aside>

        <main>
          <h2>Free and on sale</h2>
          <div className="search-bar">
            <span className="search-icon">⌕</span>

            <input
              type="search"
              placeholder="Search for games..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            <button className="search-action" type="button">
              Filter
            </button>
          </div>

          <p className="count">
            <strong>{visible.length}</strong>{' '}
            {endingSoonOnly ? `offers ending within ${ENDING_SOON_DAYS} days` : 'offers'}
          </p>

          <ul className="offers">
            {visible.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </ul>

          {freeLoad.state !== 'loading' && (
            <section className="always-free">
              <h2>Popular free games</h2>

              {freeLoad.state === 'error' ? (
                <p className="error">Couldn't fetch the list of free games.</p>
              ) : (
                <>
                  <p className="count">
                    <strong>{visibleFree.length}</strong> free to play games
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
