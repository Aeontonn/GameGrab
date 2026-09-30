# GameGrab

GameGrab är ett projekt som vi arbetar på inom kursen Agil utveckling.

Målet är att skapa en webbplats som samlar information om gratis spel och
tidsbegränsade gratiserbjudanden från olika spelplattformar på ett och samma ställe.

## MVP

Den första versionen av GameGrab ska göra det möjligt att:

- Se aktuella gratiserbjudanden på spel
- Se grundläggande information om spelen
- Se vilken plattform erbjudandet finns på
- Se hur länge erbjudandet gäller
- Gå vidare till plattformen där spelet kan hämtas
- Filtrera mellan olika plattformar

## Tech stack

**Frontend**
- React
- TypeScript
- Vite

**Backend**
- Python
- FastAPI
- SQLAlchemy

**Databas**
- PostgreSQL via Supabase

**Deployment**
- Frontend: Vercel
- Backend: Render
- Databas: Supabase

**Versionshantering**
- Git och GitHub

## Projektstruktur

GameGrab/
├── Skol_filer/    # Kursrelaterad dokumentation
├── backend/       # FastAPI och kontakt med databasen
├── frontend/      # React-applikationen
└── README.md

## Lokal utveckling

### Backend

Gå till backend:

```bash
cd backend

```

Skapa en virtuell Python-miljö:

```bash
python -m venv .venv
```

Aktivera den virtuella miljön.

På Windows:

```bash
.venv\Scripts\activate
```

Installera backendens dependencies:

```bash
pip install -r requirements.txt
```

### Miljövariabler

Backend behöver en anslutning till PostgreSQL-databasen i Supabase.

Skapa filen `.env` i `backend/` och använd `.env.example` som mall:

```env
DATABASE_URL=
```

Lägg in databasens connection string efter `DATABASE_URL=`.

`.env` innehåller känslig information och ska inte laddas upp till GitHub.

Starta backend:

```bash
uvicorn app.main:app --reload
```

Backend körs då lokalt på:

```text
http://localhost:8000
```

FastAPI:s automatiska API-dokumentation finns på:

```text
http://localhost:8000/docs
```

### Frontend

Öppna en ny terminal och gå till frontend-mappen:

```bash
cd frontend
```

Installera dependencies:

```bash
npm install
```

Starta frontend:

```bash
npm run dev
```

Frontend körs normalt på:

```text
http://localhost:5173
```

## Kommunikation mellan frontend och backend

Frontend kommunicerar med FastAPI-backenden genom API-anrop.

Backend har för närvarande endpointen:

```text
GET /health
```

Den används för att kontrollera att FastAPI-servern fungerar och att den kan ansluta till PostgreSQL-databasen.

Om både backend och databas fungerar returneras:

```json
{
  "status": "ok",
  "database": "connected"
}
```

Frontend anropar `/health` när sidan laddas och visar om anslutningen fungerar.

Frontend kan visa tre olika lägen:

- Kontrollerar anslutningen
- Ansluten till backend och databas
- Anslutningsfel

Backend-adressen bestäms genom miljövariabeln:

```text
VITE_API_URL
```

Om ingen adress har angetts används den lokala backend-servern:

```text
http://localhost:8000
```

Det gör att samma frontendkod kan användas både lokalt och när projektet senare deployas.

## Deployment

Projektet kommer att använda följande struktur:

```text
Frontend (React + TypeScript + Vite)
                ↓
              Vercel
                ↓
        Backend (FastAPI)
                ↓
              Render
                ↓
      PostgreSQL / Supabase
```

Frontend deployas på Vercel och backend deployas separat på Render.

När frontend är deployad kommer `VITE_API_URL` att peka på den publicerade FastAPI-servern på Render.

Backend behöver `DATABASE_URL` som miljövariabel på Render för att kunna ansluta till databasen i Supabase.

## Uppdatering av erbjudanden

`backend/app/fetch_offers.py` hämtar erbjudanden från CheapShark och sparar dem i databasen. Skriptet körs automatiskt varje timme av GitHub Actions-jobbet `.github/workflows/fetch-offers.yml` (kan också startas manuellt därifrån).

För att jobbet ska kunna nå databasen behöver repots hemlighet `DATABASE_URL` finnas under **Settings → Secrets and variables → Actions** i GitHub och peka på samma databas som backend använder.

`/offers`-endpointen döljer erbjudanden som är äldre än `STALE_AFTER_HOURS` timmar (standard 6) så att ett missat schemalagt jobb inte visar erbjudanden som kan ha gått ut hos butiken.

Den visar dessutom bara gratisspel och erbjudanden med minst `MIN_SAVINGS_PERCENT` procent rabatt (standard 80). Mindre rabatter sparas i databasen men lämnas inte ut.

## Populära gratisspel

Spel som alltid är gratis (free to play) hanteras separat från erbjudandena, eftersom CheapShark inte listar dem. `backend/app/fetch_free_games.py` söker på Steam efter free to play-spel, bekräftar varje kandidat med Steams `appdetails` (riktigt spel och `is_free`) och sparar de 150 populäraste i tabellen `free_games`. Jobbet `.github/workflows/fetch-free-games.yml` kör det en gång per dygn och kan även startas manuellt.

Listan lämnas ut av `GET /free-games`, populärast först. Den har ingen färskhetskoll som `/offers`, eftersom ett free to play-spel inte slutar vara gratis över en natt. Frontend visar den som en mindre sektion, "Populära gratisspel", under erbjudandena. Genrefiltret gäller båda sektionerna, butiksfiltret bara erbjudandena.

Tabellen skapas av `backend/schema.sql`, som kan köras om utan att skriva över data. Manuell körning:

```bash
cd backend
python -m app.fetch_free_games
```

## CORS

Under lokal utveckling tillåter backend anrop från:

```text
http://localhost:5173
```

När frontend deployas till Vercel behöver även den publicerade Vercel-adressen läggas till som tillåten adress i backend.

## Projektstatus

Projektet är under utveckling.

För närvarande finns:

- React + TypeScript + Vite frontend
- FastAPI-backend
- PostgreSQL-anslutning via SQLAlchemy
- Supabase som databas
- `/health` endpoint för att kontrollera backend och databas
- Frontend som kontrollerar anslutningen till backend
- Stöd för olika backend-adresser genom `VITE_API_URL`
