// Notion for Jarvis: search, read pages and databases, create pages, add to a page, and edit: rename pages,
// update database entries, tick to-dos, change a line's text and insert lines after a line.
// Uses a Notion internal integration (NOTION_TOKEN in Vercel); it sees only the pages you shared with it.
// Nothing here deletes or archives. Every edit reports what it changed, before and after.
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const MAX_BLOCKS = 300;

export const notionOn = () => !!(process.env.NOTION_TOKEN || '').trim();

async function call(method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${(process.env.NOTION_TOKEN || '').trim()}`, 'notion-version': VERSION, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(r.status === 401 ? 'The NOTION_TOKEN in Vercel was rejected.' : r.status === 404 ? 'Not found, or not shared with the Jarvis integration in Notion.' : data.message || `Notion ${r.status}`);
    e.status = r.status; throw e;
  }
  return data;
}

// A Notion id from an id, a dashed id or a notion.so link.
function idOf(s) {
  const m = String(s || '').replace(/-/g, '').match(/[0-9a-f]{32}(?![0-9a-f])/i);
  if (!m) throw new Error('That is not a Notion page or database id.');
  const h = m[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Blocks whose text Jarvis may change.
const EDITABLE = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'toggle']);
const plain = rt => (rt || []).map(t => t.plain_text ?? t.text?.content ?? '').join('');
const titleOf = item => {
  if (item.object === 'database') return plain(item.title) || 'Untitled database';
  const p = Object.values(item.properties || {}).find(v => v.type === 'title');
  return plain(p?.title) || 'Untitled';
};

// A property as a plain value.
function value(p) {
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'number': return p.number;
    case 'select': return p.select?.name ?? null;
    case 'status': return p.status?.name ?? null;
    case 'multi_select': return p.multi_select.map(o => o.name);
    case 'date': return p.date ? (p.date.end ? `${p.date.start} to ${p.date.end}` : p.date.start) : null;
    case 'checkbox': return p.checkbox;
    case 'url': return p.url; case 'email': return p.email; case 'phone_number': return p.phone_number;
    case 'people': return p.people.map(u => u.name || 'someone');
    case 'relation': return `${p.relation.length} linked`;
    case 'formula': return p.formula?.[p.formula?.type] ?? null;
    case 'rollup': return p.rollup?.type === 'number' ? p.rollup.number : p.rollup?.type === 'array' ? `${p.rollup.array.length} items` : null;
    case 'created_time': return p.created_time; case 'last_edited_time': return p.last_edited_time;
    default: return null;
  }
}
const props = page => Object.fromEntries(Object.entries(page.properties || {}).map(([k, v]) => [k, value(v)]));

// A page's blocks as indented text lines, children included, up to MAX_BLOCKS.
async function blocksText(id, depth = 0, budget = { left: MAX_BLOCKS }) {
  const lines = []; let cursor;
  do {
    const res = await call('GET', `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const b of res.results) {
      if (budget.left-- <= 0) { lines.push('… (page continues)'); return lines; }
      const pad = '  '.repeat(depth), t = b[b.type] || {}, text = plain(t.rich_text);
      const line = {
        paragraph: text, heading_1: `# ${text}`, heading_2: `## ${text}`, heading_3: `### ${text}`,
        bulleted_list_item: `- ${text}`, numbered_list_item: `1. ${text}`, to_do: `[${t.checked ? 'x' : ' '}] ${text}`,
        quote: `> ${text}`, callout: `> ${text}`, toggle: `▸ ${text}`, code: `\`${text}\``, divider: '---',
        child_page: `[page: ${t.title}] (id ${b.id})`, child_database: `[database: ${t.title}] (id ${b.id})`,
        bookmark: t.url, embed: t.url, link_to_page: '[link to a page]', table_row: (t.cells || []).map(plain).join(' | '),
      }[b.type];
      if (line !== undefined && line !== '') lines.push(`${pad}${line}${EDITABLE.has(b.type) ? `  ⟨${b.id}⟩` : ''}`);
      if (b.has_children && depth < 2 && !['child_page', 'child_database'].includes(b.type)) lines.push(...await blocksText(b.id, depth + 1, budget));
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return lines;
}

// Lines of text as Notion blocks: "# ", "## ", "### ", "- ", "1. ", "[ ] ", "> ", or a paragraph.
function toBlocks(content) {
  const rich = s => { const out = []; for (let i = 0; i < s.length || i === 0; i += 2000) out.push({ type: 'text', text: { content: s.slice(i, i + 2000) } }); return out; };
  const blocks = [];
  for (const raw of String(content || '').split('\n')) {
    const line = raw.trimEnd(); if (!line.trim()) continue;
    let m, type = 'paragraph', text = line.trim(), extra = {};
    if ((m = text.match(/^(#{1,3})\s+(.*)/))) { type = `heading_${m[1].length}`; text = m[2]; }
    else if ((m = text.match(/^[-*]\s+\[( |x)\]\s+(.*)/i)) || (m = text.match(/^\[( |x)\]\s+(.*)/i))) { type = 'to_do'; extra = { checked: m[1].toLowerCase() === 'x' }; text = m[2]; }
    else if ((m = text.match(/^[-*•]\s+(.*)/))) { type = 'bulleted_list_item'; text = m[1]; }
    else if ((m = text.match(/^\d+[.)]\s+(.*)/))) { type = 'numbered_list_item'; text = m[1]; }
    else if ((m = text.match(/^>\s+(.*)/))) { type = 'quote'; text = m[1]; }
    blocks.push({ object: 'block', type, [type]: { rich_text: rich(text), ...extra } });
  }
  return blocks;
}
async function append(id, blocks) {
  for (let i = 0; i < blocks.length; i += 100) await call('PATCH', `/blocks/${id}/children`, { children: blocks.slice(i, i + 100) });
}

export const NOTION_TOOLS = [
  { name: 'notion_search', description: 'Search the person\'s Notion (only pages and databases shared with Jarvis) by title. Use it to find a page or database before reading or writing to it. An empty query lists recently edited ones.',
    input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } } },
  { name: 'notion_read', description: 'Read a Notion page (its properties and its content as text) or a database (its columns and up to 50 entries, each with its page id). Takes an id or a link from notion_search or the person. Each editable line ends with its block id in ⟨ ⟩, for notion_edit_line, notion_set_todo and notion_insert_after.',
    input_schema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } } },
  { name: 'notion_create_page', description: 'Create a new Notion page inside a page or as a new entry in a database (from notion_search). Content is plain lines: "# ", "## ", "### " headings, "- " bullets, "1. " numbered, "[ ] " to-dos, "> " quotes, else paragraphs. For a database entry, properties sets other columns by their exact names (text, number, select, multi-select as a list, date as YYYY-MM-DD, checkbox).',
    input_schema: { type: 'object', additionalProperties: false, required: ['parent_id', 'title'], properties: {
      parent_id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
      properties: { type: 'object', description: 'Database entries only: column name to value.' } } } },
  { name: 'notion_add_to_page', description: 'Add content to the end of an existing Notion page, in the same plain-line format as notion_create_page. It never changes or removes what is already there.',
    input_schema: { type: 'object', additionalProperties: false, required: ['page_id', 'content'], properties: { page_id: { type: 'string' }, content: { type: 'string' } } } },
  { name: 'notion_update_page', description: 'Rename a Notion page and/or change a database entry\'s columns (by their exact names: text, number, select, status, multi-select as a list, date as YYYY-MM-DD, checkbox; an empty value clears it). Takes the page id from notion_search or a database\'s entries in notion_read.',
    input_schema: { type: 'object', additionalProperties: false, required: ['page_id'], properties: {
      page_id: { type: 'string' }, title: { type: 'string', description: 'The new title.' }, properties: { type: 'object', description: 'Column name to new value.' } } } },
  { name: 'notion_set_todo', description: 'Tick or untick one to-do on a page, by its block id from notion_read.',
    input_schema: { type: 'object', additionalProperties: false, required: ['block_id', 'checked'], properties: { block_id: { type: 'string' }, checked: { type: 'boolean' } } } },
  { name: 'notion_edit_line', description: 'Replace the text of one line on a page (a paragraph, heading, bullet, numbered item, to-do, quote, callout or toggle), by its block id from notion_read. Its type, indentation and tick stay as they are.',
    input_schema: { type: 'object', additionalProperties: false, required: ['block_id', 'text'], properties: { block_id: { type: 'string' }, text: { type: 'string' } } } },
  { name: 'notion_insert_after', description: 'Insert new lines straight after a given line on a page (by its block id from notion_read), in the same plain-line format as notion_create_page.',
    input_schema: { type: 'object', additionalProperties: false, required: ['block_id', 'content'], properties: { block_id: { type: 'string' }, content: { type: 'string' } } } },
];

// A database property value from a plain value, by the column's type.
function propValue(def, v) {
  if (v === null || v === '') return { title: { title: [] }, rich_text: { rich_text: [] }, number: { number: null }, select: { select: null }, status: null, multi_select: { multi_select: [] }, date: { date: null }, checkbox: { checkbox: false }, url: { url: null }, email: { email: null }, phone_number: { phone_number: null } }[def.type] ?? (() => { throw new Error(`Jarvis can't clear ${def.name}.`); })();
  switch (def.type) {
    case 'title': return { title: [{ type: 'text', text: { content: String(v) } }] };
    case 'rich_text': return { rich_text: [{ type: 'text', text: { content: String(v) } }] };
    case 'number': { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${def.name} needs a number.`); return { number: n }; }
    case 'select': return { select: { name: String(v) } };
    case 'status': return { status: { name: String(v) } };
    case 'multi_select': return { multi_select: (Array.isArray(v) ? v : String(v).split(',')).map(s => ({ name: String(s).trim() })).filter(o => o.name) };
    case 'date': if (!/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw new Error(`${def.name} needs a date like 2026-11-20.`); return { date: { start: String(v) } };
    case 'checkbox': return { checkbox: v === true || v === 'true' || v === 'yes' };
    case 'url': return { url: String(v) }; case 'email': return { email: String(v) }; case 'phone_number': return { phone_number: String(v) };
    default: throw new Error(`Jarvis can't set ${def.name} (a ${def.type} column).`);
  }
}

export async function runNotion(name, input) {
  if (name === 'notion_search') {
    const res = await call('POST', '/search', { query: input.query || '', page_size: 15, sort: { direction: 'descending', timestamp: 'last_edited_time' } });
    const items = res.results.map(r => ({ type: r.object, title: titleOf(r), id: r.id, url: r.url, parent: r.parent?.type, edited: r.last_edited_time?.slice(0, 10) }));
    return { result: JSON.stringify(items.length ? items : 'Nothing found. Only pages shared with the Jarvis integration can be found.') };
  }
  if (name === 'notion_read') {
    const id = idOf(input.id);
    let db = null; try { db = await call('GET', `/databases/${id}`); } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
    if (db) {
      const q = await call('POST', `/databases/${id}/query`, { page_size: 50 });
      return { result: JSON.stringify({ database: titleOf(db), url: db.url, columns: Object.fromEntries(Object.entries(db.properties).map(([k, v]) => [k, v.type === 'select' || v.type === 'multi_select' || v.type === 'status' ? `${v.type}: ${(v[v.type]?.options || []).map(o => o.name).join(', ')}` : v.type])), entries: q.results.map(p => ({ id: p.id, ...props(p) })), more: q.has_more }) };
    }
    const page = await call('GET', `/pages/${id}`);
    const lines = await blocksText(id);
    return { result: JSON.stringify({ page: titleOf(page), url: page.url, properties: props(page), content: lines.join('\n') || '(empty)' }) };
  }
  if (name === 'notion_create_page') {
    const pid = idOf(input.parent_id), children = toBlocks(input.content);
    let db = null; try { db = await call('GET', `/databases/${pid}`); } catch (e) { if (e.status !== 404 && e.status !== 400) throw e; }
    let body;
    if (db) {
      const titleKey = Object.keys(db.properties).find(k => db.properties[k].type === 'title');
      const properties = { [titleKey]: propValue({ ...db.properties[titleKey], name: titleKey }, input.title) };
      for (const [k, v] of Object.entries(input.properties || {})) {
        const key = Object.keys(db.properties).find(x => x.toLowerCase() === k.toLowerCase());
        if (!key) throw new Error(`${db ? titleOf(db) : 'The database'} has no column "${k}". Columns: ${Object.keys(db.properties).join(', ')}.`);
        if (key !== titleKey && v !== null && v !== '') properties[key] = propValue({ ...db.properties[key], name: key }, v);
      }
      body = { parent: { database_id: pid }, properties, children: children.slice(0, 100) };
    } else {
      body = { parent: { page_id: pid }, properties: { title: { title: [{ type: 'text', text: { content: input.title } }] } }, children: children.slice(0, 100) };
    }
    const page = await call('POST', '/pages', body);
    if (children.length > 100) await append(page.id, children.slice(100));
    return { result: `Created "${input.title}" in ${db ? `the ${titleOf(db)} database` : 'Notion'}: ${page.url}`, action: { app: 'notion', text: input.title, url: page.url } };
  }
  if (name === 'notion_add_to_page') {
    const id = idOf(input.page_id), blocks = toBlocks(input.content);
    if (!blocks.length) return { result: 'Nothing to add.', error: true };
    const page = await call('GET', `/pages/${id}`);
    await append(id, blocks);
    return { result: `Added ${blocks.length} line${blocks.length === 1 ? '' : 's'} to "${titleOf(page)}": ${page.url}`, action: { app: 'notion', text: `+ ${titleOf(page)}`, url: page.url } };
  }
  if (name === 'notion_update_page') {
    const id = idOf(input.page_id), page = await call('GET', `/pages/${id}`);
    const keys = Object.keys(page.properties || {}), titleKey = keys.find(k => page.properties[k].type === 'title');
    const properties = {}, changes = [];
    if (input.title !== undefined) { if (!String(input.title).trim()) return { result: 'A page needs a title.', error: true }; properties[titleKey] = propValue({ type: 'title', name: titleKey }, input.title); changes.push(`title "${titleOf(page)}" → "${input.title}"`); }
    for (const [k, v] of Object.entries(input.properties || {})) {
      const key = keys.find(x => x.toLowerCase() === k.toLowerCase());
      if (!key) return { result: `"${titleOf(page)}" has no column "${k}". Columns: ${keys.join(', ')}.`, error: true };
      const def = { ...page.properties[key], name: key };
      if (key === titleKey) { properties[key] = propValue(def, v); changes.push(`title "${titleOf(page)}" → "${v}"`); continue; }
      if (def.type === 'status' && (v === null || v === '')) return { result: `${key} can't be cleared, only changed.`, error: true };
      properties[key] = propValue(def, v);
      const before = value(page.properties[key]);
      changes.push(`${key}: ${JSON.stringify(before ?? '')} → ${JSON.stringify(v ?? '')}`);
    }
    if (!changes.length) return { result: 'Nothing to change.', error: true };
    const updated = await call('PATCH', `/pages/${id}`, { properties });
    return { result: `Updated "${titleOf(updated)}": ${changes.join('; ')}. ${updated.url}`, action: { app: 'notion', text: `✎ ${titleOf(updated)}`, url: updated.url } };
  }
  if (name === 'notion_set_todo' || name === 'notion_edit_line' || name === 'notion_insert_after') {
    const id = idOf(input.block_id), b = await call('GET', `/blocks/${id}`), t = b[b.type] || {}, text = plain(t.rich_text);
    const pageUrl = b.parent?.page_id ? `https://www.notion.so/${b.parent.page_id.replace(/-/g, '')}` : undefined;
    if (name === 'notion_set_todo') {
      if (b.type !== 'to_do') return { result: `That line is a ${b.type.replace(/_/g, ' ')}, not a to-do.`, error: true };
      if (!!t.checked === input.checked) return { result: `"${text}" is already ${input.checked ? 'ticked' : 'unticked'}.` };
      await call('PATCH', `/blocks/${id}`, { to_do: { checked: input.checked } });
      return { result: `${input.checked ? 'Ticked' : 'Unticked'} "${text}".`, action: { app: 'notion', text: `${input.checked ? '☑' : '☐'} ${text.slice(0, 40)}`, url: pageUrl } };
    }
    if (name === 'notion_edit_line') {
      if (!EDITABLE.has(b.type)) return { result: `Jarvis can't change the text of a ${b.type.replace(/_/g, ' ')}.`, error: true };
      const next = String(input.text).trim(); if (!next) return { result: 'The new text is empty. Jarvis doesn\'t delete lines.', error: true };
      const rich = []; for (let i = 0; i < next.length; i += 2000) rich.push({ type: 'text', text: { content: next.slice(i, i + 2000) } });
      await call('PATCH', `/blocks/${id}`, { [b.type]: { rich_text: rich } });
      return { result: `Changed "${text}" → "${next}".`, action: { app: 'notion', text: `✎ ${next.slice(0, 40)}`, url: pageUrl } };
    }
    const blocks = toBlocks(input.content); if (!blocks.length) return { result: 'Nothing to insert.', error: true };
    const parent = b.parent?.page_id || b.parent?.block_id; if (!parent) return { result: 'Can\'t find where that line lives.', error: true };
    let after = id;
    for (let i = 0; i < blocks.length; i += 100) { const res = await call('PATCH', `/blocks/${parent}/children`, { children: blocks.slice(i, i + 100), after }); after = res.results?.at(-1)?.id || after; }
    return { result: `Inserted ${blocks.length} line${blocks.length === 1 ? '' : 's'} after "${text || b.type}".`, action: { app: 'notion', text: `+ after ${(text || b.type).slice(0, 30)}`, url: pageUrl } };
  }
  return null;
}
