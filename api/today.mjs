// The dashboard's view of the services: which are connected, and today's calendar events.
// Signed-in only; nothing here writes.
import { signedInUser, db, clock } from '../lib/core.mjs';
import { notionOn } from '../lib/notion.mjs';
import { calendarOn, eventsBetween } from '../lib/gcal.mjs';

export default async function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return response.status(405).end(JSON.stringify({ error: 'Method not allowed.' })); }
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !(await signedInUser(token))) return response.status(401).end(JSON.stringify({ error: 'Sign in first.' }));
  let settings = {};
  try { settings = (await db(token).get('user_settings?select=settings'))[0]?.settings || {}; } catch {}
  const c = clock(settings);
  const out = { claude: !!(process.env.ANTHROPIC_API_KEY || '').trim(), notion: notionOn(), calendar: calendarOn(), zone: c.zone, today: c.today, events: [] };
  if (out.calendar) {
    try { out.events = await eventsBetween(c.today, c.shift(1), c.zone); }
    catch (e) { out.calendar_error = e.message; }
  }
  return response.status(200).end(JSON.stringify(out));
}
