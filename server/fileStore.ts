import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ResponseDoc, SceneState } from '../shared/domain.js';
import { decideCreate, withDefaults, type CreateInput, type RateWindow, type Store } from './core.js';

interface Db { state: SceneState; counter: number; responses: Record<string, ResponseDoc>; rate: Record<string, RateWindow> }

/** Локальное хранилище для проверки без Firebase. В Vercel не используется. */
export class FileStore implements Store {
  private db: Db;
  constructor(private path: string) {
    this.db = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8'))
      : { state: withDefaults(), counter: 0, responses: {}, rate: {} };
  }
  private save() { mkdirSync(dirname(this.path), { recursive: true }); writeFileSync(this.path, JSON.stringify(this.db, null, 1)); }
  async getState() { return this.db.state; }
  async updateState(fn: (s: SceneState) => Partial<SceneState>) {
    this.db.state = { ...this.db.state, ...fn(this.db.state) }; this.save(); return this.db.state;
  }
  async createResponse(input: CreateInput) {
    const d = this.db;
    const r = decideCreate({
      input, existing: d.responses[input.id], state: d.state, counter: d.counter,
      ipRate: d.rate[`ip_${input.ipHash}`], deviceRate: d.rate[`device_${input.deviceHash}`],
    });
    if (r.outcome.kind === 'ok' && !r.outcome.duplicate) {
      d.responses[input.id] = r.outcome.doc; d.counter = r.counter!;
      d.rate[`ip_${input.ipHash}`] = r.ipRate!; d.rate[`device_${input.deviceHash}`] = r.deviceRate!;
      this.save();
    }
    return r.outcome;
  }
  async listSince(since: number) {
    return Object.values(this.db.responses).filter((r) => r.updatedAt > since).sort((a, b) => a.updatedAt - b.updatedAt);
  }
  async patchResponse(id: string, patch: Partial<ResponseDoc>) {
    const r = this.db.responses[id]; if (!r) return false;
    Object.assign(r, patch); this.save(); return true;
  }
  async deleteAll() { this.db.responses = {}; this.db.counter = 0; this.save(); }
}
