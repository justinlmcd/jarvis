'use strict';
// Local preview: node dev.js → http://localhost:8804 (Jarvis itself answers only on Vercel).
const http = require('node:http');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const config = require('./api/config');
const port = Number(process.env.JARVIS_PORT || 8804);
const pages = {'/':'index.html','/index.html':'index.html','/jarvis.js':'jarvis.js','/dashboard.js':'dashboard.js','/settings.js':'settings.js','/icon-180.png':'icon-180.png','/icon-512.png':'icon-512.png','/icon.svg':'icon.svg','/manifest.json':'manifest.json'};
http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/config') return config(request, response);
  if (pathname === '/api/jarvis' || pathname === '/api/today') { response.writeHead(503, {'Content-Type':'application/json'}); return response.end(JSON.stringify({error:'Jarvis answers on Vercel, not in the local preview.'})); }
  if (request.method !== 'GET' || !Object.hasOwn(pages, pathname)) { response.writeHead(404, {'Content-Type':'text/plain'}); return response.end('Not found'); }
  try {
    const body = await readFile(path.join(__dirname, pages[pathname]));
    response.writeHead(200, {'Content-Type': ({'.js':'application/javascript','.png':'image/png','.svg':'image/svg+xml','.json':'application/manifest+json'}[pathname.slice(pathname.lastIndexOf('.'))]||'text/html') + '; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end(body);
  } catch { response.writeHead(500, {'Content-Type':'text/plain'}); response.end('Could not open JARVIS.'); }
}).listen(port, '127.0.0.1', () => console.log(`JARVIS preview: http://localhost:${port}`));
