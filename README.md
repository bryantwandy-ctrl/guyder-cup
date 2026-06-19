# The Guyder Cup

Live, self-report golf tournament tracker. Built for 16 players / 8v8 / 54 holes
(two best ball rounds + singles), Ryder Cup style match-play points, with shared
live scoring across everyone's phones.

## What you need (all free)

1. A Supabase account — supabase.com
2. A GitHub account — github.com
3. A Vercel account — vercel.com (sign up with GitHub)

## Step 1 — Create the Supabase project

1. Go to supabase.com → New Project. Name it anything (e.g. "guyder-cup").
2. Wait ~2 minutes for it to spin up.
3. In the left sidebar, go to **SQL Editor** → New Query, paste this, and run it:

```sql
create table tournament_kv (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

alter table tournament_kv enable row level security;

create policy "public read" on tournament_kv
  for select using (true);

create policy "public insert" on tournament_kv
  for insert with check (true);

create policy "public update" on tournament_kv
  for update using (true);
```

This creates one table that stores every round's scores and pairings as JSON,
and opens it up to read/write without login (fine for a private trip link —
nobody outside your group will have the URL).

4. Go to **Project Settings → API**. You'll need two values for Step 3:
   - **Project URL**
   - **anon public key**

## Step 2 — Push this project to GitHub

If you're comfortable with terminal commands, from inside this folder:

```bash
git init
git add .
git commit -m "Guyder Cup tracker"
gh repo create guyder-cup --public --source=. --push
```

(If you don't have the `gh` CLI, create a new empty repo on github.com called
`guyder-cup`, then run the `git remote add origin ...` and `git push` commands
GitHub shows you on that empty repo's page.)

No terminal? You can also create a new repo on github.com and use the
"upload files" button in the browser to drag this whole folder in.

## Step 3 — Deploy on Vercel

1. Go to vercel.com → **Add New Project**.
2. Import the `guyder-cup` GitHub repo.
3. Vercel auto-detects Vite — leave build settings as default.
4. Before clicking Deploy, open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` → your Project URL from Step 1
   - `VITE_SUPABASE_ANON_KEY` → your anon public key from Step 1
5. Click **Deploy**. In about a minute you'll get a live URL like
   `guyder-cup.vercel.app`.

Text that URL to the group. Everyone opens it on their phone, no login, no
app install.

## Local development (optional)

```bash
npm install
cp .env.example .env   # then fill in your real Supabase values
npm run dev
```

## How live scoring works

- Every score entered writes straight to the `tournament_kv` table in Supabase.
- Every device polls that table every 5 seconds and refreshes the leaderboard.
- Pairings (set by the captains the night before each round) live in the same
  table, so as soon as a captain sets them, everyone's app picks them up too.

## Changing rosters / format for next year

Open `src/App.jsx`:
- `defaultPlayers` — names, teams, course handicaps
- `defaultRounds` — round labels, format (`bestball`/`singles`), holes, course
- `TOURNAMENT_ID` — bump this (e.g. `guyder-cup-2027`) so next year's scores
  don't mix with this year's in the same Supabase table

Push the change to GitHub and Vercel redeploys automatically.
