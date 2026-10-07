"""Fetches free and discounted offers from CheapShark and saves them to the database.

Runs automatically every hour via .github/workflows/fetch-offers.yml.

Can also be run manually, e.g. to test a change:

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
from html import unescape

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in backend/.env")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)

API = "https://www.cheapshark.com/api/1.0/deals"

# CheapShark requires requests to say which app is asking, otherwise they refuse.
USER_AGENT = "GameGrab/0.1 (student project)"

# The three PC stores we care about. The keys are CheapShark's own ids,
# the values are the names we want to show in the frontend.
STORES = {
    "1": "Steam",
    "7": "GOG",
    "25": "Epic Games",
}


# Words that reveal that the row is not a standalone game but an add-on,
# a pricier edition or a bundle. We only want the games themselves.
#
# "Edition" covers Deluxe, Gold, Ultimate, Premium and Game of the Year, which
# all end with that word. Words like "Remastered" and "Director's Cut" are
# deliberately left out – those are still full games.
EXCLUDE = re.compile(
    r"\b(DLC|Pack|Edition|Bundle|Collection|Season Pass|Upgrade|Soundtrack|Complete the Set)\b",
    re.IGNORECASE,
)


def looks_like_extra(title: str) -> bool:
    """Guesses from the title whether the row is an add-on rather than a game."""
    return EXCLUDE.search(title) is not None


# Steam genres that are actually genres. Steam also puts content warnings
# (Violent, Nudity…), pricing models (Free To Play) and Early Access in the same
# list – those should not become options in the genre filter. The ids are the
# same in every language.
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

def clean_steam_requirements(value: str | None) -> str | None:
    """Converts Steam's system requirements HTML to readable plain text."""
    if not value:
        return None

    # Turn line breaks and list items into normal text lines.
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"</li>", "\n", text, flags=re.IGNORECASE)

    # Remove the remaining HTML tags.
    text = re.sub(r"<[^>]+>", "", text)

    # Convert HTML entities such as &reg; to normal characters.
    text = unescape(text)

    # Remove empty lines and unnecessary whitespace.
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    return "\n".join(lines) or None

def split_steam_requirements(
    minimum: str | None,
    recommended: str | None,
) -> tuple[str | None, str | None]:
    """Separates minimum and recommended requirements when Steam combines them."""
    if minimum and not recommended and "Recommended:" in minimum:
        minimum_part, recommended_part = minimum.split("Recommended:", 1)

        minimum = minimum_part.strip()
        recommended = f"Recommended: {recommended_part.strip()}"

    return minimum, recommended

def steam_details(app_id: str) -> dict | None:
    """Asks Steam what something is (game, dlc, demo, music…) and which genres it has.

    Returns None if Steam doesn't recognise the id or doesn't respond.
    This is Steam's own answer, not a guess – so we trust it more than
    the title. Genres are fetched in English, so the site works for
    visitors regardless of language.
    """
    url = (
        "https://store.steampowered.com/api/appdetails"
        f"?appids={app_id}&l=english"
    )

    try:
        with urlopen(url, timeout=20) as response:
            payload = json.load(response)[str(app_id)]
    except Exception:
        return None

    if not payload.get("success"):
        return None

    data = payload["data"]
    requirements = data.get("pc_requirements") or {}

    minimum_requirements = clean_steam_requirements(
        requirements.get("minimum")
    )
    recommended_requirements = clean_steam_requirements(
        requirements.get("recommended")
    )

    minimum_requirements, recommended_requirements = split_steam_requirements(
        minimum_requirements,
        recommended_requirements,
    )

    return {
        "type": data.get("type"),
        "is_free": bool(data.get("is_free")),
        "genres": [
            genre["description"]
            for genre in data.get("genres", [])
            if genre["id"] in GAME_GENRE_IDS
        ],
        "description": data.get("short_description"),
        "minimum_requirements": minimum_requirements,
        "recommended_requirements": recommended_requirements,
    }


GOG_CATALOG = "https://catalog.gog.com/v1/catalog"

# GOG has its own genres, most of them themes like Fantasy and Sci-fi. Only the
# ones with a clear equivalent among Steam's genres are kept, translated to
# Steam's names, so the filter doesn't get both "RPG" and "Role-playing". The
# rest are dropped.
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
    """Makes titles comparable: lowercase, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", title.lower())


@lru_cache(maxsize=None)
def gog_find(title: str) -> dict | None:
    """Looks up the title in GOG's catalog and returns GOG's own entry for the game.

    Only the exact same title counts. A looser search easily finds the wrong
    game, like Fallout 76 when we're looking for Fallout.

    Returns None if GOG doesn't find the game or doesn't respond – the catalog
    is not officially documented and sometimes responds with errors. The result
    is cached, so the genre and end date lookups for the same game only cost
    one request.
    """
    params = urlencode({"query": f"like:{title}", "limit": 10})
    request = Request(f"{GOG_CATALOG}?{params}", headers={"User-Agent": USER_AGENT})

    # GOG sometimes responds 503 for a short while. Three attempts with a pause
    # in between is usually enough, and only applies to the few games without
    # a Steam id.
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
    """Fallback for games without a Steam id: looks up genre and type in GOG's catalog."""
    match = gog_find(title)
    if match is None:
        return None

    genres: list[str] = []
    for genre in match.get("genres", []):
        steam_name = GOG_TO_STEAM_GENRE.get(genre["name"])
        if steam_name and steam_name not in genres:
            genres.append(steam_name)

    # GOG says game, dlc or pack. Only dlc reliably means "not a game":
    # GOG also calls full games like Fallout and Fallout 2 packs, since they
    # ship with extra material. Real bundles are already caught by the title rule.
    kind = "dlc" if match.get("productType") == "dlc" else "game"
    return {"type": kind, "is_free": False, "genres": genres}


def classify(
    deal: dict,
) -> tuple[bool, list[str], str | None, str | None, str | None]:
    """Should the offer be sent to the frontend, and which genres does the game have?

    The title is checked first since it's free. Only what survives costs
    us a request to Steam – and the same request gives us the genres.
    The genre belongs to the game, not the store, so Steam can answer even
    when the sale is on GOG or Epic. Without a Steam id, GOG's catalog takes over.
    """
    if looks_like_extra(deal["title"]):
        return False, [], None, None, None

    app_id = deal.get("steamAppID")

    # With a Steam id we ask Steam. Without an id, or if Steam doesn't respond,
    # we try GOG's catalog instead.
    details = steam_details(app_id) if app_id else None
    if details is None:
        details = gog_details(deal["title"])

    # If neither responded we'd rather keep the row than lose a real
    # game. The game is then shown without a genre.
    if details is None:
        return True, [], None, None, None

    return (
        details["type"] == "game",
        details["genres"],
        details.get("description"),
        details.get("minimum_requirements"),
        details.get("recommended_requirements"),
)


# We only show free games and offers with at least this much discount (same
# threshold as MIN_SAVINGS_PERCENT in main.py). We only look up end dates for those.
MIN_SHOWN_SAVINGS = 80


def steam_end_dates(app_ids: list[str]) -> dict[str, datetime]:
    """Asks Steam when the sale ends, for many games at a time.

    Returns {steam id: end date}. Games without an ongoing sale, or without
    a known end date, are missing from the result.
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
    """Fetches Epic's own list of ongoing promotions, with end dates.

    Returns {normalized title: end date}. CheapShark doesn't provide an Epic id,
    so games have to be matched by title.
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
        # promotionalOffers is what applies right now. Upcoming promotions live
        # in a separate field and must not be confused with them.
        for group in (element.get("promotions") or {}).get("promotionalOffers", []):
            for offer in group["promotionalOffers"]:
                found[normalize_title(element["title"])] = datetime.fromisoformat(
                    offer["endDate"].replace("Z", "+00:00")
                )

    return found


# GOG's product page has the end date embedded as JavaScript, e.g.
# cardProductPromoEndDate = {"date":"2026-10-07 09:59:59.000000","timezone_type":1,"timezone":"+03:00"}
GOG_PROMO_END = re.compile(r"cardProductPromoEndDate\s*=\s*(\{.*?\})")


def gog_end_date(title: str) -> datetime | None:
    """Reads the end date from the game's page on GOG.

    GOG has no API for it – the catalog lacks the field – so we read the page.
    This is undocumented and may stop working if GOG rebuilds the page;
    the result is then None and the offer is shown without a countdown.
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
        # timezone_type 1 means the time zone is a fixed offset like "+03:00".
        # We haven't seen other types, and would rather not guess.
        if promo["timezone_type"] != 1:
            return None
        return datetime.fromisoformat(promo["date"][:19] + promo["timezone"])
    except Exception:
        return None


def add_end_dates(rows: list[dict]) -> None:
    """Fills in ends_at on the rows, from the store the offer applies to.

    Sets None when the store doesn't provide an end date. Steam is only checked
    for Steam rows: a game can be on sale on GOG without being on sale on Steam.
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
    """Sends one query to CheapShark and returns the response as a list."""
    url = f"{API}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})

    with urlopen(request, timeout=30) as response:
        return json.load(response)


def collect() -> list[dict]:
    """Collects offers from CheapShark.

    Two kinds of requests, since the site is about both free and discounted:
    the top-rated deals, plus everything that is completely free right now.
    """
    store_ids = ",".join(STORES)
    deals: dict[str, dict] = {}

    # Three pages of the deals CheapShark itself ranks highest.
    for page in range(3):
        for deal in fetch_page(
            storeID=store_ids, pageSize=60, pageNumber=page, sortBy="Deal Rating"
        ):
            deals[deal["dealID"]] = deal

    # Everything that costs zero right now. Collected separately, otherwise
    # they risk falling outside the three pages above.
    for deal in fetch_page(storeID=store_ids, pageSize=60, upperPrice=0):
        deals[deal["dealID"]] = deal

    # The key is dealID, so the same offer can only appear once.
    return list(deals.values())


def to_row(
    deal: dict,
    genres: list[str],
    description: str | None,
    minimum_requirements: str | None,
    recommended_requirements: str | None,
) -> dict:
    """Translates CheapShark's field names to our column names."""
    steam_app_id = deal.get("steamAppID")
    store = STORES[deal["storeID"]]

    # If the sale is on Steam we can link straight to the store page.
    #
    # For GOG and Epic, CheapShark redirects the visitor. Their dealID is
    # already URL-encoded in the response, so it must not be encoded again.
    #
    # Important: Steam only. Many GOG and Epic games are also on Steam and
    # have a steamAppID, but the sale doesn't apply there – we would then send
    # the visitor to the wrong store and the wrong price.
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
        "description": description,
        "minimum_requirements": minimum_requirements,
        "recommended_requirements": recommended_requirements,
        # Filled in by add_end_dates. None means the end date is unknown.
        "ends_at": None,
    }


# deal_id is UNIQUE in the table. If the database recognises the offer, the
# row is updated instead of creating a duplicate.
UPSERT = text("""
    INSERT INTO offers (
        deal_id, title, store, normal_price, sale_price,
        savings, is_free, thumb, steam_app_id, claim_url, genres, description, minimum_requirements, recommended_requirements, ends_at, fetched_at
)
    VALUES (
        :deal_id, :title, :store, :normal_price, :sale_price,
        :savings, :is_free, :thumb, :steam_app_id, :claim_url, :genres, :description, :minimum_requirements, :recommended_requirements, :ends_at, now()
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
        -- A game's genres don't change. If the lookup failed this time
        -- (Steam or GOG didn't respond) we keep the genres we already have.
        genres       = CASE WHEN EXCLUDED.genres = '{}' THEN offers.genres
                            ELSE EXCLUDED.genres END,
        -- Same for the end date: if the lookup fails we keep what we have.
        -- A date that has already passed is hidden by /offers anyway.
        description = COALESCE(EXCLUDED.description, offers.description),
        minimum_requirements = COALESCE(
            EXCLUDED.minimum_requirements,
            offers.minimum_requirements
        ),
        recommended_requirements = COALESCE(
            EXCLUDED.recommended_requirements,
            offers.recommended_requirements
        ),
        ends_at      = COALESCE(EXCLUDED.ends_at, offers.ends_at),
        fetched_at   = now()
""")


def save(rows: list[dict]) -> None:
    """Saves the rows. All or nothing – if anything fails, nothing is written."""
    with engine.begin() as connection:
        connection.execute(UPSERT, rows)


def remove_stale(keep: list[str]) -> int:
    """Removes rows that no longer exist on CheapShark.

    Without this, an offer that has ended would stay forever and be shown
    as active – the worst thing a site like this can do.
    """
    if not keep:
        # An empty list means the fetch went wrong. Don't touch anything.
        return 0

    with engine.begin() as connection:
        result = connection.execute(
            text("DELETE FROM offers WHERE deal_id <> ALL(:keep)"), {"keep": keep}
        )

    return result.rowcount


def main() -> None:
    print("Fetching from CheapShark…")
    deals = collect()
    print(f"  {len(deals)} offers fetched")

    print("Filtering out add-ons, editions and bundles…")
    rows = []
    for deal in deals:
        (
            keep,
            genres,
            description,
            minimum_requirements,
            recommended_requirements,
        ) = classify(deal)

        if keep:
            rows.append(
                to_row(
                    deal,
                    genres,
                    description,
                    minimum_requirements,
                    recommended_requirements,
                )
            )
    print(f"  {len(deals) - len(rows)} filtered out, {len(rows)} games left")
    print(f"  {sum(1 for row in rows if row['genres'])} of them have a genre (from Steam or GOG)")

    print("Fetching end dates…")
    add_end_dates(rows)
    print(f"  {sum(1 for row in rows if row['ends_at'])} of {len(rows)} have an end date")

    save(rows)

    stale = remove_stale([row["deal_id"] for row in rows])
    if stale:
        print(f"  {stale} old offers removed")

    free = sum(1 for row in rows if row["is_free"])
    print()
    print(f"Saved {len(rows)} games, of which {free} are completely free.")

    for store in STORES.values():
        print(f"  {store:<12} {sum(1 for r in rows if r['store'] == store)}")


if __name__ == "__main__":
    main()
