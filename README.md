# GameGrab

GameGrab gathers free games and big discounts on PC games from several stores
and shows them in one place. It was built by Group 4 in the course
Agile Development.

Only real bargains are shown: games that are free right now, or at least 80% off.
Adult games, DLC, bundles and special editions are filtered out.

## Features

- **Offers from four stores:** Steam, GOG, Epic Games and Ubisoft, refreshed every hour.
- **Popular free-to-play games:** the 150 most played free games on Steam, plus a
  handful from Riot Games and Battle.net.
- **Tabs:** All, Free, Free for a limited time, and Discounted.
- **Search** with the three most recent searches remembered in the browser.
- **Filters:** store, genre and "ends within 1 or 7 days".
- **Countdown** on every card. Offers ending within 48 hours are highlighted,
  and within 24 hours they are marked as urgent.
- **Details window** with description, system requirements, Steam review score,
  price, time left, a link to the store and a "Copy link" button.
- **Steam review scores** on the cards, also for games sold on GOG or Epic.
- **Pagination**, 40 games per page.
- **Accounts:** sign up, log in, log out and reset a forgotten password.
- **Watchlist:** logged-in users can watch offers with the bell icon and see them
  under "My watchlist". Free-to-play games can't be watched, since they never
  stop being free.
- **Browser notifications:** after turning them on in the watchlist, the site
  shows a notification when a watched offer becomes free. It checks every
  5 minutes while the page is open.
- **Mobile:** on a phone, Steam links open in the Steam app if it's installed.

## Tech stack

| Part | Technology | Hosted on |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite | Vercel |
| Backend | Python, FastAPI, SQLAlchemy | Render |
| Database | PostgreSQL | Supabase |
| Accounts and watchlist | Supabase Auth and Supabase's API | Supabase |
| Data fetching | Python scripts on a schedule | GitHub Actions |
| Data sources | CheapShark, Steam, GOG, Epic Games | – |

## How it fits together

```text
             CheapShark, Steam, GOG, Epic
                        │
          fetch_offers.py (every hour)
          fetch_free_games.py (every day)
             run by GitHub Actions
                        │ writes
                        ▼
              PostgreSQL (Supabase) ◄──── accounts and watchlist
                        │ reads                    ▲
                        ▼                          │
               FastAPI backend (Render)            │
                        │ /offers, /free-games     │ supabase-js
                        ▼                          │
              React frontend (Vercel) ─────────────┘
```

The backend only reads. All writing to the offer tables is done by the fetch
scripts. Login and the watchlist go straight from the browser to Supabase, so
the backend is not involved in them.

## Project structure

```text
GameGrab/
├── .github/workflows/
│   ├── ci.yml                 # Lint, build and load checks on every PR
│   ├── fetch-offers.yml       # Runs fetch_offers.py every hour
│   └── fetch-free-games.yml   # Runs fetch_free_games.py every day
├── backend/
│   ├── app/
│   │   ├── main.py            # The FastAPI app and its endpoints
│   │   ├── fetch_offers.py    # Fetches offers from CheapShark, Steam, GOG and Epic
│   │   └── fetch_free_games.py# Fetches free-to-play games from Steam
│   ├── schema.sql             # Creates the tables (safe to re-run)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # The page: tabs, search, filters, cards, details, watchlist
│   │   ├── Account.tsx        # Log in, sign up, reset password
│   │   ├── api.ts             # Calls to the backend
│   │   ├── supabase.ts        # The Supabase client
│   │   ├── appLink.ts         # Opens Steam links in the Steam app on mobile
│   │   ├── types.ts           # The shapes of the data from the backend
│   │   └── index.css
│   ├── package.json
│   └── .env.example
├── Skol_filer/                # Course documents (team contract, experiment board)
└── README.md
```

## Running it locally

You need Python 3.10 or later (CI uses 3.13), Node.js 20.19 or later, and access to the
Supabase database.

### 1. Backend

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment. On Windows:

```bash
.venv\Scripts\activate
```

On macOS/Linux:

```bash
source .venv/bin/activate
```

Install the dependencies:

```bash
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and fill in `DATABASE_URL`
(see [Environment variables](#environment-variables)). If the database is new,
run `backend/schema.sql` in Supabase's SQL editor first.

Start the server:

```bash
uvicorn app.main:app --reload
```

The API runs on `http://localhost:8000`, and its interactive documentation is
on `http://localhost:8000/docs`.

### 2. Frontend

In a new terminal:

```bash
cd frontend
npm install
```

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the Supabase
values. The site works without them, but login and the watchlist are then
turned off.

```bash
npm run dev
```

The site runs on `http://localhost:5173`.

### 3. Filling the database (optional)

The database is filled by the scheduled jobs, but the scripts can be run by hand
from `backend/`:

```bash
python -m app.fetch_offers
```

```bash
python -m app.fetch_free_games
```

## Environment variables

`.env` and `.env.local` contain secrets and are never pushed. The `.env.example`
files are pushed, so never put real values in them.

**Backend** (`backend/.env` locally, Environment on Render):

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | – | Connection string from Supabase (Project Settings → Database) |
| `MIN_SAVINGS_PERCENT` | No | 80 | Smallest discount `/offers` returns. Free games are always shown. |
| `MAX_PER_SERIES` | No | 3 | Max number of near-identical titles from one series. 0 turns it off. |
| `CACHE_SECONDS` | No | 300 | How long `/offers` and `/free-games` are cached in memory. 0 turns it off. |

`fetch_offers.py` only collects deals of at least 80% off, so setting
`MIN_SAVINGS_PERCENT` below 80 shows nothing extra.

**Frontend** (`frontend/.env.local` locally, Environment Variables on Vercel):

| Variable | What it does |
| --- | --- |
| `VITE_API_URL` | The backend's address. Empty means `http://localhost:8000`. |
| `VITE_SUPABASE_URL` | The Supabase project's URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key (`sb_publishable_...`) |

The Supabase values are found under **Project Settings → API Keys**. They end up
in the visitor's browser and are not secret. The secret key (`sb_secret_...` or
`service_role`) must never be put in the frontend.

**GitHub** (Settings → Secrets and variables → Actions): the secret
`DATABASE_URL`, pointing to the same database as the backend. The fetch jobs
need it.

## API

| Endpoint | Description |
| --- | --- |
| `GET /health` | Checks that the server is up and can reach the database. Also answers `HEAD`, for uptime monitors. |
| `GET /offers` | All current offers, with what the cards need |
| `GET /offers/{id}` | Full description and system requirements for one offer, fetched when its details window opens |
| `GET /free-games` | Free-to-play games, most played first |
| `GET /free-games/{id}` | Description and system requirements for one free-to-play game |

If the database can't be reached, every endpoint answers `503` with
`"database": "disconnected"`, so the frontend shows an error instead of an empty
list. Answers are gzip-compressed.

`/offers` returns offers that are free or at least `MIN_SAVINGS_PERCENT` off and
haven't passed their end date. They are sorted with free games first, then by
discount, then by time left.

A healthy `/health` answers:

```json
{ "status": "ok", "database": "connected" }
```

## How offers are collected

`backend/app/fetch_offers.py` runs every hour through GitHub Actions
(GitHub often starts scheduled jobs late, sometimes by hours). Each run:

1. **Fetches deals from CheapShark.** It reads 8 pages of deals sorted by biggest
   discount, and remembers where it stopped in the `fetch_state` table so the
   next run continues from there. This keeps each run small enough that
   CheapShark doesn't block it. Every run also fetches all free deals and all
   Ubisoft deals.
2. **Filters out what isn't a game.** Titles with words like DLC, Edition,
   Bundle or Soundtrack are dropped. New deals are then looked up on Steam
   (or GOG's catalog if the game isn't on Steam), which says whether it's a
   real game, and gives genres, description and system requirements. At most
   190 new deals are looked up per run, to stay under Steam's rate limit.
   Deals that turn out not to be games are remembered in `skipped_deals`.
3. **Filters out adult games** using Steam's content descriptors, the 18+ age
   gate, and the title. Saved offers are re-checked every run.
4. **Looks up end dates** from each store: Steam's store API, Epic's promotions
   list, and the game page on GOG. Ubisoft doesn't provide one, so those show
   "End date unknown".
5. **Saves everything**, and updates Steam review scores for up to 50 games
   (each game at most once a day).
6. **Removes offers not seen for 48 hours.** A full pass over CheapShark's list
   takes several runs, so an offer is only treated as ended when nobody has seen
   it for two days. Offers whose end date has passed are hidden by `/offers`
   right away.

## Free-to-play games

`backend/app/fetch_free_games.py` runs once a day. It searches Steam for games
tagged Free to Play, confirms each one with Steam (a real game that is always
free and not adult), and saves the 150 most played in `free_games`, with image,
description and system requirements from Steam. Counter-Strike 2 is always
included, and a few games outside Steam (League of Legends, VALORANT,
Hearthstone and others) are added by hand in the script, with their own
descriptions and requirements.

They show up in the All and Free tabs, without a price or countdown. The store
and genre filters apply to them too.

## Accounts and watchlist

Accounts use Supabase Auth with email and password, straight from the
frontend (`frontend/src/supabase.ts` and `frontend/src/Account.tsx`). Visitors
can sign up, confirm their email, log in, log out and reset a forgotten
password. Everything except the watchlist works without an account.

The watchlist is stored in the table `watched_games` (`user_id`, `offer_id`,
`title`, unique on `user_id` + `offer_id`). The frontend reads and writes it
directly with the publishable key, so `backend/schema.sql` gives it Row Level
Security policies that only let a logged-in user see and change their own rows.
The title is saved too, so the watchlist can still show a game after its offer
has ended.

Notifications are browser notifications, not push: they only arrive while
GameGrab is open in a tab. The site remembers in the browser whether each
watched offer was free last time, and notifies when that changes to free.

The other tables (`offers`, `free_games`, `skipped_deals`, `fetch_state`) have
Row Level Security turned on with no policies (see `backend/schema.sql`), so the
publishable key can't read or change them. The backend and the fetch scripts
connect as the `postgres` role, which bypasses RLS.

Settings in the Supabase dashboard:

- **Authentication → URL Configuration:** Site URL is the Vercel address. Add
  `http://localhost:5173` under Redirect URLs, or the email links won't work
  locally.
- **Authentication → Sign In / Providers → Email:** keep "Confirm email" on.
- **Authentication → Policies:** minimum password length 8, the same as the form.

Supabase's built-in email sender only allows a few emails per hour and is meant
for testing. For real use, set up your own SMTP under **Authentication → Emails**.

## Deployment

- **Frontend on Vercel:** root directory `frontend`, build command
  `npm run build`, output `dist`. Set the three `VITE_` variables.
- **Backend on Render:** a web service with root directory `backend`, build command
  `pip install -r requirements.txt`, start command
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `DATABASE_URL`.
  On Render's free plan the server sleeps when idle, so the first visit can take
  up to a minute. The page says so while it waits.
- **Database on Supabase:** run `backend/schema.sql` once in the SQL editor.

The backend only accepts requests from `http://localhost:5173` and
`https://gamegrab.vercel.app` (CORS). If the frontend moves, add the new address
to `allow_origins` in `backend/app/main.py`.

## Checks (CI)

`.github/workflows/ci.yml` runs on every pull request against `main` and every
push to `main`:

- **Frontend:** `npm ci`, lint with `oxlint`, and `npm run build`, which also
  type-checks with TypeScript.
- **Backend:** installs the dependencies, checks the syntax, and checks that the
  app and fetch scripts load.

## Workflow

The team worked in sprints with a Jira board. Each task got a branch named after
its ticket (for example `fix/SCRUM-64-filter-scroll`), was merged to `main`
through a pull request, and had to pass CI first.
