import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { routeConfig, routeFeed, routeScreen, routeSubmit, type ApiRequest, type Context } from './core.js';
import { FileStore } from './fileStore.js';
import { redisContext } from './redisStore.js';
import { SCREEN_KEY } from './screenKey.js';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve('dist');
const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address;

const ctx: Context = process.env.KV_REST_API_URL ? { ...redisContext(), publicUrl: lan ? `http://${lan}:${PORT}` : undefined } : {
  mode: 'local',
  store: new FileStore(process.env.LOCAL_DB ?? '.local-data/db.json'),
  displayKey: SCREEN_KEY, salt: 'local-only-salt',
  publicUrl: lan ? `http://${lan}:${PORT}` : undefined,
};
const routes: Record<string, (c: Context, r: ApiRequest) => Promise<{ status: number; body: unknown }>> = {
  '/api/config': (c) => routeConfig(c), '/api/submit': routeSubmit, '/api/feed': routeFeed, '/api/screen': routeScreen,
};
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const route = routes[url.pathname];
  if (route) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: unknown;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
    catch { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"ok":false,"code":"bad_json"}'); }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    const r = await route(ctx, { method: req.method ?? 'GET', headers, body, query: Object.fromEntries(url.searchParams), ip: req.socket.remoteAddress ?? 'local' });
    res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(r.body));
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, rel);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\nЛокальный режим: http://localhost:${PORT}`);
  console.log(`Экран проектора: http://localhost:${PORT}/ekran-${SCREEN_KEY}`);
  if (lan) console.log(`Телефоны в той же сети: http://${lan}:${PORT}/join\n`);
});
