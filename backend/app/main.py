from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
import os
import re
import time

# Loads settings from backend/.env. Full path, so the file is found regardless of which folder the server is started from.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# The database address lives in .env and is never pushed to GitHub.
DATABASE_URL = os.getenv("DATABASE_URL")

# Complains at startup instead of crashing on the first visit.
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in backend/.env")

# GameGrab only shows real bargains: free games and at least 80% off.
# Smaller discounts stay in the database but are never returned.
MIN_SAVINGS_PERCENT = float(os.getenv("MIN_SAVINGS_PERCENT", "80"))

# Cap on near-identical titles ("3D Puzzle: Cats", "3D Puzzle: Dogs"…) so one
# series can't flood the page. Offers come biggest-discount first, so the best
# ones of each series are the ones kept. 0 turns the cap off.
MAX_PER_SERIES = int(os.getenv("MAX_PER_SERIES", "3"))

# How long /offers and /free-games keep their answer in memory. The tables only
# change when the fetch scripts run, so there's no need to ask the database on
# every visit. 0 turns the cache off.
CACHE_SECONDS = int(os.getenv("CACHE_SECONDS", "300"))

# Handles all contact with the database. pool_pre_ping checks that the connection is alive, since hosted databases close idle connections.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

app = FastAPI(title="GameGrab API")

# Lets requests from our frontend through. Replace with the real address at launch.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://gamegrab.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compresses the answers. /offers is mostly repeated text, so it shrinks to
# about a fifth of its size, which is what makes the page load fast on mobile.
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Answers kept in memory, by endpoint: (time it was saved, the answer).
_cache: dict[str, tuple[float, list]] = {}


def cached(key: str) -> list | None:
    """The saved answer for `key`, or None if there is none or it's too old."""
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    return None


def save(key: str, answer: list) -> list:
    _cache[key] = (time.monotonic(), answer)
    return answer


def database_error(exc: SQLAlchemyError) -> JSONResponse:
    # If we couldn't reach the database we say so plainly instead of responding
    # with an empty list, which the frontend would read as "there are no offers".
    return JSONResponse(
        status_code=503,
        content={
            "status": "error",
            "database": "disconnected",
            "detail": str(exc.__cause__ or exc),
        },
    )


# Answers: is the server alive, and can it reach the database?
@app.get("/health")
def health():
    try:
        # SELECT 1 fetches no real data – it only tests that the connection works.
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        # Couldn't reach the database. 503 = service unavailable.
        return database_error(exc)

    return {"status": "ok", "database": "connected"}


_FILLER = {"the", "a", "an", "of", "and", "game", "games", "edition", "collection", "pack", "bundle", "deluxe"}


def series_keys(title: str) -> set[str]:
    """Word pairs in the title, ignoring numbers and filler like "the".

    "3D Puzzle: Cats" and "Cute Cats 3D Puzzle" both contain "3d puzzle", so
    they count as the same series, while "The Witcher 3" and "The Sims" share
    nothing. A one-word title is its own key.
    """
    words = [
        w for w in re.findall(r"[a-z0-9']+", title.lower())
        if w not in _FILLER and (not w.isdigit())
    ]
    if len(words) < 2:
        return set(words)
    return {f"{a} {b}" for a, b in zip(words, words[1:])}


def limit_series(rows: list, cap: int) -> list:
    """Keeps the first `cap` offers per series, preserving the order."""
    if cap <= 0:
        return rows
    seen: dict[str, int] = {}
    kept = []
    for row in rows:
        keys = series_keys(row["title"])
        if any(seen.get(k, 0) >= cap for k in keys):
            continue
        for k in keys:
            seen[k] = seen.get(k, 0) + 1
        kept.append(row)
    return kept


# The offers the frontend renders: not expired, and either free or at least 80 percent off.
# Biggest discount first, free games at the top. Offers with the same discount
# as the card shows it (rounded to a whole percent) are ordered by time left, so
# the ones about to expire come first. Offers where the store doesn't say when
# they end go last within their discount.
#
# Only what the cards need. The full description and system requirements are
# almost half the text but only show in the details window, so /offers/{id}
# sends them when someone opens a game. The cards get the first sentence.
#
# No freshness check on fetched_at: fetch_offers.py removes offers that haven't
# been seen for 12 hours, so the table holds the latest offers it could get.
# If the fetch is delayed (GitHub often runs it hours late) we keep showing
# that snapshot instead of an empty page.
@app.get("/offers")
def offers():
    if (answer := cached("offers")) is not None:
        return answer

    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("""
                    SELECT id, title, store, normal_price, sale_price, savings,
                        is_free, thumb, steam_app_id, claim_url, genres, description, launcher_notice,
                        review_positive_percent, review_total, review_source, ends_at
                    FROM offers
                    WHERE (is_free OR savings >= :min_savings)
                      AND (ends_at IS NULL OR ends_at > now())
                    ORDER BY is_free DESC, ROUND(savings) DESC, ends_at ASC NULLS LAST, savings DESC
                """),
                {"min_savings": MIN_SAVINGS_PERCENT},
            ).mappings().all()
    except SQLAlchemyError as exc:
        return database_error(exc)

    # Postgres returns price and discount as Decimal, and the timestamp as a
    # date object. None of that can be sent as JSON, so we convert them here.
    return save("offers", [
        {
            **{key: value for key, value in row.items() if key != "description"},
            "short_description": short_description(row["description"]),
            "normal_price": float(row["normal_price"]),
            "sale_price": float(row["sale_price"]),
            "savings": float(row["savings"]),
            "review_positive_percent": (
                float(row["review_positive_percent"])
                if row["review_positive_percent"] is not None
                else None
            ),
            # None when the store doesn't provide an end date.
            "ends_at": row["ends_at"].isoformat() if row["ends_at"] else None,
        }
        for row in limit_series(rows, MAX_PER_SERIES)
    ])


def short_description(description: str | None) -> str | None:
    """The first sentence of the description, shown on the card."""
    if not description:
        return None
    return description.split(".")[0].strip() + "."


# The longer texts for one offer, fetched when its details window opens.
@app.get("/offers/{offer_id}")
def offer_details(offer_id: int):
    try:
        with engine.connect() as connection:
            row = connection.execute(
                text("""
                    SELECT description, minimum_requirements, recommended_requirements
                    FROM offers
                    WHERE id = :id
                """),
                {"id": offer_id},
            ).mappings().first()
    except SQLAlchemyError as exc:
        return database_error(exc)

    # The offer can disappear if the fetch script removed it after the page loaded.
    if row is None:
        return JSONResponse(status_code=404, content={"detail": "Offer not found"})

    return dict(row)


# Games that are always free (free to play), most played first. Fetched by
# fetch_free_games.py once a day. No freshness check like in /offers:
# a free to play game doesn't stop being free overnight.
@app.get("/free-games")
def free_games():
    if (answer := cached("free-games")) is not None:
        return answer

    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("""
                    SELECT id, title, steam_app_id, claim_url, genres
                    FROM free_games
                    ORDER BY rank
                """)
            ).mappings().all()
    except SQLAlchemyError as exc:
        return database_error(exc)

    return save("free-games", [dict(row) for row in rows])
