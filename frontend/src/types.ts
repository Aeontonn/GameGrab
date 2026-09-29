// Ett erbjudande, precis som /offers lämnar ut det.
// Fälten måste heta samma sak som kolumnerna i databasen.
export type Offer = {
  id: number
  title: string

  // Steam, GOG eller Epic Games. Det vi filtrerar på.
  store: string

  normal_price: number
  sale_price: number

  // Rabatt i procent. 100 betyder gratis.
  savings: number
  is_free: boolean

  thumb: string | null
  steam_app_id: string | null

  // Dit knappen leder: butikssidan där spelet hämtas.
  claim_url: string

  // Spelets genrer enligt Steam, på engelska. Tom lista om Steam inte känner till spelet.
  genres: string[]

  // När raden senast hämtades från CheapShark.
  fetched_at: string
}

// Ett spel som alltid är gratis (free to play), precis som /free-games lämnar ut det.
export type FreeGame = {
  id: number
  title: string
  steam_app_id: string
  claim_url: string

  // Spelets genrer enligt Steam, på engelska. Kan vara tom.
  genres: string[]
}

// Butikerna vi hämtar från. Används för att bygga filtret.
export const STORES = ['Steam', 'GOG', 'Epic Games'] as const
