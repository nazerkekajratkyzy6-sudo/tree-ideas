import type { ResponseDoc, SceneState } from '../shared/domain.js';
import { decideCreate, RATE, withDefaults, type Context, type CreateInput, type CreateOutcome, type Store } from './core.js';
import { SCREEN_KEY } from './screenKey.js';

const K = { state: 'tree:state', counter: 'tree:counter', resp: 'tree:responses', updated: 'tree:updated' };
type Cmd = (string | number)[];

class RedisStore implements Store {
  constructor(private url: string, private token: string) {}

  private async run(cmds: Cmd[]): Promise<unknown[]> {
    const r = await fetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(cmds), signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) throw new Error(`redis ${r.status}`);
    const out = await r.json() as { result?: unknown; error?: string }[];
    return out.map((x) => { if (x.error) throw new Error(x.error); return x.result ?? null; });
  }

  async getState() {
    const [raw] = await this.run([['GET', K.state]]);
    return withDefaults(raw ? JSON.parse(raw as string) as Partial<SceneState> : undefined);
  }
  async updateState(fn: (s: SceneState) => Partial<SceneState>) {
    const cur = await this.getState(); const next = { ...cur, ...fn(cur) };
    await this.run([['SET', K.state, JSON.stringify(next)]]);
    return next;
  }

  async createResponse(input: CreateInput): Promise<CreateOutcome> {
    const [existing, rawState] = await this.run([['HGET', K.resp, input.id], ['GET', K.state]]);
    const state = withDefaults(rawState ? JSON.parse(rawState as string) as Partial<SceneState> : undefined);
    if (existing) return { kind: 'ok', doc: JSON.parse(existing as string) as ResponseDoc, duplicate: true };
    if (!state.accepting) return { kind: 'closed' };

    const ip = `tree:rate:ip:${input.ipHash}`; const dev = `tree:rate:dev:${input.deviceHash}`;
    const [ipN, devN] = await this.run([['INCR', ip], ['INCR', dev]]) as number[];
    const ttl = Math.ceil(RATE.windowMs / 1000); const expire: Cmd[] = [];
    if (ipN === 1) expire.push(['EXPIRE', ip, ttl]);
    if (devN === 1) expire.push(['EXPIRE', dev, ttl]);
    if (expire.length) await this.run(expire);
    if (ipN > RATE.perIp || devN > RATE.perDevice) return { kind: 'rate' };

    const [n] = await this.run([['INCR', K.counter]]) as number[];
    const { outcome } = decideCreate({ input, state, counter: n - 1 });
    if (outcome.kind !== 'ok') return outcome;
    const [added] = await this.run([['HSETNX', K.resp, input.id, JSON.stringify(outcome.doc)]]);
    if (!added) return { kind: 'ok', doc: outcome.doc, duplicate: true };
    await this.run([['ZADD', K.updated, input.now, input.id]]);
    return outcome;
  }

  async listSince(since: number) {
    const [ids] = await this.run([['ZRANGEBYSCORE', K.updated, `(${since}`, '+inf']]) as string[][];
    if (!ids?.length) return [];
    const [rows] = await this.run([['HMGET', K.resp, ...ids]]) as (string | null)[][];
    return rows.filter((r): r is string => !!r).map((r) => JSON.parse(r) as ResponseDoc).sort((a, b) => a.updatedAt - b.updatedAt);
  }

  async patchResponse(id: string, patch: Partial<ResponseDoc>) {
    const [raw] = await this.run([['HGET', K.resp, id]]);
    if (!raw) return false;
    const doc = { ...JSON.parse(raw as string) as ResponseDoc, ...patch };
    await this.run([['HSET', K.resp, id, JSON.stringify(doc)], ['ZADD', K.updated, doc.updatedAt, id]]);
    return true;
  }

  async deleteAll() { await this.run([['DEL', K.resp, K.updated, K.counter]]); }
}

export class ConfigError extends Error {}
let cached: Context | null = null;

export function redisContext(): Context {
  if (cached) return cached;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new ConfigError('Не подключена база Upstash Redis');
  cached = { mode: 'redis', store: new RedisStore(url, token), displayKey: SCREEN_KEY, salt: `tree:${SCREEN_KEY}` };
  return cached;
}
