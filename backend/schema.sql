-- Tabellen som håller gratis- och rabatterbjudanden.
-- Körs om vid behov: IF NOT EXISTS gör att den aldrig skriver över befintlig data.

CREATE TABLE IF NOT EXISTS offers (
    id              SERIAL PRIMARY KEY,

    -- CheapSharks eget id för erbjudandet. UNIQUE gör att samma erbjudande
    -- bara kan finnas en gång, så en ny hämtning uppdaterar i stället för att dubblera.
    deal_id         TEXT UNIQUE NOT NULL,

    title           TEXT NOT NULL,

    -- Steam, GOG eller Epic Games. Det frontend filtrerar på.
    store           TEXT NOT NULL,

    -- Priser i dollar, som CheapShark lämnar dem.
    normal_price    NUMERIC(10, 2) NOT NULL,
    sale_price      NUMERIC(10, 2) NOT NULL,

    -- Rabatt i procent. 100 betyder att spelet är gratis just nu.
    savings         NUMERIC(5, 2) NOT NULL,
    is_free         BOOLEAN NOT NULL,

    -- Bild på spelet.
    thumb           TEXT,

    -- Finns spelet på Steam kan vi bygga en direktlänk till butikssidan.
    -- Saknas för erbjudanden i andra butiker.
    steam_app_id    TEXT,

    claim_url       TEXT NOT NULL,

    -- När raden senast hämtades. Visar hur färsk datan är.
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Frontend filtrerar på butik och sorterar på rabatt, så de kolumnerna får index.
CREATE INDEX IF NOT EXISTS offers_store_idx ON offers (store);
CREATE INDEX IF NOT EXISTS offers_savings_idx ON offers (savings DESC);
