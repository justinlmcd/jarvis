// Google Calendar for Jarvis: read your schedule and add events. Nothing is moved, changed or deleted.
// Signs in as a Google service account (GOOGLE_SERVICE_ACCOUNT: the key's JSON) that you shared your calendar with.
// GOOGLE_CALENDAR_ID is that calendar (for your main calendar, your Gmail address); several, comma-separated,
// are all read, and events go to the first.
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';

function account() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  try { const a = JSON.parse(raw); return a.client_email && a.private_key ? a : null; } catch { return null; }
}
const calendars = () => (process.env.GOOGLE_CALENDAR_ID || '').split(',').map(s => s.trim()).filter(Boolean);
export const calendarOn = () => !!account() && calendars().length > 0;

// An access token from a signed JWT (RS256), kept while it's valid.
let cached = null;
const b64url = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
async function token() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const a = account(), now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: a.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(a.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google sign-in failed (${data.error_description || data.error || r.status}). Check GOOGLE_SERVICE_ACCOUNT in Vercel.`);
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}
async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data.error?.message || `Google Calendar ${r.status}`;
    throw new Error(r.status === 404 ? 'Calendar not found. Share it with the service account and check GOOGLE_CALENDAR_ID.' : r.status === 403 ? `No permission (${msg}). Share the calendar with the service account with "Make changes to events".` : msg);
  }
  return data;
}

// The offset of a time zone at a moment, like "-05:00", so local times can become exact instants.
function offset(zone, at) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value || 'GMT';
  const m = part.match(/GMT([+-]\d{2}):?(\d{2})?/);
  return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
}
const instant = (date, zone) => { const noon = new Date(`${date}T12:00:00Z`); return `${date}T00:00:00${offset(zone, noon)}`; };
const nextDay = date => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

export const CALENDAR_TOOLS = [
  { name: 'calendar_list_events', description: 'List events on the person\'s Google Calendar (which also shows in their Apple Calendar) between two dates, inclusive, in their time zone. Optional text to search for. Use it for what\'s on, when they\'re free, or when something is.',
    input_schema: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: {
      from: { type: 'string', description: 'First day, YYYY-MM-DD.' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD (at most 93 days after from).' },
      search: { type: 'string', description: 'Words to look for in events, e.g. dentist.' } } } },
  { name: 'calendar_add_event', description: 'Add an event to the person\'s Google Calendar, in their time zone. For a timed event give start as YYYY-MM-DDTHH:MM and either end or minutes (default 60). For an all-day event give start as YYYY-MM-DD.',
    input_schema: { type: 'object', additionalProperties: false, required: ['title', 'start'], properties: {
      title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string', description: 'YYYY-MM-DDTHH:MM, or YYYY-MM-DD for the last day of an all-day event.' },
      minutes: { type: 'integer', minimum: 5, maximum: 1440 }, location: { type: 'string' }, description: { type: 'string' },
      reminder_minutes: { type: 'integer', minimum: 0, maximum: 10080, description: 'A popup reminder this many minutes before. Leave out for the calendar\'s default.' } } } },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/, DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const when = (e, zone) => {
  if (e.start?.date) { const last = new Date(`${e.end.date}T12:00:00Z`); last.setUTCDate(last.getUTCDate() - 1); const l = last.toISOString().slice(0, 10); return { all_day: true, date: e.start.date, ...(l !== e.start.date ? { until: l } : {}) }; }
  const f = t => new Date(t).toLocaleString('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return { start: f(e.start.dateTime), end: new Date(e.end.dateTime).toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }) };
};

export async function runCalendar(name, input, c) {
  const zone = c.zone, ids = calendars();
  if (name === 'calendar_list_events') {
    if (!DATE.test(input.from) || !DATE.test(input.to)) return { result: 'from and to must be dates like 2026-11-20.', error: true };
    if (input.to < input.from) return { result: 'to is before from.', error: true };
    if ((new Date(input.to) - new Date(input.from)) / 86400000 > 93) return { result: 'Ask for at most about three months at a time.', error: true };
    const params = new URLSearchParams({ timeMin: instant(input.from, zone), timeMax: instant(nextDay(input.to), zone), singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeZone: zone });
    if (input.search) params.set('q', input.search);
    const out = [];
    for (const id of ids) {
      const res = await call('GET', `/calendars/${encodeURIComponent(id)}/events?${params}`);
      for (const e of res.items || []) if (e.status !== 'cancelled') out.push({ title: e.summary || '(no title)', ...when(e, zone), ...(e.location ? { location: e.location } : {}), ...(ids.length > 1 ? { calendar: res.summary || id } : {}), _sort: e.start?.dateTime || e.start?.date });
    }
    out.sort((a, b) => a._sort < b._sort ? -1 : 1).forEach(e => delete e._sort);
    return { result: JSON.stringify({ from: input.from, to: input.to, time_zone: zone, events: out.length ? out : 'none' }) };
  }
  if (name === 'calendar_add_event') {
    const allDay = DATE.test(input.start);
    if (!allDay && !DATETIME.test(input.start)) return { result: 'start must be YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all day.', error: true };
    const body = { summary: input.title.slice(0, 200), ...(input.location ? { location: input.location } : {}), ...(input.description ? { description: input.description } : {}) };
    if (allDay) {
      if (input.end && !DATE.test(input.end)) return { result: 'For an all-day event, end is the last day as YYYY-MM-DD.', error: true };
      body.start = { date: input.start }; body.end = { date: nextDay(input.end || input.start) };
    } else {
      const start = input.start.length === 16 ? `${input.start}:00` : input.start;
      let end;
      if (input.end) { if (!DATETIME.test(input.end)) return { result: 'end must be YYYY-MM-DDTHH:MM.', error: true }; end = input.end.length === 16 ? `${input.end}:00` : input.end; }
      else { // start + minutes, as local wall-clock time
        const d = new Date(`${start}Z`); d.setUTCMinutes(d.getUTCMinutes() + (input.minutes || 60)); end = d.toISOString().slice(0, 19);
      }
      if (end <= start) return { result: 'The event ends before it starts.', error: true };
      body.start = { dateTime: start, timeZone: zone }; body.end = { dateTime: end, timeZone: zone };
    }
    if (input.reminder_minutes !== undefined) body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: input.reminder_minutes }] };
    const e = await call('POST', `/calendars/${encodeURIComponent(ids[0])}/events`, body);
    // Confirm the wall-clock time asked for, exactly as entered (read as UTC so no zone shifts it).
    const wall = (t, opts) => new Date(`${t}Z`).toLocaleString('en-US', { timeZone: 'UTC', ...opts });
    const label = allDay
      ? `${wall(`${body.start.date}T12:00:00`, { weekday: 'short', month: 'short', day: 'numeric' })}${input.end && input.end !== input.start ? ` to ${wall(`${input.end}T12:00:00`, { weekday: 'short', month: 'short', day: 'numeric' })}` : ''} (all day)`
      : `${wall(body.start.dateTime, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}–${wall(body.end.dateTime, { hour: 'numeric', minute: '2-digit' })}`;
    return { result: `Added "${body.summary}" on ${label}: ${e.htmlLink || ''}`, action: { app: 'calendar', text: `${body.summary} · ${label}`, url: e.htmlLink } };
  }
  return null;
}
