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
- `api/config.js` — the public Supabase settings and YOU's address
- `settings.js` — YOU's settings, shared by every app
- `jarvis.sql` — the `jarvis_messages` table

Next: Notion (search, read and create pages) and Google Calendar (read your schedule, add events).
