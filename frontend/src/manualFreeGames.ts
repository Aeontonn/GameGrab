import type { FreeGame } from './types'

// Free-to-play games added manually.
// Negative IDs prevent conflicts with database IDs.

export const manualFreeGames: FreeGame[] = [
  {
    id: -1,
    title: 'League of Legends',
    steam_app_id: null,
    claim_url: 'https://www.leagueoflegends.com/',
    genres: ['Action', 'Strategy'],
    store: 'Riot Games',
  },
  {
    id: -2,
    title: 'VALORANT',
    steam_app_id: null,
    claim_url: 'https://playvalorant.com/',
    genres: ['Action'],
    store: 'Riot Games',
  },
  {
    id: -3,
    title: 'Teamfight Tactics',
    steam_app_id: null,
    claim_url: 'https://teamfighttactics.leagueoflegends.com/',
    genres: ['Strategy'],
    store: 'Riot Games',
  },
  {
    id: -4,
    title: 'Hearthstone',
    steam_app_id: null,
    claim_url: 'https://hearthstone.blizzard.com/',
    genres: ['Strategy'],
    store: 'Battle.net',
  },
  {
    id: -6,
    title: 'Diablo Immortal',
    steam_app_id: null,
    claim_url: 'https://diabloimmortal.blizzard.com/',
    genres: ['Action', 'RPG'],
    store: 'Battle.net',
  },
  {
    id: -7,
    title: 'Heroes of the Storm',
    steam_app_id: null,
    claim_url: 'https://heroesofthestorm.blizzard.com/',
    genres: ['Action', 'Strategy'],
    store: 'Battle.net',
  },
  {
    id: -8,
    title: 'Legends of Runeterra',
    steam_app_id: null,
    claim_url: 'https://playruneterra.com/',
    genres: ['Strategy'],
    store: 'Riot Games',
  },
]
