# JARVIS.

Your apps in one conversation. Ask about anything you've logged, or tell Jarvis what you did and it logs it to the right app: BODY, MONEY, GYM, MEAL, WRITE, READ and SLEEP, plus the goals and weekly reviews in YOU. Same login as every other app.

- **Ask:** "How did I sleep this week?", "What did I spend on food this month?", "Did I train less on short nights?", "Am I on pace for my goals?" Jarvis reads the apps a question needs and answers with your real numbers.
- **Log:** "158.4 this morning", "spent 12 at Chipotle", "chicken bowl for lunch", "bench 3x8 at 135", "30 minutes on the treadmill, 3 miles", "read 20 pages", "today was an 8, great gym session". Each one lands in that app's own table, so it shows everywhere, the watch included. Jarvis tags what it logged under its answer.
- **Voice:** the mic button (where the browser supports it) or your keyboard's dictation, and the speaker button reads answers out loud.

Jarvis can't delete or change what's already logged; it tells you which app to do that in. It follows YOU's settings (time zone, when your day ends, units, theme).

## Set up (about 5 minutes)

1. **Supabase.** Run [jarvis.sql](jarvis.sql) once (it keeps the conversation with your account).
2. **Vercel.** Import this repository: Framework preset **Other**, no build command.
3. **Environment variables:** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (same as every app), `ANTHROPIC_API_KEY`, and `URL_HOME` (YOU's address, for the home and settings buttons).
4. **Deploy**, open it on your iPhone, Share → **Add to Home Screen**.

## How it works

`api/jarvis.mjs` is a Vercel function. It checks your sign-in, reads your settings and the last few messages, and runs Claude with a set of tools: `read_app_data` for each app, and `log_weight`, `log_expense`, `log_meal`, `rate_day`, `log_pages`, `log_cardio` and `log_sets`. Every tool calls Supabase with your own sign-in, so row security keeps it to your data. Tool inputs are checked before anything is written.

- `index.html`, `jarvis.js` — the chat
- `api/jarvis.mjs` — Jarvis and its tools
- `lib/notion.mjs` — the Notion tools
- `api/config.js` — the public Supabase settings and YOU's address
- `settings.js` — YOU's settings, shared by every app
- `jarvis.sql` — the `jarvis_messages` table

## Notion

Jarvis can search your Notion, read pages and databases, create pages (under a page, or as a new entry in a database with its columns filled in) and add to the end of a page. It never deletes, archives or changes what's already there, and it only sees the pages you share with it.

1. In Notion: **Settings → Connections → Develop or manage integrations** (or notion.so/profile/integrations) → **New integration**. Name it **Jarvis**, pick your workspace, type **Internal**, save.
2. Copy its **Internal Integration Secret** (starts with `ntn_`).
3. Give it your pages: on the integration's **Access** tab, pick the pages Jarvis may use (sub-pages come with them). Or on any page: **•••** → **Connections** → **Jarvis**.
4. In Vercel, add `NOTION_TOKEN` with that secret to the jarvis project and redeploy.

Then try "What's in my Project Planner?" or "Make a page for Sarah's 12-week program under Second Brain". The code is in `lib/notion.mjs`.

Next: Google Calendar (read your schedule, add events).
