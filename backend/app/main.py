from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
import os

# Loads settings from backend/.env. Full path, so the file is found regardless of which folder the server is started from.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# The database address lives in .env and is never pushed to GitHub.
DATABASE_URL = os.getenv("DATABASE_URL")

# Complains at startup instead of crashing on the first visit.
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in backend/.env")

# Offers are fetched every 3 hours (see .github/workflows/fetch-offers.yml).
# If a row stays longer than that, the fetch has probably stopped running, and
# the offer may already have expired at the store – better to hide it than show
# something that may no longer be true.
STALE_AFTER_HOURS = float(os.getenv("STALE_AFTER_HOURS", "6"))

# GameGrab only shows real bargains: free games and at least 80% off.
# Smaller discounts stay in the database but are never returned.
MIN_SAVINGS_PERCENT = float(os.getenv("MIN_SAVINGS_PERCENT", "80"))

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


# Answers: is the server alive, and can it reach the database?
@app.get("/health")
def health():
    try:
        # SELECT 1 fetches no real data – it only tests that the connection works.
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        # Couldn't reach the database. 503 = service unavailable.
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": "disconnected",
                "detail": str(exc.__cause__ or exc),
            },
        )

    return {"status": "ok", "database": "connected"}


# The offers the frontend renders: fresh, not expired, and either free or at least 80 percent off.
# Free first, then biggest discount – the most tempting at the top.
@app.get("/offers")
def offers():
    try:
        with engine.connect() as connection:
            rows = connection.execute(
                text("""
                    SELECT id, title, store, normal_price, sale_price, savings,
                           is_free, thumb, steam_app_id, claim_url, genres, ends_at, fetched_at
                    FROM offers
                    WHERE fetched_at > now() - (:stale_after_hours * interval '1 hour')
                      AND (is_free OR savings >= :min_savings)
                      AND (ends_at IS NULL OR ends_at > now())
                    ORDER BY is_free DESC, savings DESC
                """),
                {
                    "stale_after_hours": STALE_AFTER_HOURS,
                    "min_savings": MIN_SAVINGS_PERCENT,
                },
            ).mappings().all()
    except SQLAlchemyError as exc:
        # Same error handling as /health: if we couldn't reach the database
        # we say so plainly instead of responding with an empty list,
        # which the frontend would read as "there are no offers".
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": "disconnected",
                "detail": str(exc.__cause__ or exc),
            },
        )

    # Postgres returns price and discount as Decimal, and the timestamp as a
    # date object. None of that can be sent as JSON, so we convert them here.
    return [
        {
            **dict(row),
            "normal_price": float(row["normal_price"]),
            "sale_price": float(row["sale_price"]),
            "savings": float(row["savings"]),
            "fetched_at": row["fetched_at"].isoformat(),
            # None when the store doesn't provide an end date.
            "ends_at": row["ends_at"].isoformat() if row["ends_at"] else None,
        }
        for row in rows
    ]


# Games that are always free (free to play), most played first. Fetched by
# fetch_free_games.py once a day. No freshness check like in /offers:
# a free to play game doesn't stop being free overnight.
@app.get("/free-games")
def free_games():
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
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": "disconnected",
                "detail": str(exc.__cause__ or exc),
            },
        )

    return [dict(row) for row in rows]
