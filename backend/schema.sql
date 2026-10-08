-- The table that holds free and discounted offers.
-- Safe to re-run: IF NOT EXISTS means it never overwrites existing data.

CREATE TABLE IF NOT EXISTS offers (
    id              SERIAL PRIMARY KEY,

    -- CheapShark's own id for the offer. UNIQUE means the same offer can
    -- only exist once, so a new fetch updates instead of duplicating.
    deal_id         TEXT UNIQUE NOT NULL,

    title           TEXT NOT NULL,

    -- Steam, GOG or Epic Games. What the frontend filters on.
    store           TEXT NOT NULL,

    -- Prices in dollars, as CheapShark provides them.
    normal_price    NUMERIC(10, 2) NOT NULL,
    sale_price      NUMERIC(10, 2) NOT NULL,

    -- Discount in percent. 100 means the game is free right now.
    savings         NUMERIC(5, 2) NOT NULL,
    is_free         BOOLEAN NOT NULL,

    -- Image of the game.
    thumb           TEXT,

    -- If the game is on Steam we can build a direct link to the store page.
    -- Missing for offers in other stores.
    steam_app_id    TEXT,

    claim_url       TEXT NOT NULL,

    -- The game's genres according to Steam, in English. Empty list if Steam doesn't know the game.
    genres          TEXT[] NOT NULL DEFAULT '{}',

    -- A short description of the game, when one is available.
    description     TEXT,

    -- PC system requirements from Steam. NULL when Steam doesn't provide them.
    minimum_requirements TEXT,
    recommended_requirements TEXT,

    -- When the offer expires, according to the store itself. NULL if the store doesn't say.
    ends_at         TIMESTAMPTZ,

    -- When the row was last fetched. Shows how fresh the data is.
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The frontend filters on store and sorts on discount, so those columns get indexes.
CREATE INDEX IF NOT EXISTS offers_store_idx ON offers (store);
CREATE INDEX IF NOT EXISTS offers_savings_idx ON offers (savings DESC);

-- Adds genres to a table that was created before the column existed.
-- Existing rows get an empty list until the next fetch fills them in.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS genres TEXT[] NOT NULL DEFAULT '{}';

-- A short description of the game, when one is available.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS description TEXT;

-- PC system requirements from Steam.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS minimum_requirements TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS recommended_requirements TEXT;

-- When the offer expires, according to the store itself. NULL if the store doesn't say.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

-- Extra launcher or account the game needs besides the store's own, e.g.
-- "Ubisoft Connect launcher". NULL when there is none.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS launcher_notice TEXT;

-- Games that are always free (free to play), separate from the time-limited
-- offers in offers. Filled by fetch_free_games.py.
CREATE TABLE IF NOT EXISTS free_games (
    id              SERIAL PRIMARY KEY,
    steam_app_id    TEXT UNIQUE NOT NULL,
    title           TEXT NOT NULL,
    genres          TEXT[] NOT NULL DEFAULT '{}',

    -- Position in the list, 1 = most played. Keeps Steam's order.
    rank            INTEGER NOT NULL,

    claim_url       TEXT NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Deals that Steam or GOG said are not games (DLC, demos, soundtracks…).
-- Remembered so fetch_offers.py doesn't look them up again every hour.
CREATE TABLE IF NOT EXISTS skipped_deals (
    deal_id         TEXT PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Where fetch_offers.py stopped in CheapShark's list, so the next run can
-- continue from there instead of fetching everything at once.
CREATE TABLE IF NOT EXISTS fetch_state (
    key             TEXT PRIMARY KEY,
    value           INTEGER NOT NULL
);

-- Row Level Security with no policies: nobody gets at the tables through
-- Supabase's public API, even with the publishable key the frontend uses for
-- login. The backend and the fetch scripts connect as the postgres role, which
-- bypasses RLS, so they work as before.
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE free_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE skipped_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fetch_state ENABLE ROW LEVEL SECURITY;
