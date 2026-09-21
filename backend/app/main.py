from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
import os

# Läser in inställningar från backend/.env. Full sökväg, så filen hittas oavsett vilken mapp servern startas från.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Databasadressen bor i .env och följer aldrig med upp till GitHub.
DATABASE_URL = os.getenv("DATABASE_URL")

# Säger ifrån vid start i stället för att krascha vid första besöket.
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set in backend/.env")

# Sköter all kontakt med databasen. pool_pre_ping kollar att kopplingen lever, eftersom databaser på nätet stänger oanvända kopplingar.
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

app = FastAPI(title="GameGrab API")

# Släpper igenom anrop från vår frontend. Byts mot riktig adress vid lansering.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Svarar på: lever servern, och når den databasen?
@app.get("/health")
def health():
    try:
        # SELECT 1 hämtar ingen riktig data – testar bara att kopplingen går fram.
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        # Kom inte fram till databasen. 503 = tjänsten är inte tillgänglig.
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "database": "disconnected",
                "detail": str(exc.__cause__ or exc),
            },
        )

    return {"status": "ok", "database": "connected"}
