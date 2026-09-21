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
