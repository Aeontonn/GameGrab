# GameGrab

GameGrab is a project we are working on in the course Agile Development.

The goal is to build a website that gathers information about free games and
time-limited free offers from different gaming platforms in one place.

## MVP

The first version of GameGrab should make it possible to:

- See current free offers on games
- See basic information about the games
- See which platform the offer is on
- See how long the offer lasts
- Go to the platform where the game can be claimed
- Filter between different platforms

## Tech stack

**Frontend**
- React
- TypeScript
- Vite

**Backend**
- Python
- FastAPI
- SQLAlchemy

**Database**
- PostgreSQL via Supabase

**Deployment**
- Frontend: Vercel
- Backend: Render
- Database: Supabase

**Version control**
- Git and GitHub

## Project structure

GameGrab/
├── Skol_filer/    # Course-related documentation
├── backend/       # FastAPI and database access
├── frontend/      # The React application
└── README.md

## Local development

### Backend

Go to the backend:

```bash
cd backend

```

Create a Python virtual environment:

```bash
python -m venv .venv
```

Activate the virtual environment.

On Windows:

```bash
.venv\Scripts\activate
```

Install the backend dependencies:

```bash
pip install -r requirements.txt
```

### Environment variables

The backend needs a connection to the PostgreSQL database in Supabase.

Create the file `.env` in `backend/` and use `.env.example` as a template:

```env
DATABASE_URL=
```

Put the database connection string after `DATABASE_URL=`.

`.env` contains sensitive information and must not be pushed to GitHub.

Start the backend:

```bash
uvicorn app.main:app --reload
```

The backend then runs locally on:

```text
http://localhost:8000
```

FastAPI's automatic API documentation is available at:

```text
http://localhost:8000/docs
```

### Frontend

Open a new terminal and go to the frontend folder:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the frontend:

```bash
npm run dev
```

The frontend normally runs on:

```text
http://localhost:5173
```

## Communication between frontend and backend

The frontend communicates with the FastAPI backend through API requests.

The backend currently has the endpoint:

```text
GET /health
```

It is used to check that the FastAPI server works and that it can connect to the PostgreSQL database.

If both the backend and the database work, it returns:

```json
{
  "status": "ok",
  "database": "connected"
}
```

The frontend calls `/health` when the page loads and shows whether the connection works.

The frontend can show three different states:

- Checking the connection
- Connected to backend and database
- Connection error

The backend address is set through the environment variable:

```text
VITE_API_URL
```

If no address has been set, the local backend server is used:

```text
http://localhost:8000
```

This lets the same frontend code be used both locally and when the project is deployed later.

## Deployment

The project will use the following structure:

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

The frontend is deployed on Vercel and the backend is deployed separately on Render.

Once the frontend is deployed, `VITE_API_URL` will point to the published FastAPI server on Render.

The backend needs `DATABASE_URL` as an environment variable on Render to be able to connect to the database in Supabase.

## Updating offers

`backend/app/fetch_offers.py` fetches offers from CheapShark and saves them to the database. The script runs automatically every hour via the GitHub Actions job `.github/workflows/fetch-offers.yml` (it can also be started manually from there).

For the job to reach the database, the repo secret `DATABASE_URL` must exist under **Settings → Secrets and variables → Actions** on GitHub and point to the same database the backend uses.

Each run removes offers that are no longer listed on CheapShark, so the database always holds the result of the latest successful fetch. `/offers` shows that snapshot even if a scheduled run is delayed, and hides offers whose end date has passed.

It also only shows free games and offers with at least `MIN_SAVINGS_PERCENT` percent off (default 80). Smaller discounts are saved in the database but not returned.

## Popular free games

Games that are always free (free to play) are handled separately from the offers, since CheapShark doesn't list them. `backend/app/fetch_free_games.py` searches Steam for free to play games, confirms each candidate with Steam's `appdetails` (a real game and `is_free`) and saves the 150 most popular in the `free_games` table. The job `.github/workflows/fetch-free-games.yml` runs it once a day and can also be started manually.

The list is returned by `GET /free-games`, most popular first. It has no freshness check like `/offers`, since a free to play game doesn't stop being free overnight. The frontend shows it as a smaller section, "Popular free games", below the offers. The genre filter applies to both sections, the store filter only to the offers.

The table is created by `backend/schema.sql`, which can be re-run without overwriting data. Manual run:

```bash
cd backend
python -m app.fetch_free_games
```

## Accounts and login

Visitors can create an account and log in with email and password. It's handled
by Supabase Auth straight from the frontend (`frontend/src/supabase.ts` and
`frontend/src/Account.tsx`), so the backend isn't involved yet. Everything else
on the site works without an account.

The frontend needs two environment variables. Locally they go in
`frontend/.env.local` (use `frontend/.env.example` as a template), and on Vercel
under Environment Variables:

```env
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both are found in Supabase under **Project Settings → API Keys**. They are not
secret, since they end up in the visitor's browser. The secret key
(`sb_secret_...` / `service_role`) must never be put in the frontend.

The tables are protected by Row Level Security (see `backend/schema.sql`), so
the publishable key can't be used to read or change them.

Settings in the Supabase dashboard:

- **Authentication → URL Configuration:** Site URL is the Vercel address.
  Add `http://localhost:5173` under Redirect URLs, otherwise the link in the
  confirmation email doesn't work locally.
- **Authentication → Sign In / Providers → Email:** keep "Confirm email" on.
- **Authentication → Policies (password):** minimum length 8, the same as the form.

Supabase's built-in email sender only sends a few emails per hour and is meant
for testing. Before launch, set up your own SMTP under **Authentication → Emails**.

## CORS

During local development the backend allows requests from:

```text
http://localhost:5173
```

When the frontend is deployed to Vercel, the published Vercel address also needs to be added as an allowed origin in the backend.

## Project status

The project is under development.

Currently in place:

- React + TypeScript + Vite frontend
- FastAPI backend
- PostgreSQL connection via SQLAlchemy
- Supabase as the database
- `/health` endpoint to check the backend and database
- Frontend that checks the connection to the backend
- Support for different backend addresses through `VITE_API_URL`
