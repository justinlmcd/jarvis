// Shared by Jarvis's functions: Supabase as the signed-in person, and the person's day from YOU's settings.
export const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
export const SUPABASE_KEY = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();

// ---- Supabase, as the signed-in person ----
export function db(token) {
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
export async function signedInUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}
export const missing = e => /does not exist|schema cache|could not find the table/i.test(e?.message || '') || e?.code === '42P01' || e?.code === 'PGRST205';

// ---- your day, from YOU's settings (time zone, when the day ends, units) ----
export function clock(settings) {
  const zone = settings.timeZone || settings.deviceZone || 'UTC';
  const dayEnds = Number.isInteger(settings.dayEnds) ? settings.dayEnds : 0;
  const day = ms => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms - dayEnds * 3600000));
  const today = day(Date.now());
  const shift = n => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const now = new Date().toLocaleString('en-US', { timeZone: zone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  return { zone, today, shift, now, weight: settings.weight === 'kg' ? 'kg' : 'lbs', metric: settings.length === 'metric' };
}
