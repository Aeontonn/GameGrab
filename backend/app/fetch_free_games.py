"""Hämtar spel som alltid är gratis (free to play) från Steam och sparar dem i databasen.

Till skillnad från fetch_offers.py handlar det här om spel som aldrig kostar
något, inte om tidsbegränsade erbjudanden. CheapShark listar dem inte alls,
eftersom de saknar ordinarie pris.

Körs automatiskt en gång per dygn av .github/workflows/fetch-free-games.yml.

Kan också köras manuellt:

    cd backend
    python -m app.fetch_free_games
"""

from html import unescape
from urllib.request import Request, urlopen
import json
import re
import time

from sqlalchemy import text

# Återanvänder Steam-uppslaget och titelfiltret från erbjudandehämtningen.
from app.fetch_offers import USER_AGENT, engine, looks_like_extra, steam_details

# Hur många spel listan ska innehålla.
TARGET = 150

# Steams sökning, filtrerad på taggen Free to Play (113) och kategorin
# "spel" (998, alltså inte DLC, demos eller soundtracks). Steam sorterar
# efter relevans, vilket i praktiken betyder de mest spelade först.
SEARCH = (
    "https://store.steampowered.com/search/results/"
    "?query&tags=113&category1=998&json=1&infinite=1&count=100&start={start}"
)

# Ett träffkort i sökresultatet: appens id följt av titeln.
RESULT = re.compile(
    r'data-ds-appid="(\d+)".*?<span class="title">(.*?)</span>', re.DOTALL
)

# Steam stryper hastigheten på appdetails, så vi tar det lugnt.
PAUSE_SECONDS = 0.5


def search_candidates(pages: int = 3) -> list[tuple[str, str]]:
    """Returnerar (app-id, titel) för de populäraste free to play-spelen, mest spelade först."""
    found: dict[str, str] = {}

    for page in range(pages):
        request = Request(
            SEARCH.format(start=page * 100), headers={"User-Agent": USER_AGENT}
        )
        with urlopen(request, timeout=30) as response:
            html = json.load(response)["results_html"]

        for app_id, title in RESULT.findall(html):
            found.setdefault(app_id, unescape(title))

    return list(found.items())


def collect() -> list[dict]:
    """Bekräftar kandidaterna hos Steam och stannar när vi har TARGET spel."""
    rows: list[dict] = []

    for rank, (app_id, title) in enumerate(search_candidates(), start=1):
        if len(rows) >= TARGET:
            break

        if looks_like_extra(title):
            continue

        details = steam_details(app_id)
        time.sleep(PAUSE_SECONDS)

        # Steams eget svar avgör: ett riktigt spel som är gratis för alltid.
        # is_free skiljer free to play från ett spel som bara delas ut gratis
        # en kort stund.
        if details is None or details["type"] != "game" or not details["is_free"]:
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


# steam_app_id är UNIQUE. Finns spelet redan uppdateras raden.
UPSERT = text("""
    INSERT INTO free_games (steam_app_id, title, genres, rank, claim_url, fetched_at)
    VALUES (:steam_app_id, :title, :genres, :rank, :claim_url, now())
    ON CONFLICT (steam_app_id) DO UPDATE SET
        title      = EXCLUDED.title,
        -- Misslyckades genreuppslaget behåller vi de genrer vi redan har.
        genres     = CASE WHEN EXCLUDED.genres = '{}' THEN free_games.genres
                          ELSE EXCLUDED.genres END,
        rank       = EXCLUDED.rank,
        claim_url  = EXCLUDED.claim_url,
        fetched_at = now()
""")


def save(rows: list[dict]) -> int:
    """Sparar raderna och tar bort spel som inte längre finns med. Allt eller inget."""
    with engine.begin() as connection:
        connection.execute(UPSERT, rows)
        result = connection.execute(
            text("DELETE FROM free_games WHERE steam_app_id <> ALL(:keep)"),
            {"keep": [row["steam_app_id"] for row in rows]},
        )

    return result.rowcount


def main() -> None:
    print("Hämtar free to play-spel från Steam…")
    rows = collect()
    print(f"  {len(rows)} spel bekräftade")

    # Tom lista betyder att hämtningen gick fel. Rör då ingenting.
    if not rows:
        raise SystemExit("Inga spel hittades – databasen lämnas orörd.")

    removed = save(rows)
    if removed:
        print(f"  {removed} spel borttagna")

    print(f"Sparade {len(rows)} spel, varav {sum(1 for r in rows if r['genres'])} har genre.")


if __name__ == "__main__":
    main()
