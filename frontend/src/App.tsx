import { useCallback, useEffect, useMemo, useState } from 'react'
import Account from './Account'
import { API_URL, fetchFreeGames, fetchOffers } from './api'
import { STORES } from './types'
import type { FreeGame, Offer } from './types'

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

const timeLeft = (endsAt: string | null): string | null => {
  if (!endsAt) return null
  const msLeft = new Date(endsAt).getTime() - Date.now()
  if (msLeft <= 0) return 'Ending soon'
  const hours = Math.floor(msLeft / 3_600_000)
  if (hours < 24) return hours <= 1 ? 'Less than 1 hour left' : `${hours} hours left`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day left' : `${days} days left`
}

const withoutRequirementLabel = (value: string): string =>
  value.replace(/^(Minimum|Recommended):\s*/i, '')

const ITEMS_PER_PAGE = 40

function OfferCard({ offer, onClick }: { offer: Offer; onClick: () => void }) {
  const shortDescription = offer.description
    ? offer.description.split('.')[0].trim() + '.'
    : null

  const hasReviews =
    offer.review_positive_percent !== null &&
    offer.review_total !== null &&
    offer.review_total > 0 &&
    offer.review_source

  return (
    <li onClick={onClick} style={{ cursor: 'pointer' }}>
      {offer.thumb && <img className="game-image" src={offer.thumb} alt={offer.title} />}
      <span className="store">{offer.store}</span>
      <h3>{offer.title}</h3>
      {offer.launcher_notice && (
        <p className="launcher-warning">⚠ Also requires: {offer.launcher_notice}</p>
      )}
      {offer.genres.length > 0 && (
        <p className="genres" style={{ fontWeight: 600 }}>
          {offer.genres.join(' · ')}
        </p>
      )}
      {shortDescription && (
        <p className="description">{shortDescription}</p>
      )}
      {hasReviews && (
        <p className="game-reviews" style={{ color: 'var(--text-dim)', fontWeight: 600, margin: '4px 0 8px' }}>
          {Math.round(offer.review_positive_percent!)}% positive
          {' · '}
          {offer.review_total!.toLocaleString('en-US')} reviews on {offer.review_source}
        </p>
      )}
      <p className="price">
        {offer.is_free ? (
          <>
            <s>${offer.normal_price.toFixed(2)}</s>{' '}
            <strong style={{ color: 'var(--ok)' }}>Free right now</strong>
          </>
        ) : (
          <>
            <s>${offer.normal_price.toFixed(2)}</s>{' '}
            <span style={{ color: 'var(--ok)' }}>${offer.sale_price.toFixed(2)}</span>
          </>
        )}{' '}
        <span className="savings">−{Math.round(offer.savings)}%</span>
      </p>
      <p className="time-left" style={{ margin: 0 }}>Ending soon</p>
    </li>
  )
}

type Load =
  | { state: 'loading' }
  | { state: 'ok'; offers: Offer[] }
  | { state: 'error'; message: string }

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
  const [showTimeFilter, setShowTimeFilter] = useState(false)
  const [genres, setGenres] = useState<string[]>([])
  const [endingWithinDays, setEndingWithinDays] = useState<number | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [atTop, setAtTop] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

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

  useEffect(() => {
    const html = document.documentElement
    if (selectedOffer) {
      html.style.overflow = 'hidden'
    } else {
      html.style.overflow = ''
      setRequirementsOpen(false)
    }
    return () => {
      html.style.overflow = ''
    }
  }, [selectedOffer])

  useEffect(() => {
    document.documentElement.style.scrollbarGutter = 'stable'
  }, [])

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

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error(err)
    }
  }

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
          </div>
        </aside>

        <main>
          <h2>Free and on sale</h2>
          <div className="search-bar">
            <span className="search-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
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
            <button
              className="search-action"
              type="button"
              onClick={() => setShowTimeFilter(!showTimeFilter)}
            >
              ☰
            </button>
            {showTimeFilter && (
              <div className="time-filter">
                {[1, 7].map((days) => (
                  <label key={days} className="filter-option">
                    <input
                      type="checkbox"
                      name="time-left"
                      checked={endingWithinDays === days}
                      onChange={() =>
                        setEndingWithinDays(endingWithinDays === days ? null : days)
                      }
                    />
                    Ends in {days} {days === 1 ? 'day' : 'days'}
                  </label>
                ))}
              </div>
            )}
          </div>

          {freeLoad.state === 'ok' && (
            <button
              type="button"
              className="jump-button"
              onClick={() =>
                document.getElementById('always-free')?.scrollIntoView({ behavior: 'smooth' })
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
              <OfferCard key={offer.id} offer={offer} onClick={() => setSelectedOffer(offer)} />
            ))}
          </ul>

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

      {selectedOffer && (
        <div className="modal-overlay" onClick={() => setSelectedOffer(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px', overflow: 'visible' }}>
            <button className="modal-close" onClick={() => setSelectedOffer(null)} aria-label="Close">
              ×
            </button>
            {selectedOffer.thumb && (
              <img className="modal-image" src={selectedOffer.thumb} alt={selectedOffer.title} style={{ height: '110px' }} />
            )}
            <div className="modal-content" style={{ padding: '12px 14px' }}>
              <span className="store" style={{ fontSize: '11px' }}>{selectedOffer.store}</span>
              <h2 style={{ fontSize: '17px', margin: '2px 0 6px' }}>{selectedOffer.title}</h2>

              {selectedOffer.genres.length > 0 && (
                <p style={{ margin: '4px 0', fontSize: '12px' }}>
                  <strong style={{ color: 'var(--text)' }}>Genres</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>{selectedOffer.genres.join(' · ')}</span>
                </p>
              )}

              {selectedOffer.description && (
                <>
                  <p style={{ margin: '8px 0 2px', fontWeight: 600, color: 'var(--text)', fontSize: '12px' }}>Description</p>
                  <p className="description" style={{ fontSize: '12px', margin: '0 0 6px', lineHeight: 1.35 }}>{selectedOffer.description}</p>
                </>
              )}

              {selectedOffer.review_positive_percent !== null &&
                selectedOffer.review_total !== null &&
                selectedOffer.review_total > 0 &&
                selectedOffer.review_source && (
                  <p style={{ color: 'var(--text-dim)', fontWeight: 600, fontSize: '12px', margin: '6px 0' }}>
                    {Math.round(selectedOffer.review_positive_percent)}% positive
                    {' · '}
                    {selectedOffer.review_total.toLocaleString('en-US')} reviews on {selectedOffer.review_source}
                  </p>
                )}

              {(selectedOffer.minimum_requirements || selectedOffer.recommended_requirements) && (
                <div style={{ marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setRequirementsOpen((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text)',
                      fontWeight: 600,
                      fontSize: '12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '4px 0',
                    }}
                  >
                    <span>System requirements</span>
                    <span>{requirementsOpen ? '−' : '+'}</span>
                  </button>
                  {requirementsOpen && (
                    <div className="requirements-content" style={{ marginTop: '4px', fontSize: '11px', maxHeight: '50px', overflowY: 'auto' }}>
                      {selectedOffer.minimum_requirements && (
                        <div>
                          <h4>Minimum</h4>
                          <p>{withoutRequirementLabel(selectedOffer.minimum_requirements)}</p>
                        </div>
                      )}
                      {selectedOffer.recommended_requirements && (
                        <div>
                          <h4>Recommended</h4>
                          <p>{withoutRequirementLabel(selectedOffer.recommended_requirements)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Price</div>
                  <p className="price" style={{ margin: 0, fontSize: '12px' }}>
                    {selectedOffer.is_free ? (
                      <>
                        <s>${selectedOffer.normal_price.toFixed(2)}</s>{' '}
                        <strong style={{ color: 'var(--ok)' }}>Free right now</strong>
                      </>
                    ) : (
                      <>
                        <s>${selectedOffer.normal_price.toFixed(2)}</s>{' '}
                        <span style={{ color: 'var(--ok)' }}>${selectedOffer.sale_price.toFixed(2)}</span>
                      </>
                    )}{' '}
                    <span className="savings">−{Math.round(selectedOffer.savings)}%</span>
                  </p>
                </div>
                <div style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '6px', padding: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginBottom: '2px' }}>Time Left</div>
                  <div style={{ fontWeight: 600, fontSize: '12px' }}>{timeLeft(selectedOffer.ends_at) || '—'}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                <a
                  href={selectedOffer.claim_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary-button"
                  style={{ textAlign: 'center', padding: '7px 10px', fontSize: '13px' }}
                >
                  Get it on {selectedOffer.store} →
                </a>
                <button
                  type="button"
                  className="share-button"
                  onClick={() => copyLink(selectedOffer.claim_url)}
                  style={{ width: '100%', padding: '7px 10px', fontSize: '13px' }}
                >
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default App