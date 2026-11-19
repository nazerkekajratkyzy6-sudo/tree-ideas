import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiRequest, ApiResult, Context } from './core.js';
import { ConfigError, redisContext } from './redisStore.js';

type VercelReq = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
type VercelRes = ServerResponse & { status(c: number): VercelRes; json(b: unknown): void };

export function handler(route: (ctx: Context, req: ApiRequest) => Promise<ApiResult>) {
  return async (req: VercelReq, res: VercelRes) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      let body: unknown;
      try { body = req.body; } catch { return res.status(400).json({ ok: false, code: 'bad_json', message: 'Неверный формат запроса' }); }
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      const query = Object.fromEntries(Object.entries(req.query ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
      const ip = (headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
      const r = await route(redisContext(), { method: req.method ?? 'GET', headers, query, body, ip });
      return res.status(r.status).json(r.body);
    } catch (e) {
      console.error(e);
      const message = e instanceof ConfigError ? 'База ответов ещё не подключена' : 'Сервис временно недоступен';
      return res.status(503).json({ ok: false, code: e instanceof ConfigError ? 'unconfigured' : 'unavailable', message });
    }
  };
}
