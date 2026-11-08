# JARVIS.

A command center for your Mac, and your apps in one conversation. Ask about anything you've logged, or tell Jarvis what you did and it logs it to the right app: BODY, MONEY, GYM, MEAL, WRITE, READ and SLEEP, plus the goals and weekly reviews in YOU. Same login as every other app.

- **Ask:** "How did I sleep this week?", "What did I spend on food this month?", "Did I train less on short nights?", "Am I on pace for my goals?" Jarvis reads the apps a question needs and answers with your real numbers.
- **Log:** "158.4 this morning", "spent 12 at Chipotle", "chicken bowl for lunch", "bench 3x8 at 135", "30 minutes on the treadmill, 3 miles", "read 20 pages", "today was an 8, great gym session". Each one lands in that app's own table, so it shows everywhere, the watch included. Jarvis tags what it logged under its answer.
- **Voice:** the mic button (where the browser supports it) or your keyboard's dictation, and the speaker button reads answers out loud.

Jarvis can't delete or change what's already logged; it tells you which app to do that in. It follows YOU's settings (time zone, when your day ends, units, theme).

## The command center (made for the Mac)

One screen, no scrolling at 1440×900 and up:

- **Systems**: Claude, Jarvis's memory, voice, your seven apps, Notion and Google Calendar, each live or not.
- **The core**: turns while Jarvis is standing by, speeds up while it thinks, pulses while it listens or speaks.
- **Live feed**: your next event, apps not logged yet, a streak about to end, subscriptions renewing soon, last night's sleep, a weekly review that's ready. Click one to ask Jarvis about it.
- **Your apps**: today's number for each app, whether it's logged, and a 7-day line. Click one to ask about it.
- **Today's schedule**: today's Google Calendar events with Done, Now or In 42m.
- **Today**: rings for apps logged, calories against your goal, and sleep against your goal.
- **Memory**: messages, things Jarvis logged and days you talked, with a 14-day constellation.
- **Streaks**: days in a row for each app, and your best.
- **Bottom bar**: location (your time zone), the weather (Open-Meteo, only after you click it and allow your location), network, **Talk to Jarvis** and **Executive briefing**.

The conversation slides in from the right. **⌘K** asks, **⌘J** talks (Safari or Chrome; allow the microphone once), **Esc** closes. Answers are read aloud; the speaker button in the conversation turns that off. **Focus mode** leaves just the core.

**The voice** is British: Jarvis uses the best UK English male voice your Mac has, Chrome's "Google UK English Male" first, then macOS's Daniel, spoken a little slower and lower than normal. Pick another from the voice menu in the conversation panel. For the most natural Daniel, download his better version: **System Settings → Accessibility → Spoken Content → System voice → Manage Voices… → English (United Kingdom) → Daniel (Enhanced or Premium)**, then reload Jarvis.

**Install it on the Mac:** in Safari, open your Jarvis address, then **File → Add to Dock** (macOS Sonoma or later). In Chrome: **⋮ → Cast, save and share → Install page as app**. It opens in its own window like an app. On a phone the panels stack and everything still works.

## Set up (about 5 minutes)

1. **Supabase.** Run [jarvis.sql](jarvis.sql) once (it keeps the conversation with your account).
2. **Vercel.** Import this repository: Framework preset **Other**, no build command.
3. **Environment variables:** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (same as every app), `ANTHROPIC_API_KEY`, and `URL_HOME` (YOU's address, for the home and settings buttons).
4. **Deploy**, open it on your iPhone, Share → **Add to Home Screen**.

## How it works

`api/jarvis.mjs` is a Vercel function. It checks your sign-in, reads your settings and the last few messages, and runs Claude with a set of tools: `read_app_data` for each app, and `log_weight`, `log_expense`, `log_meal`, `rate_day`, `log_pages`, `log_cardio` and `log_sets`. Every tool calls Supabase with your own sign-in, so row security keeps it to your data. Tool inputs are checked before anything is written.

- `index.html` — the command center
- `jarvis.js` — sign-in, the conversation, voice and shortcuts
- `dashboard.js` — the panels, the core, the clock and the bottom bar
- `api/today.mjs` — which services are connected, and today's calendar
- `lib/core.mjs` — Supabase as you, and your day from YOU's settings
- `api/jarvis.mjs` — Jarvis and its tools
- `lib/notion.mjs` — the Notion tools
- `lib/gcal.mjs` — the Google Calendar tools
- `api/config.js` — the public Supabase settings and YOU's address
- `settings.js` — YOU's settings, shared by every app
- `jarvis.sql` — the `jarvis_messages` table

## Notion

Jarvis can search your Notion, read pages and databases, create pages (under a page, or as a new entry in a database with its columns filled in) and add to a page, at the end or right after a given line. It can also edit: rename a page, update a database entry's columns ("mark Run a 5k as Done", "push it to April"), tick or untick a to-do, and change the text of a line ("make Phase 1 four sets of 8"). It reads the page first, changes only what you asked and tells you exactly what changed, before and after. It never deletes or archives anything, and it only sees the pages you share with it. Notion's page history can undo any edit.

1. In Notion: **Settings → Connections → Develop or manage integrations** (or notion.so/profile/integrations) → **New integration**. Name it **Jarvis**, pick your workspace, type **Internal**, save.
2. Copy its **Internal Integration Secret** (starts with `ntn_`).
3. Give it your pages: on the integration's **Access** tab, pick the pages Jarvis may use (sub-pages come with them). Or on any page: **•••** → **Connections** → **Jarvis**.
4. In Vercel, add `NOTION_TOKEN` with that secret to the jarvis project and redeploy.

Then try "What's in my Project Planner?" or "Make a page for Sarah's 12-week program under Second Brain". The code is in `lib/notion.mjs`.

## Google Calendar

Jarvis reads your schedule ("what's on tomorrow?", "when am I free Thursday afternoon?", "when's my dentist appointment?") and adds events ("put leg day at 6pm Friday", "block Saturday morning for meal prep"), in your time zone from YOU's settings. It can also move or change events ("move leg day to 7pm", "push the dentist to next Tuesday", "make it 90 minutes"), keeping their length unless you say otherwise, and delete them. Deleting takes two messages: Jarvis says which event it found and asks, and the server only deletes an event it proposed in its previous reply, after you've said yes. For a repeating event, a move or delete affects only that occurrence. Deleted events can be restored from Google Calendar's Bin for 30 days. Add your Google account to your iPhone (**Settings → Calendar → Accounts → Add Account → Google**, Calendars on) and the events show in Apple Calendar too.

It signs in as a Google *service account* that you share your calendar with, so it keeps working without signing in again:

1. **Google Cloud project:** at console.cloud.google.com, create a project (e.g. "Jarvis").
2. **Turn on the API:** **APIs & Services → Library → Google Calendar API → Enable**.
3. **Service account:** **IAM & Admin → Service Accounts → Create service account**, name it `jarvis`, skip the optional steps. Open it → **Keys → Add key → Create new key → JSON**. A `.json` file downloads; keep it private.
4. **Share your calendar with it:** in Google Calendar on the web, **Settings → (your calendar) → Share with specific people → Add people**, paste the service account's email (`jarvis@…iam.gserviceaccount.com`, also in the JSON as `client_email`), permission **Make changes to events**.
5. **Vercel** (jarvis project → Settings → Environment Variables): `GOOGLE_SERVICE_ACCOUNT` = the whole contents of the JSON file; `GOOGLE_CALENDAR_ID` = your Gmail address (your main calendar's id; several ids, comma-separated, are all read, and events go to the first). Redeploy.

The code is in `lib/gcal.mjs`.
