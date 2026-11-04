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
from app.fetch_offers import (
    USER_AGENT,
    clean_steam_requirements,
    engine,
    looks_adult,
    looks_like_extra,
    steam_details,
)

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
        "description": (
            "A competitive multiplayer online battle arena game where two "
            "teams of five champions fight to destroy the opposing team's base."
        ),
        "minimum_requirements": (
            "Minimum:<br>"
            "OS: Windows 10 (build 19041+) or Windows 11, 64-bit<br>"
            "Processor: Intel Core i3-530 / AMD A6-3650<br>"
            "Memory: 2 GB RAM<br>"
            "Graphics: NVIDIA GeForce 400 series / AMD Radeon HD 6570 / Intel HD 4600<br>"
            "VRAM: 1 GB<br>"
            "DirectX: Version 11 (feature level 11_0)<br>"
            "Storage: 16 GB HDD"
        ),
        "recommended_requirements": (
            "Recommended:<br>"
            "OS: Windows 11, 64-bit<br>"
            "Processor: Intel Core i5-8250 / AMD Ryzen 3 1200<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: NVIDIA GeForce 560 / AMD Radeon HD 6950 / Intel UHD 630<br>"
            "VRAM: 2 GB<br>"
            "DirectX: Version 11<br>"
            "Storage: 16 GB SSD"
        ),
    },
    {
        "title": "VALORANT",
        "store": "Riot Games",
        "claim_url": "https://playvalorant.com/",
        "genres": ["Action"],
        "description": (
            "A tactical first-person shooter where teams of five compete "
            "using precise gunplay and unique agent abilities."
        ),
        "minimum_requirements": (
            "Minimum (30 FPS):<br>"
            "OS: Windows 10 (build 19041+) or Windows 11, 64-bit<br>"
            "Processor: Intel Core i3-540 / AMD Athlon 200GE<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: Intel HD 4000 / AMD Radeon R5 220<br>"
            "DirectX: Version 11<br>"
            "Additional Notes: CPU requires SSE 4.2 or AVX support. "
            "Dedicated GPUs require at least 1 GB VRAM. "
            "Windows 11 requires TPM 2.0 and UEFI Secure Boot."
        ),
        "recommended_requirements": (
            "Recommended (60 FPS):<br>"
            "OS: Windows 10 (build 19041+) or Windows 11, 64-bit<br>"
            "Processor: Intel Core i3-4150 / AMD Ryzen 3 1200<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: NVIDIA GeForce GT 730 / AMD Radeon R7 240<br>"
            "DirectX: Version 11<br>"
            "Additional Notes: CPU requires SSE 4.2 or AVX support. "
            "Dedicated GPUs require at least 1 GB VRAM. "
            "Windows 11 requires TPM 2.0 and UEFI Secure Boot."
        ),
    },
    {
        "title": "Teamfight Tactics",
        "store": "Riot Games",
        "claim_url": "https://teamfighttactics.leagueoflegends.com/",
        "genres": ["Strategy"],
        "description": (
            "An auto-battler strategy game where players build teams of "
            "champions, combine items, and compete to be the last player standing."
        ),
        "minimum_requirements": (
            "Minimum:<br>"
            "OS: Windows 10 (build 19041+) or Windows 11, 64-bit<br>"
            "Processor: Intel Core i3-530 / AMD A6-3650<br>"
            "Memory: 2 GB RAM<br>"
            "Graphics: NVIDIA GeForce 400 series / AMD Radeon HD 6570 / Intel HD 4600<br>"
            "VRAM: 1 GB<br>"
            "DirectX: Version 11 (feature level 11_0)<br>"
            "Storage: 16 GB HDD"
        ),
        "recommended_requirements": (
            "Recommended:<br>"
            "OS: Windows 11, 64-bit<br>"
            "Processor: Intel Core i5-8250 / AMD Ryzen 3 1200<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: NVIDIA GeForce 560 / AMD Radeon HD 6950 / Intel UHD 630<br>"
            "VRAM: 2 GB<br>"
            "DirectX: Version 11<br>"
            "Storage: 16 GB SSD"
        ),
    },
    {
        "title": "Legends of Runeterra",
        "store": "Riot Games",
        "claim_url": "https://playruneterra.com/",
        "genres": ["Strategy"],
        "description": (
            "A strategy card game set in the League of Legends universe, "
            "featuring champions, spells, and tactical battles."
        ),
        "minimum_requirements": (
            "Minimum:<br>"
            "OS: Windows 10 or Windows 11, 64-bit<br>"
            "Processor: Intel Core 2 Duo E8400 / AMD Athlon 200GE<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: GPU with at least 512 MB VRAM"
        ),
        "recommended_requirements": None,
    },
    {
        "title": "Hearthstone",
        "store": "Battle.net",
        "claim_url": "https://hearthstone.blizzard.com/",
        "genres": ["Strategy"],
        "description": (
            "A digital collectible card game set in the Warcraft universe, "
            "where players build decks and compete in turn-based battles."
        ),
        "minimum_requirements": (
            "Minimum:<br>"
            "OS: Windows 10 64-bit (21H1)<br>"
            "Processor: Intel Core i3-6100 / AMD A10-7850K<br>"
            "Memory: 8 GB RAM<br>"
            "Graphics: NVIDIA GeForce GTX 660 / AMD Radeon R9 280X<br>"
            "Storage: 12 GB available space<br>"
            "Network: Broadband Internet connection<br>"
            "Input: Keyboard and mouse<br>"
            "Resolution: 1024 x 768 minimum"
        ),
        "recommended_requirements": (
            "Recommended:<br>"
            "OS: Windows 10 64-bit (21H1)<br>"
            "Processor: Intel Core i5-10400F / AMD Ryzen 7 1800X<br>"
            "Memory: 16 GB RAM<br>"
            "Graphics: NVIDIA GeForce 1050 Ti / AMD Radeon RX 570<br>"
            "Storage: 13 GB available space<br>"
            "Network: Broadband Internet connection<br>"
            "Input: Keyboard and mouse<br>"
            "Resolution: 1024 x 768 minimum"
        ),
    },
    {
        "title": "Diablo Immortal",
        "store": "Battle.net",
        "claim_url": "https://diabloimmortal.blizzard.com/",
        "genres": ["Action", "RPG"],
        "description": (
            "A free-to-play action RPG set in the Diablo universe, featuring "
            "dungeon exploration, character progression, and multiplayer combat."
        ),
        "minimum_requirements": (
            "Minimum:<br>"
            "OS: Windows 10 / Windows 11, 64-bit<br>"
            "Processor: Intel Core i3 / AMD FX-8100<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: NVIDIA GeForce GTX 460 / ATI Radeon HD 6850 / "
            "Intel HD Graphics 530<br>"
            "Network: Broadband Internet connection<br>"
            "Resolution: 1920 x 1080 minimum"
        ),
        "recommended_requirements": (
            "Recommended:<br>"
            "OS: Windows 10 / Windows 11, 64-bit<br>"
            "Processor: Intel Core i5 / AMD Ryzen 5<br>"
            "Memory: 8 GB RAM<br>"
            "Graphics: NVIDIA GeForce GTX 770 / AMD Radeon RX 470<br>"
            "Network: Broadband Internet connection<br>"
            "Resolution: 1920 x 1080 minimum"
        ),
    },
    {
        "title": "Heroes of the Storm",
        "store": "Battle.net",
        "claim_url": "https://heroesofthestorm.blizzard.com/",
        "genres": ["Action", "Strategy"],
        "description": (
            "A team-based multiplayer online battle arena featuring heroes "
            "from Blizzard's game universes and objective-focused battlegrounds."
        ),
        "minimum_requirements": (
            "Minimum:<br>"
            "OS: Windows 10<br>"
            "Processor: Intel Core 2 Duo E6600 / AMD Phenom X4<br>"
            "Memory: 3 GB RAM<br>"
            "Graphics: NVIDIA GeForce 8600 GT / ATI Radeon HD 4650 / "
            "Intel HD Graphics 3000<br>"
            "Storage: 20 GB available space<br>"
            "Network: Broadband Internet connection<br>"
            "Input: Keyboard and mouse required<br>"
            "Resolution: 1024 x 768 minimum"
        ),
        "recommended_requirements": (
            "Recommended:<br>"
            "OS: Windows 10 64-bit<br>"
            "Processor: Intel Core i5 / AMD FX Series or better<br>"
            "Memory: 4 GB RAM<br>"
            "Graphics: NVIDIA GeForce GTX 650 / AMD Radeon HD 7790 or better<br>"
            "Storage: 20 GB available space<br>"
            "Network: Broadband Internet connection<br>"
            "Input: Keyboard and mouse required<br>"
            "Resolution: 1024 x 768 minimum"
        ),
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
                SELECT steam_app_id, title, genres, claim_url,
                        description, thumb, minimum_requirements,
                        recommended_requirements
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
                "thumb": details["thumb"],
                "rank": len(rows) + 1,
                "claim_url": f"https://store.steampowered.com/app/{app_id}/",
                "description": details["description"],
                "minimum_requirements": details["minimum_requirements"],
                "recommended_requirements": details["recommended_requirements"],
            }
        )

    return rows


# steam_app_id is UNIQUE. If the game already exists, the row is updated.
UPSERT = text("""
    INSERT INTO free_games (
        steam_app_id, title, genres, rank, claim_url, thumb,
        description, minimum_requirements, recommended_requirements,
        fetched_at
    )
    VALUES (
        :steam_app_id, :title, :genres, :rank, :claim_url, :thumb,
        :description, :minimum_requirements, :recommended_requirements,
        now()
    )
    ON CONFLICT (steam_app_id) DO UPDATE SET
        title = EXCLUDED.title,

        -- Keep existing genres if Steam returned an empty list.
        genres = CASE
            WHEN EXCLUDED.genres = '{}' THEN free_games.genres
            ELSE EXCLUDED.genres
        END,

        rank = EXCLUDED.rank,
        claim_url = EXCLUDED.claim_url,

        thumb = COALESCE(
            EXCLUDED.thumb,
            free_games.thumb
        ),

        -- Keep existing information if Steam returned NULL.
        description = COALESCE(
            EXCLUDED.description,
            free_games.description
        ),
        minimum_requirements = COALESCE(
            EXCLUDED.minimum_requirements,
            free_games.minimum_requirements
        ),
        recommended_requirements = COALESCE(
            EXCLUDED.recommended_requirements,
            free_games.recommended_requirements
        ),

        fetched_at = now()
""")

# Games outside Steam have no Steam id and are matched on store and title.
UPSERT_OTHER = text("""
    INSERT INTO free_games (
        steam_app_id, store, title, genres, rank, claim_url,
        description, minimum_requirements,
        recommended_requirements, fetched_at
    )
    VALUES (
        NULL, :store, :title, :genres, :rank, :claim_url,
        :description, :minimum_requirements,
        :recommended_requirements, now()
    )
    ON CONFLICT (store, title) WHERE steam_app_id IS NULL DO UPDATE SET
        genres = EXCLUDED.genres,
        rank = EXCLUDED.rank,
        claim_url = EXCLUDED.claim_url,
        description = COALESCE(
            EXCLUDED.description, free_games.description
        ),
        minimum_requirements = COALESCE(
            EXCLUDED.minimum_requirements, free_games.minimum_requirements
        ),
        recommended_requirements = COALESCE(
            EXCLUDED.recommended_requirements, free_games.recommended_requirements
        ),
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

    # The hand-written requirements use <br> like Steam's, so they go through
    # the same cleanup. The details window shows plain text with line breaks.
    other_rows = [
        {
            **game,
            "rank": len(rows) + position,
            "minimum_requirements": clean_steam_requirements(game.get("minimum_requirements")),
            "recommended_requirements": clean_steam_requirements(game.get("recommended_requirements")),
        }
        for position, game in enumerate(OTHER_STORE_GAMES, start=1)
    ]

    removed = save(rows, other_rows)
    if removed:
        print(f"  {removed} games removed")

    total = rows + other_rows
    print(f"Saved {len(total)} games, of which {sum(1 for r in total if r['genres'])} have a genre.")


if __name__ == "__main__":
    main()
