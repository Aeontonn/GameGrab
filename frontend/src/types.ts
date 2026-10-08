// An offer, exactly as /offers returns it.
// The fields must have the same names as the columns in the database.
export type Offer = {
  id: number
  title: string

  // Steam, GOG or Epic Games. What we filter on.
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

  // A short description of the game. Missing when no description was found.
  description: string | null

  // PC system requirements from Steam. May be missing for some games.
  minimum_requirements: string | null
  recommended_requirements: string | null

  // Extra launcher or account the game needs besides the store's own, e.g.
  // "Ubisoft Connect launcher". null when there is none.
  launcher_notice: string | null

  // When the offer expires, as an ISO time. null when the store doesn't say.
  ends_at: string | null

  // When the row was last fetched from CheapShark.
  fetched_at: string
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
export const STORES = ['Steam', 'GOG', 'Epic Games'] as const
