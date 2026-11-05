// JARVIS. One message in, one answer out: Claude reads your apps and logs to them through the tools below,
// as you. Every read and write goes to Supabase with your own sign-in, so row security keeps it to your data.
// Runs on Vercel so the API key never reaches the browser. Nothing here deletes or edits what's already there.
import Anthropic from '@anthropic-ai/sdk';
import { NOTION_TOOLS, notionOn, runNotion } from '../lib/notion.mjs';
import { CALENDAR_TOOLS, calendarOn, runCalendar } from '../lib/gcal.mjs';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
const MAX_STEPS = 8;      // tool rounds per message
const HISTORY = 24;       // earlier messages Jarvis remembers

// ---- Supabase, as the signed-in person ----
function db(token) {
  const headers = { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const call = async (method, path, body, prefer) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...headers, ...(prefer ? { prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); const data = text ? JSON.parse(text) : null;
    if (!r.ok) { const e = new Error(data?.message || `Supabase ${r.status}`); e.code = data?.code; throw e; }
    return data;
  };
  return {
    get: path => call('GET', path),
    insert: (table, row) => call('POST', table, row, 'return=representation'),
    upsert: (table, row, onConflict) => call('POST', `${table}?on_conflict=${onConflict}`, row, 'resolution=merge-duplicates,return=representation'),
  };
}
async function signedInUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
const missing = e => /does not exist|schema cache|could not find the table/i.test(e?.message || '') || e?.code === '42P01' || e?.code === 'PGRST205';

// ---- your day, from YOU's settings (time zone, when the day ends, units) ----
function clock(settings) {
  const zone = settings.timeZone || settings.deviceZone || 'UTC';
  const dayEnds = Number.isInteger(settings.dayEnds) ? settings.dayEnds : 0;
  const day = ms => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms - dayEnds * 3600000));
  const today = day(Date.now());
  const shift = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const now = new Date().toLocaleString('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return { zone, today, shift, now, weight: settings.weight === 'kg' ? 'kg' : 'lbs', metric: settings.length === 'metric' };
}

// ---- tools ----
const APPS = ['body', 'money', 'gym', 'meal', 'write', 'read', 'sleep', 'goals', 'reviews'];
const CATEGORIES = ['Food & drink', 'Groceries', 'Transport', 'Shopping', 'Subscriptions', 'Bills & utilities', 'Housing', 'Health', 'Entertainment', 'Travel', 'Other'];
const CARDIO = ['treadmill', 'stairmaster', 'bike', 'rowing', 'elliptical', 'other'];
const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

const TOOLS = [
  { name: 'read_app_data', description: 'Read recent records from one of the person\'s apps, as JSON. body: weigh-ins. money: expenses, subscriptions, debts, the monthly budget. gym: sets (with exercise names), cardio, saved workouts and exercises. meal: food diary and calorie/macro goals. write: daily journal ratings (1-10) and notes. read: books and pages logged. sleep: nights from Apple Health and the sleep goal. goals: the goals set in YOU. reviews: saved weekly reviews. Use it before answering any question about their data; read several apps for questions that connect them.',
    input_schema: { type: 'object', additionalProperties: false, required: ['app', 'days'], properties: {
      app: { type: 'string', enum: APPS },
      days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days back to read, counting today. 7 for this week, 30 for this month, more for trends.' } } } },
  { name: 'log_weight', description: 'Log a weigh-in to BODY, timed now. Use the unit the person said, else their usual unit.',
    input_schema: { type: 'object', additionalProperties: false, required: ['value'], properties: {
      value: { type: 'number', exclusiveMinimum: 0 }, unit: { type: 'string', enum: ['lbs', 'kg'] } } } },
  { name: 'log_expense', description: 'Log money spent today to MONEY.',
    input_schema: { type: 'object', additionalProperties: false, required: ['amount', 'category'], properties: {
      amount: { type: 'number', minimum: 0 }, category: { type: 'string', enum: CATEGORIES },
      merchant: { type: 'string', description: 'Where, e.g. Chipotle. Empty if not said.' }, note: { type: 'string' } } } },
  { name: 'log_meal', description: 'Log food eaten today to MEAL. If the person gives no numbers, estimate realistic calories and macros for a normal portion and say they are estimates.',
    input_schema: { type: 'object', additionalProperties: false, required: ['name', 'calories', 'protein', 'carbs', 'fat'], properties: {
      name: { type: 'string' }, calories: { type: 'number', minimum: 0 }, protein: { type: 'number', minimum: 0 }, carbs: { type: 'number', minimum: 0 }, fat: { type: 'number', minimum: 0 },
      slot: { type: 'string', enum: SLOTS, description: 'Which meal; leave out to use the time of day.' } } } },
  { name: 'rate_day', description: 'Rate today 1-10 in WRITE, the daily journal, with an optional note. Saving again updates today\'s entry; a new note is added to the end of today\'s.',
    input_schema: { type: 'object', additionalProperties: false, required: ['rating'], properties: {
      rating: { type: 'integer', minimum: 1, maximum: 10 }, note: { type: 'string' } } } },
  { name: 'log_pages', description: 'Log pages read today to READ, for a book on their list.',
    input_schema: { type: 'object', additionalProperties: false, required: ['pages'], properties: {
      pages: { type: 'integer', minimum: 1, maximum: 5000 }, book: { type: 'string', description: 'Part of the title. Leave out when they are reading just one book.' } } } },
  { name: 'log_cardio', description: 'Log a cardio session done today to GYM.',
    input_schema: { type: 'object', additionalProperties: false, required: ['kind', 'minutes'], properties: {
      kind: { type: 'string', enum: CARDIO }, minutes: { type: 'number', exclusiveMinimum: 0, maximum: 1440 },
      distance: { type: 'number', minimum: 0, description: 'In the person\'s distance unit (miles or km).' }, calories: { type: 'number', minimum: 0 } } } },
  { name: 'log_sets', description: 'Log strength sets done today to GYM for one of their exercises: the same weight and reps for each set.',
    input_schema: { type: 'object', additionalProperties: false, required: ['exercise', 'weight', 'reps'], properties: {
      exercise: { type: 'string', description: 'The exercise name as they said it, e.g. bench.' }, weight: { type: 'number', minimum: 0 },
      reps: { type: 'integer', minimum: 1, maximum: 1000 }, sets: { type: 'integer', minimum: 1, maximum: 20, description: 'How many sets; 1 if not said.' } } } },
];

// Checks a tool's input against its schema (enough for these flat schemas); returns a message or null.
function invalid(tool, input) {
  const s = tool.input_schema;
  if (!input || typeof input !== 'object') return 'Input must be an object.';
  for (const k of s.required) if (input[k] === undefined || input[k] === null || input[k] === '') return `Missing ${k}.`;
  for (const [k, v] of Object.entries(input)) {
    const p = s.properties[k]; if (!p) return `Unknown field ${k}.`;
    if (p.type === 'string' && typeof v !== 'string') return `${k} must be text.`;
    if ((p.type === 'number' || p.type === 'integer') && (typeof v !== 'number' || !Number.isFinite(v))) return `${k} must be a number.`;
    if (p.type === 'object' && (typeof v !== 'object' || Array.isArray(v))) return `${k} must be an object.`;
    if (p.type === 'integer' && !Number.isInteger(v)) return `${k} must be a whole number.`;
    if (p.enum && !p.enum.includes(v)) return `${k} must be one of ${p.enum.join(', ')}.`;
    if (p.minimum !== undefined && v < p.minimum) return `${k} is too small.`;
    if (p.exclusiveMinimum !== undefined && v <= p.exclusiveMinimum) return `${k} must be above ${p.exclusiveMinimum}.`;
    if (p.maximum !== undefined && v > p.maximum) return `${k} is too large.`;
  }
  return null;
}

const r1 = n => Math.round(n * 10) / 10;
const KM_PER_MI = 1.609344;
const slotNow = c => { const h = Number(new Date().toLocaleString('en-US', { timeZone: c.zone, hour: 'numeric', hourCycle: 'h23' })); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack'; };

// Runs one tool. Returns { result } for Claude, and { action } for the chat when something was logged.
async function runTool(name, input, ctx) {
  const { q, c } = ctx;
  if (name.startsWith('notion_')) return runNotion(name, input);
  if (name.startsWith('calendar_')) return runCalendar(name, input, c);
  const since = days => c.shift(-(days - 1));
  if (name === 'read_app_data') {
    const from = since(input.days), fromTs = from + 'T00:00:00Z', out = {};
    const part = async (key, path) => { try { out[key] = await q.get(path); } catch (e) { out[key] = missing(e) ? 'not set up' : `could not read: ${e.message}`; } };
    switch (input.app) {
      case 'body': await part('weigh_ins', `events?select=value,unit,occurred_at&metric=eq.weight&occurred_at=gte.${fromTs}&order=occurred_at.desc&limit=400`); break;
      case 'money':
        await part('expenses', `transactions?select=occurred_on,amount,category,merchant,note&occurred_on=gte.${from}&order=occurred_on.desc&limit=500`);
        await part('subscriptions', 'subscriptions?select=name,amount,cadence,category,next_charge,active&order=name');
        await part('debts', 'debts?select=name,balance,apr,min_payment&order=name');
        await part('budget', 'money_profile?select=monthly_income,savings,budget');
        break;
      case 'gym': {
        await part('exercises', 'exercises?select=id,name,muscle,unit,target_sets,target_reps,archived&order=name');
        await part('sets', `sets?select=exercise_id,performed_on,set_no,weight,reps&performed_on=gte.${from}&order=performed_on.desc&limit=600`);
        await part('cardio', `cardio?select=performed_on,kind,minutes,distance_km,speed,speed_unit,calories&performed_on=gte.${from}&order=performed_on.desc&limit=200`);
        await part('workouts', 'workouts?select=name,exercise_ids');
        if (Array.isArray(out.exercises) && Array.isArray(out.sets)) {
          const names = Object.fromEntries(out.exercises.map(e => [e.id, e.name]));
          out.sets = out.sets.map(({ exercise_id, ...s }) => ({ exercise: names[exercise_id] || 'deleted exercise', ...s }));
          if (Array.isArray(out.workouts)) out.workouts = out.workouts.map(w => ({ name: w.name, exercises: (w.exercise_ids || []).map(id => names[id]).filter(Boolean) }));
          out.exercises = out.exercises.map(({ id, ...e }) => e);
        }
        if (Array.isArray(out.cardio)) out.cardio = out.cardio.map(x => ({ ...x, distance: x.distance_km == null ? null : `${r1(c.metric ? x.distance_km : x.distance_km / KM_PER_MI)} ${c.metric ? 'km' : 'mi'}` }));
        break; }
      case 'meal':
        await part('entries', `meal_entries?select=eaten_on,slot,name,calories,protein,carbs,fat&eaten_on=gte.${from}&order=eaten_on.desc&limit=600`);
        await part('goals', 'meal_goals?select=calories,protein,carbs,fat');
        break;
      case 'write': await part('entries', `journal_entries?select=written_on,rating,body&written_on=gte.${from}&order=written_on.desc&limit=120`); break;
      case 'read':
        await part('books', 'books?select=title,author,status,rating,total_pages,finished_on&order=updated_at.desc&limit=100');
        await part('pages', `reading_log?select=book_id,read_on,pages&read_on=gte.${from}&order=read_on.desc&limit=300`);
        if (Array.isArray(out.pages)) { let ids = {}; try { ids = Object.fromEntries((await q.get('books?select=id,title')).map(b => [b.id, b.title])); } catch {} out.pages = out.pages.map(({ book_id, ...p }) => ({ book: ids[book_id] || 'unknown', ...p })); }
        break;
      case 'sleep':
        await part('nights', `sleep_nights?select=night,bedtime,wake_time,asleep_min,awake_min,core_min,deep_min,rem_min,resting_hr&night=gte.${from}&order=night.desc&limit=120`);
        await part('goal', 'sleep_goals?select=goal_hours');
        break;
      case 'goals': await part('goals', 'goals?select=kind,target,unit,start_value,start_date,due_date,ref,done_on&archived=eq.false&order=created_at'); break;
      case 'reviews': await part('reviews', `weekly_reviews?select=week_start,review,source&week_start=gte.${since(Math.max(input.days, 7))}&order=week_start.desc&limit=12`); break;
    }
    return { result: JSON.stringify({ app: input.app, from, today: c.today, ...out }) };
  }
  if (name === 'log_weight') {
    const unit = input.unit || c.weight, value = r1(input.value);
    await q.insert('events', { occurred_at: new Date().toISOString(), metric: 'weight', value, unit, event_type: 'measurement', source: 'jarvis', source_id: crypto.randomUUID(), context: { area: 'body' } });
    return { result: `Logged ${value} ${unit} to BODY.`, action: { app: 'body', text: `${value} ${unit}` } };
  }
  if (name === 'log_expense') {
    await q.insert('transactions', { occurred_on: c.today, amount: Math.round(input.amount * 100) / 100, category: input.category, merchant: input.merchant || '', note: input.note || '' });
    return { result: `Logged $${input.amount.toFixed(2)} (${input.category}${input.merchant ? `, ${input.merchant}` : ''}) to MONEY for ${c.today}.`, action: { app: 'money', text: `$${input.amount.toFixed(2)} · ${input.merchant || input.category}` } };
  }
  if (name === 'log_meal') {
    const slot = input.slot || slotNow(c), row = { eaten_on: c.today, slot, name: input.name.slice(0, 120), calories: Math.round(input.calories), protein: Math.round(input.protein), carbs: Math.round(input.carbs), fat: Math.round(input.fat), source: 'manual' };
    await q.insert('meal_entries', row);
    return { result: `Logged ${row.name} (${row.calories} kcal, P${row.protein} C${row.carbs} F${row.fat}) as ${slot} to MEAL for ${c.today}.`, action: { app: 'meal', text: `${row.name} · ${row.calories} kcal` } };
  }
  if (name === 'rate_day') {
    const [existing] = await q.get(`journal_entries?select=body&written_on=eq.${c.today}`);
    const note = (input.note || '').trim(), body = [existing?.body?.trim(), note].filter(Boolean).join('\n\n');
    await q.upsert('journal_entries', { written_on: c.today, rating: input.rating, body, updated_at: new Date().toISOString() }, 'user_id,written_on');
    return { result: `Rated ${c.today} ${input.rating}/10 in WRITE${note ? ' with the note' : ''}.`, action: { app: 'write', text: `${input.rating}/10` } };
  }
  if (name === 'log_pages') {
    const books = await q.get('books?select=id,title,status,total_pages&order=updated_at.desc');
    const want = (input.book || '').toLowerCase().trim();
    const pool = want ? books.filter(b => b.title.toLowerCase().includes(want)) : books.filter(b => b.status === 'reading');
    if (pool.length !== 1) return { result: pool.length ? `Which book? Matches: ${pool.map(b => b.title).join('; ')}.` : want ? `No book matching "${input.book}". Books: ${books.map(b => b.title).join('; ') || 'none'}.` : `Which book? Reading: ${books.filter(b => b.status === 'reading').map(b => b.title).join('; ') || 'none'}.`, error: true };
    const book = pool[0];
    await q.insert('reading_log', { book_id: book.id, read_on: c.today, pages: input.pages });
    return { result: `Logged ${input.pages} pages of ${book.title} to READ for ${c.today}.`, action: { app: 'read', text: `${input.pages} pages · ${book.title}` } };
  }
  if (name === 'log_cardio') {
    const km = input.distance ? Math.round((c.metric ? input.distance : input.distance * KM_PER_MI) * 1000) / 1000 : null;
    await q.insert('cardio', { performed_on: c.today, kind: input.kind, minutes: Math.round(input.minutes), calories: input.calories ? Math.round(input.calories) : null, distance_km: km, speed: null, speed_unit: input.kind === 'treadmill' ? (c.metric ? 'km/h' : 'mph') : 'level', note: '' });
    const dist = input.distance ? ` · ${r1(input.distance)} ${c.metric ? 'km' : 'mi'}` : '';
    return { result: `Logged ${input.kind} ${Math.round(input.minutes)} min${dist} to GYM for ${c.today}.`, action: { app: 'gym', text: `${input.kind} ${Math.round(input.minutes)} min${dist}` } };
  }
  if (name === 'log_sets') {
    const exercises = await q.get('exercises?select=id,name,unit&archived=eq.false&order=name');
    const want = input.exercise.toLowerCase().trim(), exact = exercises.filter(e => e.name.toLowerCase() === want);
    const pool = exact.length ? exact : exercises.filter(e => e.name.toLowerCase().includes(want) || want.includes(e.name.toLowerCase()));
    if (pool.length !== 1) return { result: pool.length ? `Which exercise? Matches: ${pool.map(e => e.name).join('; ')}.` : `No exercise matching "${input.exercise}" in GYM. Exercises: ${exercises.map(e => e.name).join('; ') || 'none'}. Add it in GYM first.`, error: true };
    const ex = pool[0], n = input.sets || 1;
    const done = await q.get(`sets?select=set_no&exercise_id=eq.${ex.id}&performed_on=eq.${c.today}&order=set_no.desc&limit=1`);
    const start = (done[0]?.set_no || 0) + 1;
    const rows = Array.from({ length: n }, (_, i) => ({ exercise_id: ex.id, performed_on: c.today, set_no: Math.min(50, start + i), weight: input.weight, reps: input.reps }));
    await q.insert('sets', rows);
    return { result: `Logged ${n} × ${input.reps} at ${input.weight} ${ex.unit || 'lbs'} on ${ex.name} to GYM (sets ${start}-${start + n - 1} today).`, action: { app: 'gym', text: `${ex.name} ${n}×${input.reps} @ ${input.weight}` } };
  }
  return { result: `Unknown tool ${name}.`, error: true };
}

const SYSTEM = `You are Jarvis, a personal assistant connected to the person's own apps, which all share one database:
BODY (weigh-ins), MONEY (spending, subscriptions, debts, budget), GYM (strength sets, cardio, saved workouts), MEAL (food diary against calorie and macro goals), WRITE (a 1-10 rating of each day with a journal note), READ (books and pages read), SLEEP (nights from Apple Health), plus goals and weekly reviews kept in YOU, their hub.

How to work:
- Answer from their data, never from guesses. Read the apps a question needs with read_app_data first; for questions that connect apps (sleep and workouts, spending and mood), read each one. Quote real numbers and dates.
- Log when the person tells you something happened ("158.4 this morning", "spent 12 at Chipotle", "30 minutes on the treadmill", "read 20 pages", "today was a 7"). Pick the right tool, fill what they said, and confirm in one short line what you logged and where. Several things in one message means several tool calls.
- If something needed to log is unclear (which book, which exercise, an amount), ask one short question instead of guessing. For food without numbers, estimate a normal portion and say the figures are estimates.
- Notion (when connected): find pages with notion_search before reading or writing; read before summarising. Create new pages where the person says, or under the page that fits best; if nothing fits, ask where. Add to an existing page with notion_add_to_page rather than creating a duplicate. Give the link when you create or add something.
- Calendar (when connected): their Google Calendar, which also shows in Apple Calendar. Read it for what's on, free time and when things are; turn "tomorrow", "Friday", "next week" into dates from today. When adding an event, use the time they said in their own time zone, default to an hour, and confirm the day, date and time. If the time is unclear ("Friday evening"), ask.
- You cannot delete or edit existing records, or move or delete calendar events. If they ask, say so and point them to the app where they can do it.
- Be brief, warm and plain: a sentence or two for logs, a short paragraph or a few bullets for questions. No emoji, no exclamation marks. Use their units and dates relative to today ("yesterday", "last Tuesday").
- Do not give medical or financial advice beyond what their own numbers show. If they mention a crisis or self-harm, say gently that you are not the right help and suggest reaching out to someone they trust or a crisis line.`;

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return response.status(405).end(JSON.stringify({ error: 'Method not allowed.' })); }
  if (!SUPABASE_URL || !SUPABASE_KEY) return response.status(503).end(JSON.stringify({ error: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy JARVIS.' }));
  if (!process.env.ANTHROPIC_API_KEY) return response.status(503).end(JSON.stringify({ error: 'Set ANTHROPIC_API_KEY in Vercel, then redeploy JARVIS.' }));
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = token && await signedInUser(token);
  if (!user) return response.status(401).end(JSON.stringify({ error: 'Sign in to talk to Jarvis.' }));

  const body = typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body || {});
  const text = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
  if (!text) return response.status(400).end(JSON.stringify({ error: 'Say something first.' }));

  const q = db(token);
  let settings = {};
  try { settings = (await q.get('user_settings?select=settings'))[0]?.settings || {}; } catch {}
  const c = clock(settings);
  let past = [];
  try { past = (await q.get(`jarvis_messages?select=role,text&order=created_at.desc&limit=${HISTORY}`)).reverse(); } catch (e) { if (!missing(e)) throw e; }

  // Earlier turns go in as plain text; this turn carries the time and units it needs.
  const messages = [];
  for (const m of past) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (messages.length && messages.at(-1).role === role) messages.at(-1).content += `\n\n${m.text}`;
    else messages.push({ role, content: m.text });
  }
  if (messages[0]?.role === 'assistant') messages.shift();
  if (messages.at(-1)?.role === 'user') messages.pop(); // an unanswered earlier message
  messages.push({ role: 'user', content: [
    { type: 'text', text: `[Now: ${c.now} (${c.zone}). Today counts as ${c.today}. Their units: weight ${c.weight}, distance ${c.metric ? 'km' : 'miles'}.]` },
    { type: 'text', text },
  ] });

  const tools = [...TOOLS, ...(notionOn() ? NOTION_TOOLS : []), ...(calendarOn() ? CALENDAR_TOOLS : [])];
  if (!notionOn()) messages.at(-1).content[0].text += ' [Notion is not connected yet: if they ask about Notion, say it needs a NOTION_TOKEN set in Jarvis\'s Vercel settings.]';
  if (!calendarOn()) messages.at(-1).content[0].text += ' [The calendar is not connected yet: if they ask about their schedule, say it needs GOOGLE_SERVICE_ACCOUNT and GOOGLE_CALENDAR_ID set in Jarvis\'s Vercel settings.]';
  const workspace = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  const client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  const actions = [];
  let reply = '';
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: 'claude-opus-5-5', max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        system: SYSTEM, tools, messages,
        output_config: { effort: 'low' },
      });
      if (res.stop_reason === 'refusal') { reply = 'I can\'t help with that one.'; break; }
      const uses = res.content.filter(b => b.type === 'tool_use');
      const said = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (res.stop_reason === 'max_tokens') { reply = said || 'That got too long. Try asking in smaller pieces.'; break; } // never run a cut-off tool call
      if (!uses.length || res.stop_reason !== 'tool_use') { reply = said || reply; break; }
      messages.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const use of uses) {
        const tool = tools.find(t => t.name === use.name), bad = tool ? invalid(tool, use.input) : 'Unknown tool.';
        if (bad) { results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: bad }); continue; }
        try {
          const out = await runTool(use.name, use.input, { q, c });
          if (out.action) actions.push(out.action);
          results.push({ type: 'tool_result', tool_use_id: use.id, content: out.result, ...(out.error ? { is_error: true } : {}) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: missing(e) ? 'That app is not set up in this database.' : `Failed: ${e.message}` });
        }
      }
      messages.push({ role: 'user', content: results });
      if (step === MAX_STEPS - 1) reply = said || 'I ran out of steps on that one. Try asking more simply.';
    }
  } catch (error) {
    console.error('jarvis error', error?.status, error?.message);
    const status = error instanceof Anthropic.RateLimitError ? 429 : error instanceof Anthropic.AuthenticationError ? 401 : 502;
    const msg = status === 429 ? 'Jarvis is busy. Try again in a minute.' : status === 401 ? 'The ANTHROPIC_API_KEY in Vercel was rejected. Check the key and redeploy.' : 'Jarvis couldn\'t answer just now. Try again.';
    // Anything already logged stays logged; say so.
    return response.status(status).end(JSON.stringify({ error: msg, actions }));
  }

  reply = reply || 'Done.';
  try {
    await q.insert('jarvis_messages', [{ role: 'user', text, actions: [] }, { role: 'assistant', text: reply, actions }]); // same keys in every row
  } catch (e) { if (!missing(e)) console.error('jarvis save', e.message); }
  return response.status(200).end(JSON.stringify({ reply, actions }));
}
