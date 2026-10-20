import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import Account from './Account'
import { API_URL, fetchFreeGames, fetchOffers } from './api'
import { openInApp } from './appLink'
import { STORES } from './types'
import type { FreeGame, Offer } from './types'

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value]

// Exact time left, e.g. "2 d 4 h left". soon is true for the last 24 hours,
// so the cards that really are about to end can stand out.
const timeLeft = (endsAt: string | null, now: number): { text: string; soon: boolean } | null => {
  if (!endsAt) return null
  const msLeft = new Date(endsAt).getTime() - now
  if (msLeft <= 0) return { text: 'Ending now', soon: true }
  const hours = Math.floor(msLeft / 3_600_000)
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000)
  if (hours < 24) return { text: `${hours} h ${minutes} min left`, soon: true }
  return { text: `${Math.floor(hours / 24)} d ${hours % 24} h left`, soon: false }
}

const withoutRequirementLabel = (value: string): string =>
  value.replace(/^(Minimum|Recommended):\s*/i, '')

const money = (value: number) => `$${value.toFixed(2)}`

// 143350 → "143k", so the review count fits on one line.
const compact = (value: number) =>
  value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value)

const STORE_COLORS: Record<string, string> = {
  Steam: 'var(--steam)',
  GOG: 'var(--gog)',
  'Epic Games': 'var(--epic)',
}

// The "Ends" filter. null means no limit.
const TIME_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Any time', days: null },
  { label: 'Within 24 h', days: 1 },
  { label: 'Within 7 days', days: 7 },
]

const ITEMS_PER_PAGE = 40

// Steam's store header (460×215). CheapShark's thumb is only 231×87, which gets
// blurry and cropped when it fills a card. Games without a Steam id keep the thumb.
const imageFor = (offer: Offer): string | null =>
  offer.steam_app_id
    ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${offer.steam_app_id}/header.jpg`
    : offer.thumb

const hasReviews = (offer: Offer) =>
  offer.review_positive_percent !== null &&
  offer.review_total !== null &&
  offer.review_total > 0 &&
  offer.review_source !== null

// The game's image, shown whole whatever its shape. Epic's covers are portrait,
// so a blurred copy of the same image fills the space around it instead of cropping.
function GameImage({ offer, className, children }: { offer: Offer; className: string; children?: ReactNode }) {
  const [src, setSrc] = useState(() => imageFor(offer))

  return (
    <div className={className}>
      {src && (
        <>
          <div className="media-blur" style={{ backgroundImage: `url("${src}")` }} />
          <img
            src={src}
            alt=""
            loading="lazy"
            // Falls back to CheapShark's thumb if Steam has no header for the id.
            onError={() => setSrc(src === offer.thumb ? null : offer.thumb)}
          />
        </>
      )}
      {children}
    </div>
  )
}

function StoreChip({ store }: { store: string }) {
  return (
    <span className="store-chip">
      <span className="dot" style={{ background: STORE_COLORS[store] }} />
      {store}
    </span>
  )
}

function Rating({ offer }: { offer: Offer }) {
  const percent = Math.round(offer.review_positive_percent!)
  const color = percent >= 80 ? 'var(--ok)' : percent >= 60 ? 'var(--warn)' : 'var(--error)'

  return (
    <p className="rating">
      <span className="meter">
        <i style={{ width: `${percent}%`, background: color }} />
      </span>
      {percent}% positive · {compact(offer.review_total!)} reviews
    </p>
  )
}

function TimeLeft({ endsAt, now }: { endsAt: string | null; now: number }) {
  const left = timeLeft(endsAt, now)

  return (
    <span className={left?.soon ? 'timer soon' : 'timer'}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {left ? left.text : 'No end date'}
    </span>
  )
}

function OfferCard({ offer, now, onOpen }: { offer: Offer; now: number; onOpen: () => void }) {
  // The whole card opens the details, also with the keyboard.
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onOpen()
    }
  }

  return (
    <li className="card" onClick={onOpen} onKeyDown={onKeyDown} tabIndex={0} aria-label={offer.title}>
      <GameImage offer={offer} className="media">
        <span className="badge">{offer.is_free ? 'FREE' : `−${Math.round(offer.savings)}%`}</span>
        <StoreChip store={offer.store} />
      </GameImage>

      <div className="card-body">
        <h3>{offer.title}</h3>
        {offer.genres.length > 0 && <p className="genres">{offer.genres.slice(0, 3).join(' · ')}</p>}
        {hasReviews(offer) && <Rating offer={offer} />}
        {offer.launcher_notice && <p className="launcher-warning">Also requires {offer.launcher_notice}</p>}

        <div className="card-foot">
          <p className="price">
            <span className={offer.is_free ? 'now free' : 'now'}>
              {offer.is_free ? 'Free' : money(offer.sale_price)}
            </span>
            <s>{money(offer.normal_price)}</s>
          </p>
          <TimeLeft endsAt={offer.ends_at} now={now} />
        </div>

        {offer.is_free && (
          <a
            className="claim"
            href={offer.claim_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.stopPropagation()
              openInApp(event, offer.store, offer.steam_app_id, offer.claim_url)
            }}
          >
            Claim on {offer.store}
          </a>
        )}
      </div>
    </li>
  )
}

function Pill({ label, pressed, color, onClick }: { label: string; pressed: boolean; color?: string; onClick: () => void }) {
  return (
    <button type="button" className="pill" aria-pressed={pressed} onClick={onClick}>
      {color && <span className="dot" style={{ background: color }} />}
      {label}
    </button>
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
  const [now, setNow] = useState(() => Date.now())
  const [stores, setStores] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [genres, setGenres] = useState<string[]>([])
  const [endingWithinDays, setEndingWithinDays] = useState<number | null>(null)
  const [atTop, setAtTop] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const topbar = useRef<HTMLElement>(null)
  const filterBar = useRef<HTMLDivElement>(null)

  // The filter bar sticks right below the top bar, so the CSS needs to know how
  // tall both are. They change with the screen width, e.g. search gets its own row on mobile.
  useEffect(() => {
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--topbar-height', `${topbar.current?.offsetHeight ?? 0}px`)
      root.style.setProperty('--filter-bar-height', `${filterBar.current?.offsetHeight ?? 0}px`)
    })
    if (topbar.current) observer.observe(topbar.current)
    if (filterBar.current) observer.observe(filterBar.current)
    return () => observer.disconnect()
  }, [load.state])

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Keeps the countdowns on the cards ticking.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // "/" jumps to the search field, like on GitHub and YouTube.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchInput.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

  const freeOffers = visible.filter((offer) => offer.is_free)
  const discountedOffers = visible.filter((offer) => !offer.is_free)

  const totalPages = Math.max(
    1,
    Math.ceil(discountedOffers.length / ITEMS_PER_PAGE),
  )

  const safePage = Math.min(currentPage, totalPages)

  const paginatedOffers = discountedOffers.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  )

  const visibleFree = useMemo(
    () =>
      freeGames.filter(
        (game) =>
          (genres.length === 0 || game.genres.some((genre) => genres.includes(genre))) &&
          matchesSearch(game.title),
      ),
    [freeGames, genres, matchesSearch],
  )

  const anyFilter = stores.length + genres.length > 0 || endingWithinDays !== null

  const clearFilters = () => {
    setStores([])
    setGenres([])
    setEndingWithinDays(null)
  }

  const goToPage = (page: number) => {
    setCurrentPage(page)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
        <h1 className="logo">Game<span>Grab</span></h1>
        <p className="error">Can't reach the backend: {load.message}</p>
        <p>Check that the server is running on {API_URL}</p>
      </div>
    )
  }

  return (
    <>
      <header className="topbar" ref={topbar}>
        <div className="wrap topbar-inner">
          <h1 className="logo">Game<span>Grab</span></h1>

          <label className="search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchInput}
              type="search"
              placeholder={`Search ${load.offers.length.toLocaleString('en-US')} deals…`}
              aria-label="Search for games"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <kbd>/</kbd>
          </label>

          <Account />
        </div>
      </header>

      {/* Outside the top bar, so it scrolls away while the logo and search stay. */}
      <div className="wrap intro">
        <p className="tagline">Free and discounted PC games, all in one place.</p>
      </div>

      <div className="filter-bar" ref={filterBar}>
        <div className="wrap filters">
          <div className="filter-row">
            <span className="filter-label">Store</span>
            {STORES.map((store) => (
              <Pill
                key={store}
                label={store}
                color={STORE_COLORS[store]}
                pressed={stores.includes(store)}
                onClick={() => setStores((current) => toggle(current, store))}
              />
            ))}
          </div>

          <div className="filter-row">
            <span className="filter-label">Genre</span>
            {allGenres.map((genre) => (
              <Pill
                key={genre}
                label={genre}
                pressed={genres.includes(genre)}
                onClick={() => setGenres((current) => toggle(current, genre))}
              />
            ))}
          </div>

          <div className="filter-row">
            <span className="filter-label">Ends</span>
            <div className="segmented">
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={endingWithinDays === option.days}
                  onClick={() => setEndingWithinDays(option.days)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {anyFilter && (
              <button type="button" className="clear-filters" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="wrap">
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Free right now</h2>
              <p className="section-sub">Claim them before the timer runs out. They're yours to keep.</p>
            </div>
          </div>

          {freeOffers.length > 0 ? (
            <ul className="grid grid-free">
              {freeOffers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} now={now} onOpen={() => setSelectedOffer(offer)} />
              ))}
            </ul>
          ) : (
            <p className="count">
              {searchTerm.trim() || anyFilter
                ? 'No free offers match your search or filters.'
                : 'No current free offers. Check back later!'}
            </p>
          )}

          <div className="f2p-banner">
            <span>
              <strong>Looking for games that are always free?</strong>{' '}
              {freeGames.length > 0 && `${freeGames.length} popular free-to-play titles.`}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() =>
                document
                  .getElementById('always-free')
                  ?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              Browse free-to-play ↓
            </button>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Big discounts</h2>
            {discountedOffers.length > 0 && (
              <p className="count">
                <strong>{discountedOffers.length.toLocaleString('en-US')}</strong> games at 80% off or more
              </p>
            )}
          </div>

          {discountedOffers.length > 0 ? (
            <ul className="grid">
              {paginatedOffers.map((offer) => (
                <OfferCard key={offer.id} offer={offer} now={now} onOpen={() => setSelectedOffer(offer)} />
              ))}
            </ul>
          ) : (
            <p className="count">
              {searchTerm.trim() || anyFilter
                ? 'No discounted games match your search or filters.'
                : 'No discounted games available right now.'}
            </p>
          )}
        </section>

        {totalPages > 1 && (
          <div className="pagination">
            <button type="button" onClick={() => goToPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>
              ← Previous
            </button>
            <span className="page-indicator">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(Math.min(totalPages, safePage + 1))}
              disabled={safePage === totalPages}
            >
              Next →
            </button>
          </div>
        )}

        {freeLoad.state !== 'loading' && (
          <section className="always-free" id="always-free">
            <div className="section-head">
              <h2>Popular free-to-play games</h2>
              {freeLoad.state === 'ok' && visibleFree.length > 0 && (
                <p className="count">
                  <strong>{visibleFree.length}</strong> games, most played first
                </p>
              )}
            </div>
            {freeLoad.state === 'error' ? (
              <p className="error">Couldn't fetch the list of free games.</p>
            ) : visibleFree.length > 0 ? (
              <ul className="free-games">
                {visibleFree.map((game) => (
                  <li key={game.id}>
                    <a
                      href={game.claim_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => openInApp(event, 'Steam', game.steam_app_id, game.claim_url)}
                    >
                      {game.title}
                    </a>
                    {game.genres.length > 0 && (
                      <span className="genres">{game.genres.slice(0, 3).join(' · ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="count">
                {searchTerm.trim() || genres.length > 0
                  ? 'No Free-to-Play games match your search or filters.'
                  : 'No Free-to-Play games available right now.'}
              </p>
            )}
          </section>
        )}
      </main>

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
          <div className="modal" role="dialog" aria-modal="true" aria-label={selectedOffer.title} onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedOffer(null)} aria-label="Close">
              ×
            </button>

            <GameImage offer={selectedOffer} className="media modal-media">
              <span className="badge">
                {selectedOffer.is_free ? 'FREE' : `−${Math.round(selectedOffer.savings)}%`}
              </span>
            </GameImage>

            <div className="modal-content">
              <StoreChip store={selectedOffer.store} />
              <h2>{selectedOffer.title}</h2>

              {selectedOffer.genres.length > 0 && (
                <p className="genres">{selectedOffer.genres.join(' · ')}</p>
              )}

              {hasReviews(selectedOffer) && (
                <p className="rating">
                  {Math.round(selectedOffer.review_positive_percent!)}% positive
                  {' · '}
                  {selectedOffer.review_total!.toLocaleString('en-US')} reviews on {selectedOffer.review_source}
                </p>
              )}

              {selectedOffer.launcher_notice && (
                <p className="launcher-warning">Also requires {selectedOffer.launcher_notice}</p>
              )}

              {selectedOffer.description && <p className="description">{selectedOffer.description}</p>}

              <div className="modal-facts">
                <div>
                  <span>Price</span>
                  <p className="price">
                    <span className={selectedOffer.is_free ? 'now free' : 'now'}>
                      {selectedOffer.is_free ? 'Free' : money(selectedOffer.sale_price)}
                    </span>
                    <s>{money(selectedOffer.normal_price)}</s>
                  </p>
                </div>
                <div>
                  <span>Time left</span>
                  <TimeLeft endsAt={selectedOffer.ends_at} now={now} />
                </div>
              </div>

              {(selectedOffer.minimum_requirements || selectedOffer.recommended_requirements) && (
                <div className="system-requirements">
                  <button
                    type="button"
                    className="requirements-button"
                    aria-expanded={requirementsOpen}
                    onClick={() => setRequirementsOpen((v) => !v)}
                  >
                    <span>System requirements</span>
                    <span aria-hidden="true">{requirementsOpen ? '−' : '+'}</span>
                  </button>
                  {requirementsOpen && (
                    <div className="requirements-content">
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

              <div className="modal-actions">
                <a
                  href={selectedOffer.claim_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) =>
                    openInApp(event, selectedOffer.store, selectedOffer.steam_app_id, selectedOffer.claim_url)
                  }
                  className="claim"
                >
                  Get it on {selectedOffer.store} →
                </a>
                <button type="button" className="share-button" onClick={() => copyLink(selectedOffer.claim_url)}>
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
