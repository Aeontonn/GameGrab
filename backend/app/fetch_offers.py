"""Hämtar gratis- och rabatterbjudanden från CheapShark och sparar dem i databasen.

Körs automatiskt varje timme av .github/workflows/fetch-offers.yml.

Kan också köras manuellt, t.ex. för att testa en ändring:

    cd backend
    source venv/bin/activate
    python -m app.fetch_offers
"""

from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
import re
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
import json
import time
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


# Steams genrer som faktiskt är genrer. Steam lägger även innehållsvarningar
# (Violent, Nudity…), prismodeller (Free To Play) och Early Access i samma
# lista – de ska inte bli val i genrefiltret. Id:na är desamma på alla språk.
GAME_GENRE_IDS = {
    "1",   # Action
    "2",   # Strategy
    "3",   # RPG
    "4",   # Casual
    "9",   # Racing
    "18",  # Sports
    "23",  # Indie
    "25",  # Adventure
    "28",  # Simulation
    "29",  # Massively Multiplayer
}


def steam_details(app_id: str) -> dict | None:
    """Frågar Steam vad något är (game, dlc, demo, music…) och vilka genrer det har.

    Returnerar None om Steam inte känner igen id:t eller inte svarar.
    Det är Steams eget svar, inte en gissning – därför litar vi mer på den
    här än på titeln. Genrerna hämtas på engelska, så att sajten fungerar
    för besökare oavsett språk.
    """
    url = (
        "https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&filters=basic,genres&l=english"
    )

    try:
        with urlopen(url, timeout=20) as response:
            payload = json.load(response)[str(app_id)]
    except Exception:
        return None

    if not payload.get("success"):
        return None

    data = payload["data"]
    return {
        "type": data.get("type"),
        "is_free": bool(data.get("is_free")),
        "genres": [
            genre["description"]
            for genre in data.get("genres", [])
            if genre["id"] in GAME_GENRE_IDS
        ],
    }


GOG_CATALOG = "https://catalog.gog.com/v1/catalog"

# GOG har egna genrer, de flesta teman som Fantasy och Sci-fi. Bara de med en
# tydlig motsvarighet bland Steams genrer tas med, översatta till Steams namn,
# så att filtret inte får både "RPG" och "Role-playing". Resten slängs.
GOG_TO_STEAM_GENRE = {
    "Action": "Action",
    "Shooter": "Action",
    "Platformer": "Action",
    "Fighting": "Action",
    "Adventure": "Adventure",
    "Point-and-click": "Adventure",
    "Visual Novel": "Adventure",
    "Role-playing": "RPG",
    "JRPG": "RPG",
    "Strategy": "Strategy",
    "Simulation": "Simulation",
    "Managerial": "Simulation",
    "Building": "Simulation",
    "Racing": "Racing",
    "Rally": "Racing",
    "Off-road": "Racing",
    "Sports": "Sports",
}


def normalize_title(title: str) -> str:
    """Gör titlar jämförbara: små bokstäver, bara bokstäver och siffror."""
    return re.sub(r"[^a-z0-9]", "", title.lower())


@lru_cache(maxsize=None)
def gog_find(title: str) -> dict | None:
    """Letar upp titeln i GOG:s katalog och returnerar GOG:s egen post för spelet.

    Bara exakt samma titel räknas. En lösare sökning hittar lätt fel spel,
    som Fallout 76 när vi letar efter Fallout.

    Returnerar None om GOG inte hittar spelet eller inte svarar – katalogen
    är inte officiellt dokumenterad och svarar ibland med fel. Svaret cachas,
    så genre- och slutdatumsuppslagen för samma spel bara kostar ett anrop.
    """
    params = urlencode({"query": f"like:{title}", "limit": 10})
    request = Request(f"{GOG_CATALOG}?{params}", headers={"User-Agent": USER_AGENT})

    # GOG svarar ibland 503 en kort stund. Tre försök med paus emellan räcker
    # oftast, och gäller bara de få spel som saknar Steam-id.
    products = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                products = json.load(response).get("products", [])
            break
        except Exception:
            time.sleep(1 + attempt)

    if products is None:
        return None

    wanted = normalize_title(title)
    return next((p for p in products if normalize_title(p["title"]) == wanted), None)


def gog_details(title: str) -> dict | None:
    """Reserv för spel utan Steam-id: slår upp genre och typ i GOG:s katalog."""
    match = gog_find(title)
    if match is None:
        return None

    genres: list[str] = []
    for genre in match.get("genres", []):
        steam_name = GOG_TO_STEAM_GENRE.get(genre["name"])
        if steam_name and steam_name not in genres:
            genres.append(steam_name)

    # GOG säger game, dlc eller pack. Bara dlc betyder säkert "inte ett spel":
    # GOG kallar även hela spel som Fallout och Fallout 2 för pack, eftersom de
    # levereras med extramaterial. Riktiga paket fångas redan av titelregeln.
    kind = "dlc" if match.get("productType") == "dlc" else "game"
    return {"type": kind, "is_free": False, "genres": genres}


def classify(deal: dict) -> tuple[bool, list[str]]:
    """Ska erbjudandet med till frontend, och vilka genrer har spelet?

    Titeln kollas först eftersom det är gratis. Bara det som överlever
    kostar oss ett anrop till Steam – och samma anrop ger oss genrerna.
    Genren hör till spelet, inte butiken, så Steam kan svara även när
    rean gäller GOG eller Epic. Saknas Steam-id tar GOG:s katalog över.
    """
    if looks_like_extra(deal["title"]):
        return False, []

    app_id = deal.get("steamAppID")

    # Med Steam-id frågar vi Steam. Utan id, eller om Steam inte svarar,
    # försöker vi med GOG:s katalog i stället.
    details = steam_details(app_id) if app_id else None
    if details is None:
        details = gog_details(deal["title"])

    # Svarade ingen av dem vill vi hellre behålla raden än tappa ett riktigt
    # spel. Spelet visas då utan genre.
    if details is None:
        return True, []

    return details["type"] == "game", details["genres"]


# Vi visar bara gratisspel och erbjudanden med minst så här stor rabatt (samma
# gräns som MIN_SAVINGS_PERCENT i main.py). Slutdatum slår vi bara upp för dem.
MIN_SHOWN_SAVINGS = 80


def steam_end_dates(app_ids: list[str]) -> dict[str, datetime]:
    """Frågar Steam när rean tar slut, för många spel i taget.

    Returnerar {steam-id: slutdatum}. Spel utan pågående rea, eller utan
    känt slutdatum, saknas i svaret.
    """
    found: dict[str, datetime] = {}

    for start in range(0, len(app_ids), 100):
        batch = app_ids[start : start + 100]
        query = json.dumps(
            {
                "ids": [{"appid": int(app_id)} for app_id in batch],
                "context": {"language": "english", "country_code": "US"},
                "data_request": {},
            }
        )
        url = (
            "https://api.steampowered.com/IStoreBrowseService/GetItems/v1"
            f"?input_json={quote(query)}"
        )

        try:
            with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=30) as response:
                items = json.load(response)["response"].get("store_items", [])
        except Exception:
            continue

        for item in items:
            option = item.get("best_purchase_option") or {}
            for discount in option.get("active_discounts") or []:
                if discount.get("discount_end_date"):
                    found[str(item["appid"])] = datetime.fromtimestamp(
                        discount["discount_end_date"], tz=timezone.utc
                    )

    return found


def epic_end_dates() -> dict[str, datetime]:
    """Hämtar Epics egen lista över pågående kampanjer, med slutdatum.

    Returnerar {normaliserad titel: slutdatum}. CheapShark ger inget Epic-id,
    så spelen måste matchas på titel.
    """
    url = (
        "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions"
        "?locale=en-US&country=US&allowCountries=US"
    )

    try:
        with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=30) as response:
            elements = json.load(response)["data"]["Catalog"]["searchStore"]["elements"]
    except Exception:
        return {}

    found: dict[str, datetime] = {}
    for element in elements:
        # promotionalOffers är det som gäller nu. Kommande kampanjer ligger
        # i ett eget fält och ska inte förväxlas med dem.
        for group in (element.get("promotions") or {}).get("promotionalOffers", []):
            for offer in group["promotionalOffers"]:
                found[normalize_title(element["title"])] = datetime.fromisoformat(
                    offer["endDate"].replace("Z", "+00:00")
                )

    return found


# GOG:s produktsida har slutdatumet inbäddat som JavaScript, t.ex.
# cardProductPromoEndDate = {"date":"2026-10-07 09:59:59.000000","timezone_type":1,"timezone":"+03:00"}
GOG_PROMO_END = re.compile(r"cardProductPromoEndDate\s*=\s*(\{.*?\})")


def gog_end_date(title: str) -> datetime | None:
    """Läser slutdatumet från spelets sida hos GOG.

    GOG har inget API för det – katalogen saknar fältet – så vi läser sidan.
    Det är inte dokumenterat och kan sluta fungera om GOG bygger om sidan;
    då blir svaret None och erbjudandet visas utan nedräkning.
    """
    match = gog_find(title)
    if match is None:
        return None

    request = Request(
        f"https://www.gog.com/en/game/{match['slug']}",
        headers={"User-Agent": "Mozilla/5.0 (compatible; GameGrab/0.1; student project)"},
    )

    try:
        with urlopen(request, timeout=30) as response:
            html = response.read().decode("utf-8", errors="replace")
        promo = json.loads(GOG_PROMO_END.search(html).group(1))
        # timezone_type 1 betyder att tidszonen är en fast offset som "+03:00".
        # Andra typer har vi inte sett, och gissar hellre inte om.
        if promo["timezone_type"] != 1:
            return None
        return datetime.fromisoformat(promo["date"][:19] + promo["timezone"])
    except Exception:
        return None


def add_end_dates(rows: list[dict]) -> None:
    """Fyller i ends_at på raderna, från den butik som erbjudandet gäller.

    Sätter None när butiken inte uppger något slutdatum. Steam kollas bara
    för Steam-rader: ett spel kan vara på rea på GOG utan att vara det på Steam.
    """
    steam = steam_end_dates(
        [row["steam_app_id"] for row in rows if row["store"] == "Steam" and row["steam_app_id"]]
    )
    epic = epic_end_dates()

    for row in rows:
        if row["store"] == "Steam":
            row["ends_at"] = steam.get(row["steam_app_id"])
        elif row["store"] == "Epic Games":
            row["ends_at"] = epic.get(normalize_title(row["title"]))
        elif row["is_free"] or row["savings"] >= MIN_SHOWN_SAVINGS:
            row["ends_at"] = gog_end_date(row["title"])


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


def to_row(deal: dict, genres: list[str]) -> dict:
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
        "genres": genres,
        # Fylls i av add_end_dates. None betyder att slutdatumet är okänt.
        "ends_at": None,
    }


# deal_id är UNIQUE i tabellen. Känner databasen igen erbjudandet uppdateras
# raden i stället för att en dubblett skapas.
UPSERT = text("""
    INSERT INTO offers (
        deal_id, title, store, normal_price, sale_price,
        savings, is_free, thumb, steam_app_id, claim_url, genres, ends_at, fetched_at
    )
    VALUES (
        :deal_id, :title, :store, :normal_price, :sale_price,
        :savings, :is_free, :thumb, :steam_app_id, :claim_url, :genres, :ends_at, now()
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
        -- Ett spels genrer ändras inte. Misslyckades uppslaget den här gången
        -- (Steam eller GOG svarade inte) behåller vi de genrer vi redan har.
        genres       = CASE WHEN EXCLUDED.genres = '{}' THEN offers.genres
                            ELSE EXCLUDED.genres END,
        -- Samma sak för slutdatumet: misslyckas uppslaget behåller vi det vi har.
        -- Ett datum som hunnit passera döljs ändå av /offers.
        ends_at      = COALESCE(EXCLUDED.ends_at, offers.ends_at),
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
    rows = []
    for deal in deals:
        keep, genres = classify(deal)
        if keep:
            rows.append(to_row(deal, genres))
    print(f"  {len(deals) - len(rows)} bortsorterade, {len(rows)} spel kvar")
    print(f"  {sum(1 for row in rows if row['genres'])} av dem har genre (från Steam eller GOG)")

    print("Hämtar slutdatum…")
    add_end_dates(rows)
    print(f"  {sum(1 for row in rows if row['ends_at'])} av {len(rows)} har slutdatum")

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
