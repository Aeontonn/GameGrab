"""Hämtar gratis- och rabatterbjudanden från CheapShark och sparar dem i databasen.

Körs manuellt när datan ska uppdateras:

    cd backend
    source venv/bin/activate
    python -m app.fetch_offers

Automatisk körning på schema är en senare sprint.
"""

from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import re
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
import json
import os

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in backend/.env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

API = "https://www.cheapshark.com/api/1.0/deals"

# CheapShark kräver att anropet talar om vilken app som frågar, annars nekar de.
USER_AGENT = "GameGrab/0.1 (student project)"

# De tre PC-butikerna vi bryr oss om. Nycklarna är CheapSharks egna id:n,
# värdena är namnen vi vill visa i frontend.
STORES = {
    "1": "Steam",
    "7": "GOG",
    "25": "Epic Games",
}


# Ord som avslöjar att raden inte är ett fristående spel utan ett tillägg,
# en dyrare utgåva eller ett paket. Vi vill bara ha själva spelen.
#
# "Edition" täcker Deluxe, Gold, Ultimate, Premium och Game of the Year, som
# alla slutar på det ordet. Ord som "Remastered" och "Director's Cut" står
# medvetet inte med – de är fortfarande hela spel.
EXCLUDE = re.compile(
    r"\b(DLC|Pack|Edition|Bundle|Collection|Season Pass|Upgrade|Soundtrack|Complete the Set)\b",
    re.IGNORECASE,
)


def looks_like_extra(title: str) -> bool:
    """Gissar utifrån titeln om raden är ett tillägg i stället för ett spel."""
    return EXCLUDE.search(title) is not None


def steam_type(app_id: str) -> str | None:
    """Frågar Steam vad något faktiskt är: game, dlc, demo, music…

    Returnerar None om Steam inte känner igen id:t eller inte svarar.
    Det är Steams eget svar, inte en gissning – därför litar vi mer på den
    här än på titeln.
    """
    url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&filters=basic"

    try:
        with urlopen(url, timeout=20) as response:
            payload = json.load(response)[str(app_id)]
    except Exception:
        return None

    return payload["data"]["type"] if payload.get("success") else None


def is_game(deal: dict) -> bool:
    """Ska erbjudandet med till frontend?

    Titeln kollas först eftersom det är gratis. Bara det som överlever
    kostar oss ett anrop till Steam.
    """
    if looks_like_extra(deal["title"]):
        return False

    app_id = deal.get("steamAppID")

    # Utan Steam-id kan vi inte fråga. Då får titelregeln räcka.
    if not app_id:
        return True

    kind = steam_type(app_id)

    # Svarade inte Steam vill vi hellre behålla raden än tappa ett riktigt spel.
    return kind in (None, "game")


def fetch_page(**params) -> list[dict]:
    """Ställer en fråga till CheapShark och returnerar svaret som en lista."""
    url = f"{API}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})

    with urlopen(request, timeout=30) as response:
        return json.load(response)


def collect() -> list[dict]:
    """Samlar ihop erbjudanden från CheapShark.

    Två sorters anrop, eftersom sajten handlar om både gratis och rabatterat:
    de bäst betygsatta fynden, plus allt som just nu är helt gratis.
    """
    store_ids = ",".join(STORES)
    deals: dict[str, dict] = {}

    # Tre sidor av de fynd CheapShark själva rankar högst.
    for page in range(3):
        for deal in fetch_page(
            storeID=store_ids, pageSize=60, pageNumber=page, sortBy="Deal Rating"
        ):
            deals[deal["dealID"]] = deal

    # Allt som kostar noll just nu. Samlas separat, annars riskerar de
    # att hamna utanför de tre sidorna ovan.
    for deal in fetch_page(storeID=store_ids, pageSize=60, upperPrice=0):
        deals[deal["dealID"]] = deal

    # Nyckeln är dealID, så samma erbjudande kan bara förekomma en gång.
    return list(deals.values())


def to_row(deal: dict) -> dict:
    """Översätter CheapSharks fältnamn till våra kolumnnamn."""
    steam_app_id = deal.get("steamAppID")
    store = STORES[deal["storeID"]]

    # Gäller rean Steam kan vi länka rakt till butikssidan.
    #
    # För GOG och Epic får CheapShark skicka besökaren vidare. Deras dealID är
    # redan url-kodat i svaret, så det ska inte kodas en gång till.
    #
    # Viktigt: bara för Steam. Många GOG- och Epic-spel finns också på Steam och
    # har ett steamAppID, men rean gäller inte där – då hade vi skickat besökaren
    # till fel butik och fel pris.
    if store == "Steam" and steam_app_id:
        claim_url = f"https://store.steampowered.com/app/{steam_app_id}/"
    else:
        claim_url = f"https://www.cheapshark.com/redirect?dealID={deal['dealID']}"

    sale_price = float(deal["salePrice"])

    return {
        "deal_id": deal["dealID"],
        "title": deal["title"],
        "store": store,
        "normal_price": float(deal["normalPrice"]),
        "sale_price": sale_price,
        "savings": round(float(deal["savings"]), 2),
        "is_free": sale_price == 0,
        "thumb": deal.get("thumb"),
        "steam_app_id": steam_app_id,
        "claim_url": claim_url,
    }


# deal_id är UNIQUE i tabellen. Känner databasen igen erbjudandet uppdateras
# raden i stället för att en dubblett skapas.
UPSERT = text("""
    INSERT INTO offers (
        deal_id, title, store, normal_price, sale_price,
        savings, is_free, thumb, steam_app_id, claim_url, fetched_at
    )
    VALUES (
        :deal_id, :title, :store, :normal_price, :sale_price,
        :savings, :is_free, :thumb, :steam_app_id, :claim_url, now()
    )
    ON CONFLICT (deal_id) DO UPDATE SET
        title        = EXCLUDED.title,
        store        = EXCLUDED.store,
        normal_price = EXCLUDED.normal_price,
        sale_price   = EXCLUDED.sale_price,
        savings      = EXCLUDED.savings,
        is_free      = EXCLUDED.is_free,
        thumb        = EXCLUDED.thumb,
        steam_app_id = EXCLUDED.steam_app_id,
        claim_url    = EXCLUDED.claim_url,
        fetched_at   = now()
""")


def save(rows: list[dict]) -> None:
    """Sparar raderna. Allt eller inget – går något fel skrivs ingenting."""
    with engine.begin() as connection:
        connection.execute(UPSERT, rows)


def remove_stale(keep: list[str]) -> int:
    """Tar bort rader som inte längre finns hos CheapShark.

    Utan det här skulle ett erbjudande som tagit slut ligga kvar för alltid
    och visas som aktivt – det värsta en sån här sajt kan göra.
    """
    if not keep:
        # Tom lista betyder att hämtningen gick fel. Rör då ingenting.
        return 0

    with engine.begin() as connection:
        result = connection.execute(
            text("DELETE FROM offers WHERE deal_id <> ALL(:keep)"), {"keep": keep}
        )

    return result.rowcount


def main() -> None:
    print("Hämtar från CheapShark…")
    deals = collect()
    print(f"  {len(deals)} erbjudanden hämtade")

    print("Sorterar bort tillägg, utgåvor och paket…")
    games = [deal for deal in deals if is_game(deal)]
    print(f"  {len(deals) - len(games)} bortsorterade, {len(games)} spel kvar")

    rows = [to_row(deal) for deal in games]
    save(rows)

    stale = remove_stale([row["deal_id"] for row in rows])
    if stale:
        print(f"  {stale} gamla erbjudanden borttagna")

    free = sum(1 for row in rows if row["is_free"])
    print()
    print(f"Sparade {len(rows)} spel, varav {free} helt gratis.")

    for store in STORES.values():
        print(f"  {store:<12} {sum(1 for r in rows if r['store'] == store)}")


if __name__ == "__main__":
    main()
