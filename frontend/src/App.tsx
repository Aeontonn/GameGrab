import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Account from './Account'
import { API_URL, fetchFreeGames, fetchOfferDetails, fetchOffers } from './api'
import { openInApp } from './appLink'
import { STORES } from './types'
import type { FreeGame, Offer, OfferDetails } from './types'

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

// Exact time left for the cards, e.g. "2 d 4 h left". soon is true for the last
// 24 hours, so the offers that really are about to end stand out.
const exactTimeLeft = (
  endsAt: string | null,
  now: number
): { text: string; urgency: 'normal' | 'warning' | 'urgent' } | null => {
  if (!endsAt) return null

  const msLeft = new Date(endsAt).getTime() - now

  if (msLeft <= 0) return { text: 'Ending now', urgency: 'urgent' }

  const hours = Math.floor(msLeft / 3_600_000)
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000)

  if (msLeft < 24 * 3_600_000) {
    return { text: `${hours} h ${minutes} min left`, urgency: 'urgent' }
  }

  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24

  if (msLeft <= 48 * 3_600_000) {
    return { text: `${days} d ${remainingHours} h left`, urgency: 'warning' }
  }

  return { text: `${days} d ${remainingHours} h left`, urgency: 'normal' }
}

const imagesFor = (offer: Offer): string[] => {
  const steam = offer.steam_app_id
    ? ['capsule_616x353.jpg', 'header_2x.jpg', 'header.jpg'].map(
        (file) =>
          `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${offer.steam_app_id}/${file}`,
      )
    : []
  return offer.thumb ? [...steam, offer.thumb] : steam
}

// The "Ends within 2 days" option shows offers that expire within this many days.
// With 7 days nearly every offer was included, so the option said nothing.
const withoutRequirementLabel = (value: string): string =>
  value.replace(/^(Minimum|Recommended):\s*/i, '')

const ITEMS_PER_PAGE = 40

const FILTER_GENRES = [
  'Action',
  'Adventure',
  'Casual',
  'Indie',
  'RPG',
  'Simulation',
  'Sports',
  'Strategy',
  'Racing',
]

const PREFETCH_DELAY_MS = 120

type Tab = 'all' | 'free' | 'limited' | 'discounted'

const TAB_LABELS: Record<Tab, string> = {
  all: 'All',
  free: 'Free',
  limited: 'Free for a limited time',
  discounted: 'Discounted',
}

const TAB_HEADINGS: Record<Tab, string> = {
  all: 'All games',
  free: 'Free games',
  limited: 'Free for a limited time',
  discounted: 'Discounted games',
}

// Builds the list of page numbers to show. Shows the first few pages,
// then ellipsis, then the last page.
function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | '...')[] = [1, 2, 3, 4]

  if (current > 5) pages.push('...')

  if (current > 4 && current < total - 1) pages.push(current)

  if (current < total - 2) pages.push('...')

  pages.push(total)
  return pages
}

function GameImage({ offer }: { offer: Offer }) {
  const [candidates] = useState(() => imagesFor(offer))
  const [index, setIndex] = useState(0)
  const src = candidates[index]

  if (!src) return null
  return (
    <img
      src={src}
      alt={offer.title}
      loading="lazy"
      onError={() => setIndex((current) => current + 1)}
    />
  )
}

function CardImage({ offer }: { offer: Offer }) {
  return (
    <div className="card-media">
      <GameImage offer={offer} />
      <span className="card-store">{offer.store}</span>
    </div>
  )
}

function OfferCard({
  offer,
  now,
  onClick,
  onPrefetch,
}: {
  offer: Offer
  now: number
  onClick: () => void
  onPrefetch: () => void
}) {
  const prefetchTimer = useRef<number | undefined>(undefined)

  const startPrefetch = () => {
    window.clearTimeout(prefetchTimer.current)
    prefetchTimer.current = window.setTimeout(onPrefetch, PREFETCH_DELAY_MS)
  }
  const cancelPrefetch = () => window.clearTimeout(prefetchTimer.current)

  useEffect(() => cancelPrefetch, [])

  const hasReviews =
    offer.review_positive_percent !== null &&
    offer.review_total !== null &&
    offer.review_total > 0 &&
    offer.review_source

  const left = exactTimeLeft(offer.ends_at, now)

  return (
    <li
      className="offer-card"
      onClick={onClick}
      onMouseEnter={startPrefetch}
      onMouseLeave={cancelPrefetch}
      style={{ cursor: 'pointer' }}
    >
      <CardImage offer={offer} />

      <div className="offer-card-body">
        <h3>{offer.title}</h3>
        {offer.launcher_notice && (
          <p className="launcher-warning">⚠ Also requires: {offer.launcher_notice}</p>
        )}
        {offer.genres.length > 0 && (
          <p className="genres" style={{ fontWeight: 600 }}>
            {offer.genres.join(' · ')}
          </p>
        )}
        {offer.short_description && (
          <p className="description">{offer.short_description}</p>
        )}
        {hasReviews && (
          <p
            className="game-reviews"
            style={{ color: 'var(--text-dim)', fontWeight: 600, margin: '4px 0 8px' }}
          >
            {Math.round(offer.review_positive_percent!)}%
            {' · '}
            {offer.review_total!.toLocaleString('en-US')} reviews on {offer.review_source}
          </p>
        )}

        <div className="offer-card-foot">
          <p className="offer-card-price">
            <span className="now" style={{ color: '#4ade80' }}>
              {offer.is_free ? 'Free' : `$${offer.sale_price.toFixed(2)}`}
            </span>
            <s>${offer.normal_price.toFixed(2)}</s>
            <span className="savings">−{Math.round(offer.savings)}%</span>
          </p>
            <span className={`offer-card-time ${left?.urgency ?? 'normal'}`}>
              {left && left.urgency !== 'normal' && (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              )}
              {left ? left.text : 'End date unknown'}
          </span>
        </div>
      </div>
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
  const [now, setNow] = useState(() => Date.now())
  const [stores, setStores] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [genres, setGenres] = useState<string[]>([])
  const [endingWithinDays, setEndingWithinDays] = useState<number | null>(null)
  const [atTop, setAtTop] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null)
  const [details, setDetails] = useState<OfferDetails | 'loading' | 'error'>('loading')
  const detailsCache = useRef(new Map<number, OfferDetails>())
  const detailsRequests = useRef(new Map<number, Promise<OfferDetails>>())
  const [slowStart, setSlowStart] = useState(false)
  const [requirementsOpen, setRequirementsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [searchHistory, setSearchHistory] = useState<string[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [searchChipLeft, setSearchChipLeft] = useState(0)
  const mainRef = useRef<HTMLElement>(null)
  const searchWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = localStorage.getItem('gamegrab-search-history')
    if (saved) setSearchHistory(JSON.parse(saved))
  }, [])

  const saveSearch = (term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    const updated = [trimmed, ...searchHistory.filter((s) => s !== trimmed)].slice(0, 3)
    setSearchHistory(updated)
    localStorage.setItem('gamegrab-search-history', JSON.stringify(updated))
  }

  const removeSearch = (term: string) => {
    const updated = searchHistory.filter((s) => s !== term)
    setSearchHistory(updated)
    localStorage.setItem('gamegrab-search-history', JSON.stringify(updated))
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onScroll = () => setAtTop(window.scrollY < 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (load.state !== 'loading') return
    const timer = window.setTimeout(() => setSlowStart(true), 5000)
    return () => window.clearTimeout(timer)
  }, [load.state])

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

  const loadDetails = useCallback((id: number): Promise<OfferDetails> => {
    const saved = detailsCache.current.get(id)
    if (saved) return Promise.resolve(saved)

    let request = detailsRequests.current.get(id)
    if (!request) {
      request = fetchOfferDetails(id)
        .then((fetched) => {
          detailsCache.current.set(id, fetched)
          return fetched
        })
        .finally(() => detailsRequests.current.delete(id))
      request.catch(() => {})
      detailsRequests.current.set(id, request)
    }
    return request
  }, [])

  useEffect(() => {
    if (!selectedOffer) return
    const saved = detailsCache.current.get(selectedOffer.id)
    if (saved) {
      setDetails(saved)
      return
    }

    setDetails('loading')
    let current = true
    loadDetails(selectedOffer.id)
      .then((fetched) => {
        if (current) setDetails(fetched)
      })
      .catch(() => {
        if (current) setDetails('error')
      })
    return () => {
      current = false
    }
  }, [selectedOffer, loadDetails])

  useEffect(() => {
    setCurrentPage(1)
  }, [stores, genres, endingWithinDays, searchTerm, submittedSearch, activeTab])

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

  // Keep the search chip aligned below the search field, while letting it scroll
  // with the page instead of making it part of the sticky search bar.
  useEffect(() => {
    const updateSearchChipPosition = () => {
      const main = mainRef.current
      const search = searchWrapperRef.current
      if (!main || !search) return
      setSearchChipLeft(Math.max(
        0,
        search.getBoundingClientRect().left - main.getBoundingClientRect().left,
      ))
    }

    updateSearchChipPosition()
    window.addEventListener('resize', updateSearchChipPosition)
    const observer = new ResizeObserver(updateSearchChipPosition)
    if (mainRef.current) observer.observe(mainRef.current)
    if (searchWrapperRef.current) observer.observe(searchWrapperRef.current)

    return () => {
      window.removeEventListener('resize', updateSearchChipPosition)
      observer.disconnect()
    }
  }, [])

  const freeGames = useMemo(
    () => (freeLoad.state === 'ok' ? freeLoad.games : []),
    [freeLoad],
  )

  const matchesSearch = useCallback(
    (title: string) => {
      const term = (submittedSearch || searchTerm).trim().toLowerCase()
      return title.toLowerCase().includes(term)
    },
    [searchTerm, submittedSearch],
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

  // Combine free games (always free) with limited-time free offers for the "Free" tab
  const freeGamesAsOffers: Offer[] = freeGames
    .filter(
      (game) =>
        (stores.length === 0 || stores.includes(game.store)) &&
        (genres.length === 0 || game.genres.some((genre) => genres.includes(genre))) &&
        matchesSearch(game.title),
    )
    .map((game) => ({
      id: game.id,
      title: game.title,
      store: game.store,
      claim_url: game.claim_url,
      thumb: null,
      steam_app_id: game.steam_app_id,
      genres: game.genres,
      description: null,
      short_description: null,
      normal_price: 0,
      sale_price: 0,
      savings: 100,
      is_free: true,
      ends_at: null,
      review_positive_percent: null,
      review_total: null,
      review_source: null,
      launcher_notice: null,
    }))

  const tabOffers = useMemo(() => {
    let offers: Offer[]

    switch (activeTab) {
      case 'all':
        offers = [...freeGamesAsOffers, ...freeOffers, ...discountedOffers]
        break
      case 'free':
        offers = [...freeGamesAsOffers, ...freeOffers]
        break
      case 'limited':
        offers = [...freeOffers]
        break
      case 'discounted':
        offers = [...discountedOffers]
        break
      default:
        offers = []
    }

    // Put titles that start with the search term before titles that only contain it.
    // Keep the existing order within each group.
    const term = (submittedSearch || searchTerm).trim().toLowerCase()
    if (!term) return offers

    return offers.sort((a, b) => {
      const aStartsWith = a.title.toLowerCase().startsWith(term)
      const bStartsWith = b.title.toLowerCase().startsWith(term)
      return Number(bStartsWith) - Number(aStartsWith)
    })
  }, [activeTab, freeOffers, discountedOffers, freeGamesAsOffers, submittedSearch, searchTerm])

  const totalPages = Math.max(1, Math.ceil(tabOffers.length / ITEMS_PER_PAGE))
  const safePage = Math.min(currentPage, totalPages)
  const paginatedOffers = tabOffers.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  )
  const pageNumbers = getPageNumbers(safePage, totalPages)

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
    return (
      <div className="splash" role="status">
        <h1>Game<span style={{ color: '#4ade80' }}>Grab</span></h1>
        <p>{slowStart ? 'Waking up the server. This can take up to a minute…' : 'Fetching the latest deals…'}</p>
      </div>
    )
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
          <h1 style={{ fontWeight: 900, letterSpacing: '-0.03em', fontSize: '42px' }}>
            Game<span style={{ color: '#4ade80' }}>Grab</span>
          </h1>
          <p>Free and discounted PC games, all in one place.</p>
        </div>
        <Account />
      </header>

      <div className="layout">
        <main ref={mainRef}>
          {/* Search bar + tabs stick together */}
          <div
            className="search-sticky"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 10,
              background: 'var(--bg)',
              paddingBottom: '12px',
            }}
          >
            <div
              ref={searchWrapperRef}
              className="search-wrapper"
              style={{
                position: 'relative',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                }}
              >
                <div
                  className="search-bar"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    boxSizing: 'border-box',
                    borderColor: searchFocused ? '#4ade80' : undefined,
                    transition: 'border-color 0.15s ease',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <span className="search-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="10.5" cy="10.5" r="7.5" />
                      <line x1="16" y1="16" x2="22.5" y2="22.5" />
                    </svg>
                  </span>
                  <input
                    type="text"
                    placeholder="Search games..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onFocus={() => {
                      setShowHistory(true)
                      setSearchFocused(true)
                    }}
                    onBlur={(e) => {
                      if (!historyRef.current?.contains(e.relatedTarget as Node)) {
                        setTimeout(() => setShowHistory(false), 200)
                      }
                      setSearchFocused(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && searchTerm.trim()) {
                        saveSearch(searchTerm)
                        setSubmittedSearch(searchTerm.trim())
                        setSearchTerm('')
                        setShowHistory(false)
                        setSearchFocused(false)
                        e.currentTarget.blur()
                        document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' })
                      }
                    }}
                    style={{ outline: 'none', flex: 1, minWidth: 0 }}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setFilterMenuOpen(true)}
                  aria-label={anyFilter ? `Filters, ${activeFilters} active` : 'Filters'}
                  style={{
                    flexShrink: 0,
                    padding: '12px 20px',
                    borderRadius: '8px',
                    border: '1px solid var(--line-strong)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '15px',
                    fontWeight: 500,
                  }}
                >
                  Filters
                  {anyFilter && <span className="filter-count"> {activeFilters}</span>}
                </button>
              </div>

              {showHistory && searchHistory.length > 0 && (
                <div
                  ref={historyRef}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    background: 'var(--surface)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: '8px',
                    marginTop: '4px',
                    zIndex: 20,
                    overflow: 'hidden',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{ padding: '8px 14px 4px', fontSize: '11px', color: 'var(--text-dim)' }}>
                    Recent searches
                  </div>
                  {searchHistory.map((term) => (
                    <div
                      key={term}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 14px',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <button
                        type="button"
                        onMouseDown={() => {
                          setSubmittedSearch(term.trim())
                          setSearchTerm('')
                          saveSearch(term)
                          setShowHistory(false)
                        }}
                        style={{
                          flex: 1,
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text)',
                          font: 'inherit',
                          fontSize: '13px',
                          cursor: 'pointer',
                        }}
                      >
                        {term.charAt(0).toUpperCase() + term.slice(1)}
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          removeSearch(term)
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-dim)',
                          fontSize: '20px',
                          lineHeight: 1,
                          cursor: 'pointer',
                          padding: '2px 7px',
                        }}
                        aria-label={`Remove ${term}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tab buttons now inside the sticky container */}
            <div style={{ display: 'flex', gap: '8px', width: '100%', margin: '8px 0 0' }}>
              {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    padding: '14px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--line-strong)',
                    background: activeTab === tab ? '#4ade80' : 'var(--surface)',
                    color: activeTab === tab ? '#062b14' : 'var(--text)',
                    fontWeight: activeTab === tab ? 700 : 500,
                    fontSize: '15px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </div>

          {submittedSearch && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                margin: `0 0 16px ${searchChipLeft}px`,
              }}
            >
              <span style={{ fontSize: '16px', color: 'var(--text-dim)' }}>Search:</span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'var(--surface)',
                  border: '1px solid var(--line-strong)',
                  borderRadius: '999px',
                  padding: '6px 12px',
                  fontSize: '16px',
                }}
              >
                "{submittedSearch.charAt(0).toUpperCase() + submittedSearch.slice(1)}"
                <button
                  type="button"
                  onClick={() => setSubmittedSearch('')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: '21px',
                    lineHeight: 1,
                    padding: '0 3px',
                  }}
                  aria-label="Clear search"
                >
                  ×
                </button>
              </span>
            </div>
          )}

          {filterMenuOpen && (
            <div className="filter-overlay">
              <div className="filter-menu">
                <div className="filter-menu-header">
                  <button
                    type="button"
                    className="filter-close"
                    onClick={() => setFilterMenuOpen(false)}
                    aria-label="Close filters"
                  >
                    ×
                  </button>
                  <h1>GameGrab</h1>
                </div>

                <div className="filter-menu-content">
                  <div className="filter-menu-section">
                    <h2>Store</h2>
                    {STORES.map((store) => (
                      <label key={store} className="filter-menu-option">
                        <span>{store}</span>
                        <input
                          type="checkbox"
                          checked={stores.includes(store)}
                          onChange={() => setStores((current) => toggle(current, store))}
                        />
                      </label>
                    ))}
                  </div>

                  <div className="filter-menu-section">
                    <h2>Genre</h2>
                    {FILTER_GENRES.map((genre) => (
                      <label key={genre} className="filter-menu-option">
                        <span>{genre}</span>
                        <input
                          type="checkbox"
                          checked={genres.includes(genre)}
                          onChange={() => setGenres((current) => toggle(current, genre))}
                        />
                      </label>
                    ))}
                  </div>

                  <div className="filter-menu-section">
                    <h2>Ends in</h2>
                    {[1, 7].map((days) => (
                      <label key={days} className="filter-menu-option">
                        <span>{days} {days === 1 ? 'day' : 'days'}</span>
                        <input
                          type="checkbox"
                          checked={endingWithinDays === days}
                          onChange={() =>
                            setEndingWithinDays(endingWithinDays === days ? null : days)
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="filter-menu-actions">
                  <button
                    type="button"
                    className="filter-clear"
                    onClick={() => {
                      setStores([])
                      setGenres([])
                      setEndingWithinDays(null)
                    }}
                  >
                    Clear all
                  </button>

                  <dl className="filter-menu-counts" aria-live="polite">
                    {[
                      { label: 'Free for a limited time', count: freeOffers.length },
                      { label: 'Discounted games', count: discountedOffers.length },
                      { label: 'Free to play', count: freeGamesAsOffers.length },
                    ].map(({ label, count }) => (
                      <div key={label} className="filter-menu-count">
                        <dt>{label}</dt>
                        <dd>{count.toLocaleString('sv-SE')}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="filter-menu-actions-right">
                    <button
                      type="button"
                      className="filter-results"
                      onClick={() => setFilterMenuOpen(false)}
                    >
                      Show results
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <section id="results" style={{ overflowAnchor: 'none' }}>
            <h2 style={{ marginTop: '8px' }}>{TAB_HEADINGS[activeTab]}</h2>
            <p className="count">
              <strong>{tabOffers.length}</strong> games found
            </p>

            {tabOffers.length > 0 ? (
              <ul className="offers">
                {paginatedOffers.map((offer) => (
                  <OfferCard
                    key={`${offer.id}-${offer.store}`}
                    offer={offer}
                    now={now}
                    onClick={() => setSelectedOffer(offer)}
                    onPrefetch={() => loadDetails(offer.id)}
                  />
                ))}
              </ul>
            ) : (
              <p className="count">No games match your search or filters.</p>
            )}
          </section>

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

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {pageNumbers.map((page, index) =>
                  page === '...' ? (
                    <span key={`ellipsis-${index}`} style={{ color: 'var(--text-dim)', padding: '0 4px' }}>
                      …
                    </span>
                  ) : (
                    <button
                      key={page}
                      type="button"
                      onClick={() => {
                        setCurrentPage(page)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      style={{
                        minWidth: '36px',
                        height: '36px',
                        padding: '0 8px',
                        borderRadius: '8px',
                        border: 'none',
                        background: page === safePage ? '#4ade80' : 'transparent',
                        color: page === safePage ? '#062b14' : 'var(--text)',
                        fontWeight: page === safePage ? 700 : 500,
                        fontSize: '14px',
                        cursor: 'pointer',
                      }}
                    >
                      {page}
                    </button>
                  ),
                )}
              </div>

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
        </main>
      </div>

      {/* In the corner. Always visible on a wide screen, only after scrolling on mobile. */}
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
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
            <button className="modal-close" onClick={() => setSelectedOffer(null)} aria-label="Close">
              ×
            </button>
            <div className="card-media modal-media">
              <GameImage key={selectedOffer.id} offer={selectedOffer} />
            </div>
            <div className="modal-content" style={{ padding: '12px 14px' }}>
              <span className="store" style={{ fontSize: '11px' }}>{selectedOffer.store}</span>
              <h2 style={{ fontSize: '17px', margin: '2px 0 6px' }}>{selectedOffer.title}</h2>

              {selectedOffer.genres.length > 0 && (
                <p style={{ margin: '4px 0', fontSize: '12px' }}>
                  <strong style={{ color: 'var(--text)' }}>Genres</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>{selectedOffer.genres.join(' · ')}</span>
                </p>
              )}

              {details === 'loading' && (
                <p className="description" style={{ fontSize: '12px', margin: '8px 0 6px' }}>Loading description…</p>
              )}
              {details === 'error' && (
                <p className="description" style={{ fontSize: '12px', margin: '8px 0 6px' }}>Couldn't load the description.</p>
              )}
              {typeof details === 'object' && details.description && (
                <>
                  <p style={{ margin: '8px 0 2px', fontWeight: 600, color: 'var(--text)', fontSize: '12px' }}>Description</p>
                  <p className="description" style={{ fontSize: '12px', margin: '0 0 6px', lineHeight: 1.35 }}>{details.description}</p>
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

              {typeof details === 'object' && (details.minimum_requirements || details.recommended_requirements) && (
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
                      {details.minimum_requirements && (
                        <div>
                          <h4>Minimum</h4>
                          <p>{withoutRequirementLabel(details.minimum_requirements)}</p>
                        </div>
                      )}
                      {details.recommended_requirements && (
                        <div>
                          <h4>Recommended</h4>
                          <p>{withoutRequirementLabel(details.recommended_requirements)}</p>
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
                        <strong style={{ color: '#4ade80' }}>Free right now</strong>
                      </>
                    ) : (
                      <>
                        <s>${selectedOffer.normal_price.toFixed(2)}</s>{' '}
                        <span style={{ color: '#4ade80' }}>${selectedOffer.sale_price.toFixed(2)}</span>
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
                  onClick={(event) =>
                    openInApp(event, selectedOffer.store, selectedOffer.steam_app_id, selectedOffer.claim_url)
                  }
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