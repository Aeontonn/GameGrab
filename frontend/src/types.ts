// An offer, exactly as /offers returns it.
// The fields must have the same names as the columns in the database.
export type Offer = {
  id: number
  title: string

  // Steam, GOG, Epic Games or Ubisoft. What we filter on.
  store: string

  normal_price: number
  sale_price: number

  // Discount in percent. 100 means free.
  savings: number
  is_free: boolean

  thumb: string | null
  steam_app_id: string | null

  // Where the button leads: the store page where the game is claimed.
  claim_url: string

  // The game's genres according to Steam, in English. Empty list if Steam doesn't know the game.
  genres: string[]

  // The first sentence of the description, shown on the card. The full text
  // comes from /offers/{id}. null when no description was found.
  short_description: string | null

  // Extra launcher or account the game needs besides the store's own, e.g.
  // "Ubisoft Connect launcher". null when there is none.
  launcher_notice: string | null

  // Steam review summary. Also used for games sold on GOG or Epic
  // when the same game has a Steam App ID.
  // null when no review data is available.
  review_positive_percent: number | null
  review_total: number | null
  review_source: string | null

  // When the offer expires, as an ISO time. null when the store doesn't say.
  ends_at: string | null
}

// The longer texts for one offer, exactly as /offers/{id} returns them. Kept
// out of /offers so the list loads fast, and fetched when a game is opened.
export type OfferDetails = {
  // A short description of the game. Missing when no description was found.
  description: string | null

  // PC system requirements from Steam. May be missing for some games.
  minimum_requirements: string | null
  recommended_requirements: string | null
}

// A game that is always free (free to play), exactly as /free-games returns it.
export type FreeGame = {
  id: number
  title: string
  steam_app_id: string
  claim_url: string

  // The game's genres according to Steam, in English. May be empty.
  genres: string[]
}

// The stores we fetch from. Used to build the filter.
export const STORES = ['Steam', 'GOG', 'Epic Games', 'Ubisoft'] as const
