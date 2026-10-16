import { useCallback, useEffect, useMemo, useState } from 'react'
import Account from './Account'
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
const withoutRequirementLabel = (value: string): string =>
  value.replace(/^(Minimum|Recommended):\s*/i, '')

const ITEMS_PER_PAGE = 12

// One offer as a card.
function OfferCard({ offer }: { offer: Offer }) {
  const left = timeLeft(offer.ends_at)
  const [copied, setCopied] = useState(false)
  const [requirementsOpen, setRequirementsOpen] = useState(false)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(offer.claim_url)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 2000)
    } catch (error) {
      console.error('Could not copy link:', error)
    }
  }

  return (
    <li>
      {offer.thumb && <img className="game-image" src={offer.thumb} alt={offer.title} />}
      <span className="store">{offer.store}</span>
      <h3>{offer.title}</h3>
      {offer.launcher_notice && (
        <p className="launcher-warning">⚠ Also requires: {offer.launcher_notice}</p>
      )}
      {offer.genres.length > 0 && <p className="genres">{offer.genres.join(' · ')}</p>}
      {offer.description && (
        <p className="description">{offer.description}</p>
      )}
      {(offer.minimum_requirements || offer.recommended_requirements) && (
        <div className="system-requirements">
          <button
            type="button"
            className="requirements-button"
            onClick={() => setRequirementsOpen((current) => !current)}
            aria-expanded={requirementsOpen}
          >
            <span>System requirements</span>
            <span aria-hidden="true">{requirementsOpen ? '−' : '+'}</span>
          </button>
          {requirementsOpen && (
            <div className="requirements-content">
              {offer.minimum_requirements && (
                <div>
                  <h4>Minimum</h4>
                  <p>{withoutRequirementLabel(offer.minimum_requirements)}</p>
                </div>
              )}
              {offer.recommended_requirements && (
                <div>
                  <h4>Recommended</h4>
                  <p>{withoutRequirementLabel(offer.recommended_requirements)}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
      <div className="offer-actions">
        <a href={offer.claim_url} target="_blank" rel="noopener noreferrer">
          Get it on {offer.store} →
        </a>
        <button
          type="button"
          className="share-button"
          onClick={copyLink}
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
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
  const [openedAt] = useState(() => Date.now())
  const [stores, setStores] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [endingWithinDays, setEndingWithinDays] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [atTop, setAtTop] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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

  useEffect(() => {
    setCurrentPage(1)
  }, [stores, genres, endingWithinDays, searchTerm])

  const freeGames = useMemo(
    () => (freeLoad.state === 'ok' ? freeLoad.games : []),
    [freeLoad],
  )

  const allGenres = useMemo(() => {
    const offers = load.state === 'ok' ? load.offers : []
    const found = new Set([
      ...offers.flatMap((offer) => offer.genres),
      ...freeGames.flatMap((game) => game.genres),
    ])
    return [...found].sort((a, b) => a.localeCompare(b, 'en'))
  }, [load, freeGames])

  const matchesSearch = useCallback(
    (title: string) => title.toLowerCase().includes(searchTerm.trim().toLowerCase()),
    [searchTerm],
  )

  const visible = useMemo(() => {
    if (load.state !== 'ok') return []
    const filtered = load.offers.filter(
      (offer) =>
        (stores.length === 0 || stores.includes(offer.store)) &&
        (genres.length === 0 || offer.genres.some((genre) => genres.includes(genre))) &&
        matchesSearch(offer.title),
    )
    if (endingWithinDays === null) return filtered
    const limit = openedAt + endingWithinDays * 24 * 3_600_000
    return filtered.filter(
      (offer) => offer.ends_at && new Date(offer.ends_at).getTime() < limit,
    )
  }, [load, stores, genres, endingWithinDays, openedAt, matchesSearch])

  const totalPages = Math.max(1, Math.ceil(visible.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)

  const paginatedOffers = useMemo(() => {
    const start = (safePage - 1) * ITEMS_PER_PAGE
    return visible.slice(start, start + ITEMS_PER_PAGE)
  }, [visible, safePage])

  const visibleFree = useMemo(
    () =>
      freeGames.filter(
        (game) =>
          (genres.length === 0 || game.genres.some((genre) => genres.includes(genre))) &&
          matchesSearch(game.title),
      ),
    [freeGames, genres, matchesSearch],
  )

  const activeFilters = stores.length + genres.length + (endingWithinDays !== null ? 1 : 0)
  const anyFilter = activeFilters > 0

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
        <div>
          <h1>GameGrab</h1>
          <p>Free and discounted PC games, all in one place.</p>
        </div>
        <Account />
      </header>
      <div className="layout">
        <aside>
          <button
            type="button"
            className="filter-toggle"
            onClick={() => setFiltersOpen((current) => !current)}
            aria-expanded={filtersOpen}
            aria-controls="filter-panel"
          >
            <span>Filter{anyFilter && ` (${activeFilters})`}</span>
            <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
          </button>
          <div id="filter-panel" className={filtersOpen ? 'filter-panel open' : 'filter-panel'}>
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
                setEndingWithinDays(null)
              }}
              disabled={!anyFilter}
            >
              Show all
            </button>
            <div className="time-filter">
              <h2>Time left</h2>
              {[1, 2, 7].map((days) => (
                <label key={days} className="filter-option">
                  <input
                    type="radio"
                    name="time-left"
                    checked={endingWithinDays === days}
                    onChange={() => setEndingWithinDays(days)}
                  />
                  Ends within {days} {days === 1 ? 'day' : 'days'}
                </label>
              ))}
            </div>
          </div>
        </aside>
        <main>
          <h2>Free and on sale</h2>
          <div className="search-bar">
            <span className="search-icon">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="10.5" cy="10.5" r="7.5" />
                <line x1="16" y1="16" x2="22.5" y2="22.5" />
              </svg>
            </span>
            <input
              type="search"
              placeholder="Search for games..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {freeLoad.state === 'ok' && (
            <button
              type="button"
              className="jump-button"
              onClick={() =>
                document
                  .getElementById('always-free')
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              Jump to free to play games ↓
            </button>
          )}
          <p className="count">
            <strong>{visible.length}</strong>{' '}
            {endingWithinDays !== null
              ? `offers ending within ${endingWithinDays} ${endingWithinDays === 1 ? 'day' : 'days'}`
              : 'offers'}
          </p>
          <ul className="offers">
            {paginatedOffers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </ul>

          {/* Clean pagination with scroll to top */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                type="button"
                onClick={() => {
                  setCurrentPage((p) => Math.max(1, p - 1))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                disabled={safePage === 1}
              >
                ← Previous
              </button>

              <span className="page-indicator">
                {safePage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => {
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                disabled={safePage === totalPages}
              >
                Next →
              </button>
            </div>
          )}

          {freeLoad.state !== 'loading' && (
            <section className="always-free" id="always-free">
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
      <button
        type="button"
        className={atTop ? 'to-top-button at-top' : 'to-top-button'}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
      >
        ↑ Top
      </button>
    </>
  )
}

export default App