"""Fetches games that are always free (free to play) from Steam and saves them to the database.

Unlike fetch_offers.py, this is about games that never cost anything, not
time-limited offers. CheapShark doesn't list them at all, since they have
no regular price.

Runs automatically once a day via .github/workflows/fetch-free-games.yml.

Can also be run manually:

    cd backend
    python -m app.fetch_free_games
"""

from html import unescape
from urllib.request import Request, urlopen
import json
import re
import time

from sqlalchemy import text

# Reuses the Steam lookup and title filter from the offer fetcher.
from app.fetch_offers import USER_AGENT, engine, looks_adult, looks_like_extra, steam_details

# How many games the list should contain.
TARGET = 150

# Popular Steam games that may be missing from the search results.
EXTRA_STEAM_GAMES = {
    "730": "Counter-Strike 2",
}

# Steam's search, filtered on the tag Free to Play (113) and the category
# "games" (998, i.e. not DLC, demos or soundtracks). Steam sorts by
# relevance, which in practice means the most played first.
SEARCH = (
    "https://store.steampowered.com/search/results/"
    "?query&tags=113&category1=998&json=1&infinite=1&count=100&start={start}"
)

# A result card in the search results: the app's id followed by the title.
RESULT = re.compile(
    r'data-ds-appid="(\d+)".*?<span class="title">(.*?)</span>', re.DOTALL
)

# Steam rate-limits appdetails, so we take it easy.

PAUSE_SECONDS = 0.5


def search_candidates(pages: int = 3) -> list[tuple[str, str]]:
    """Returns (app id, title) for the most popular free to play games, most played first."""
    found: dict[str, str] = {}

    for page in range(pages):
        request = Request(
            SEARCH.format(start=page * 100), headers={"User-Agent": USER_AGENT}
        )
        with urlopen(request, timeout=30) as response:
            html = json.load(response)["results_html"]

        for app_id, title in RESULT.findall(html):
            found.setdefault(app_id, unescape(title))

    # Include selected popular games even if Steam search omits them.
    for app_id, title in EXTRA_STEAM_GAMES.items():
        found.setdefault(app_id, title)

    return list(found.items())



def collect() -> list[dict]:
    """Collects TARGET free Steam games, then adds selected popular games."""
    rows: list[dict] = []

    candidates = search_candidates()

    # Add extra games after the regular candidates have been processed.
    for rank, (app_id, title) in enumerate(candidates, start=1):
        if len(rows) >= TARGET:
            break

        if looks_like_extra(title) or looks_adult(title):
            continue

        details = steam_details(app_id)
        time.sleep(PAUSE_SECONDS)

        if (
            details is None
            or details["type"] != "game"
            or not details["is_free"]
            or details["adult"]
        ):
            continue

        rows.append(
            {
                "steam_app_id": app_id,
                "title": title,
                "genres": details["genres"],
                "rank": len(rows) + 1,
                "claim_url": f"https://store.steampowered.com/app/{app_id}/",
            }
        )

    # Add selected popular games without replacing the regular 150.
    existing_ids = {row["steam_app_id"] for row in rows}

    for app_id, title in EXTRA_STEAM_GAMES.items():
        if app_id in existing_ids:
            continue

        if looks_like_extra(title) or looks_adult(title):
            continue

        details = steam_details(app_id)
        time.sleep(PAUSE_SECONDS)

        if (
            details is None
            or details["type"] != "game"
            or not details["is_free"]
            or details["adult"]
        ):
            continue

        rows.append(
            {
                "steam_app_id": app_id,
                "title": title,
                "genres": details["genres"],
                "rank": len(rows) + 1,
                "claim_url": f"https://store.steampowered.com/app/{app_id}/",
            }
        )

        existing_ids.add(app_id)

    return rows


def check_existing_games(rows: list[dict]) -> list[dict]:
    """Keep previously saved games unless Steam confirms they are no longer free."""

    new_ids = {row["steam_app_id"] for row in rows}

    with engine.connect() as connection:
        existing_games = connection.execute(
            text("""
                SELECT steam_app_id, title, genres, claim_url
                FROM free_games
            """)
        ).mappings().all()

    for game in existing_games:
        app_id = str(game["steam_app_id"])

        # Already included in the new Steam fetch.
        if app_id in new_ids:
            continue

        print(f"Checking existing game: {game['title']}")

        details = steam_details(app_id)
        time.sleep(PAUSE_SECONDS)

        # If Steam cannot respond, keep the game for now.
        if details is None:
            print("  Steam lookup unavailable - keeping game")
            keep_game = True

        elif (
            details["type"] != "game"
            or not details["is_free"]
            or details["adult"]
        ):
            print("  No longer qualifies - excluding game")
            keep_game = False

        else:
            print("  Still free - keeping game")
            keep_game = True

        if not keep_game:
            continue

        rows.append(
            {
                "steam_app_id": app_id,
                "title": game["title"],
                "genres": details["genres"] if details is not None else (game["genres"] or []),
                "rank": len(rows) + 1,
                "claim_url": game["claim_url"],
            }
        )

        new_ids.add(app_id)

    return rows


# steam_app_id is UNIQUE. If the game already exists, the row is updated.
UPSERT = text("""
    INSERT INTO free_games (steam_app_id, title, genres, rank, claim_url, fetched_at)
    VALUES (:steam_app_id, :title, :genres, :rank, :claim_url, now())
    ON CONFLICT (steam_app_id) DO UPDATE SET
        title      = EXCLUDED.title,
        -- If the genre lookup failed we keep the genres we already have.
        genres     = CASE WHEN EXCLUDED.genres = '{}' THEN free_games.genres
                          ELSE EXCLUDED.genres END,
        rank       = EXCLUDED.rank,
        claim_url  = EXCLUDED.claim_url,
        fetched_at = now()
""")


def save(rows: list[dict]) -> int:
    """Saves the rows and removes games that are no longer included. All or nothing."""
    with engine.begin() as connection:
        connection.execute(UPSERT, rows)
        result = connection.execute(
            text("DELETE FROM free_games WHERE steam_app_id <> ALL(:keep)"),
            {"keep": [row["steam_app_id"] for row in rows]},
        )

    return result.rowcount


def main() -> None:
    print("Fetching free to play games from Steam…")
    rows = collect()
    print(f"  {len(rows)} games confirmed")

    # An empty list means the fetch went wrong. Don't touch anything.
    if not rows:
        raise SystemExit("No games found – leaving the database untouched.")

        # Check previously saved games before deciding what to remove.
    rows = check_existing_games(rows)

    print(f"  {len(rows)} games after checking existing games")

    removed = save(rows)
    if removed:
        print(f"  {removed} games removed")

    print(
        f"Saved {len(rows)} games, "
        f"of which {sum(1 for r in rows if r['genres'])} have a genre."
    )

if __name__ == "__main__":
    main()
