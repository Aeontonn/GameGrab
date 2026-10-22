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

# Popular Steam games that Steam's search sometimes leaves out. They are
# always included, also after TARGET is reached.
EXTRA_STEAM_GAMES = {
    "730": "Counter-Strike 2",
}

# Popular free to play games outside Steam. There is nothing to fetch them
# from, so they are listed here and put after the Steam games.
OTHER_STORE_GAMES = [
    {
        "title": "League of Legends",
        "store": "Riot Games",
        "claim_url": "https://www.leagueoflegends.com/",
        "genres": ["Action", "Strategy"],
    },
    {
        "title": "VALORANT",
        "store": "Riot Games",
        "claim_url": "https://playvalorant.com/",
        "genres": ["Action"],
    },
    {
        "title": "Teamfight Tactics",
        "store": "Riot Games",
        "claim_url": "https://teamfighttactics.leagueoflegends.com/",
        "genres": ["Strategy"],
    },
    {
        "title": "Legends of Runeterra",
        "store": "Riot Games",
        "claim_url": "https://playruneterra.com/",
        "genres": ["Strategy"],
    },
    {
        "title": "Hearthstone",
        "store": "Battle.net",
        "claim_url": "https://hearthstone.blizzard.com/",
        "genres": ["Strategy"],
    },
    {
        "title": "Diablo Immortal",
        "store": "Battle.net",
        "claim_url": "https://diabloimmortal.blizzard.com/",
        "genres": ["Action", "RPG"],
    },
    {
        "title": "Heroes of the Storm",
        "store": "Battle.net",
        "claim_url": "https://heroesofthestorm.blizzard.com/",
        "genres": ["Action", "Strategy"],
    },
]

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

    # Games Steam's search left out go last.
    for app_id, title in EXTRA_STEAM_GAMES.items():
        found.setdefault(app_id, title)

    return list(found.items())


def saved_steam_games() -> dict[str, dict]:
    """The Steam games already in the database, by app id."""
    with engine.connect() as connection:
        rows = connection.execute(
            text("""
                SELECT steam_app_id, title, genres, claim_url
                FROM free_games
                WHERE steam_app_id IS NOT NULL
            """)
        ).mappings().all()

    return {row["steam_app_id"]: dict(row) for row in rows}


def collect() -> list[dict]:
    """Confirms the candidates with Steam and stops once we have TARGET games."""
    rows: list[dict] = []
    saved = saved_steam_games()

    for app_id, title in search_candidates():
        # After TARGET, only the extra games are still let in.
        if len(rows) >= TARGET and app_id not in EXTRA_STEAM_GAMES:
            continue

        if looks_like_extra(title) or looks_adult(title):
            continue

        details = steam_details(app_id)
        time.sleep(PAUSE_SECONDS)

        # Steam didn't answer. A game we already have keeps its place, so a
        # short outage doesn't remove it from the list.
        if details is None:
            if app_id in saved:
                rows.append({**saved[app_id], "rank": len(rows) + 1})
            continue

        # Steam's own answer decides: a real game that is free forever.
        # is_free distinguishes free to play from a game that is only given
        # away for free for a short while.
        if details["type"] != "game" or not details["is_free"] or details["adult"]:
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

# Games outside Steam have no Steam id and are matched on store and title.
UPSERT_OTHER = text("""
    INSERT INTO free_games (steam_app_id, store, title, genres, rank, claim_url, fetched_at)
    VALUES (NULL, :store, :title, :genres, :rank, :claim_url, now())
    ON CONFLICT (store, title) WHERE steam_app_id IS NULL DO UPDATE SET
        genres     = EXCLUDED.genres,
        rank       = EXCLUDED.rank,
        claim_url  = EXCLUDED.claim_url,
        fetched_at = now()
""")


def save(rows: list[dict], other_rows: list[dict]) -> int:
    """Saves the rows and removes games that are no longer included. All or nothing."""
    with engine.begin() as connection:
        connection.execute(UPSERT, rows)
        connection.execute(UPSERT_OTHER, other_rows)

        removed = connection.execute(
            text("""
                DELETE FROM free_games
                WHERE steam_app_id <> ALL(:keep)
                   OR (steam_app_id IS NULL AND (store, title) NOT IN
                       (SELECT * FROM unnest(CAST(:other_stores AS text[]),
                                             CAST(:other_titles AS text[]))))
            """),
            {
                "keep": [row["steam_app_id"] for row in rows],
                "other_stores": [row["store"] for row in other_rows],
                "other_titles": [row["title"] for row in other_rows],
            },
        )

    return removed.rowcount


def main() -> None:
    print("Fetching free to play games from Steam…")
    rows = collect()
    print(f"  {len(rows)} games confirmed")

    # An empty list means the fetch went wrong. Don't touch anything.
    if not rows:
        raise SystemExit("No games found – leaving the database untouched.")

    other_rows = [
        {**game, "rank": len(rows) + position}
        for position, game in enumerate(OTHER_STORE_GAMES, start=1)
    ]

    removed = save(rows, other_rows)
    if removed:
        print(f"  {removed} games removed")

    total = rows + other_rows
    print(f"Saved {len(total)} games, of which {sum(1 for r in total if r['genres'])} have a genre.")


if __name__ == "__main__":
    main()
