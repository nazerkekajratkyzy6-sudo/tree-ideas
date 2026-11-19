import { createHash, timingSafeEqual } from 'node:crypto';
import {
  DEFAULT_STATE, LIMITS, type FeedLeaf, type FeedResponse, type PublicConfig, type ResponseDoc, type SceneState,
} from '../shared/domain.js';

export interface ApiRequest {
  method: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip: string;
}
export interface ApiResult { status: number; body: unknown }

export interface RateWindow { windowStart: number; count: number }

export interface CreateInput {
  id: string; name: string; idea: string; seed: number;
  ipHash: string; deviceHash: string; now: number;
}
export type CreateOutcome =
  | { kind: 'ok'; doc: ResponseDoc; duplicate: boolean }
  | { kind: 'closed' }
  | { kind: 'rate' };

export interface Store {
  getState(): Promise<SceneState>;
  updateState(fn: (s: SceneState) => Partial<SceneState>): Promise<SceneState>;
  createResponse(input: CreateInput): Promise<CreateOutcome>;
  listSince(since: number): Promise<ResponseDoc[]>;
  patchResponse(id: string, patch: Partial<Pick<ResponseDoc, 'status' | 'updatedAt'>>): Promise<boolean>;
  deleteAll(): Promise<void>;
}

export interface Context {
  mode: 'redis' | 'local';
  store: Store;
  displayKey: string;
  salt: string;
  publicUrl?: string;
}

export const RATE = { windowMs: 10 * 60_000, perDevice: 8, perIp: 150 };

function bump(w: RateWindow | undefined, now: number): RateWindow {
  if (!w || now - w.windowStart >= RATE.windowMs) return { windowStart: now, count: 1 };
  return { windowStart: w.windowStart, count: w.count + 1 };
}

/** Единая логика приёма ответа: выполняется внутри транзакции хранилища. */
export function decideCreate(a: {
  input: CreateInput; existing?: ResponseDoc; state: SceneState; counter: number;
  ipRate?: RateWindow; deviceRate?: RateWindow;
}): { outcome: CreateOutcome; counter?: number; ipRate?: RateWindow; deviceRate?: RateWindow } {
  if (a.existing) return { outcome: { kind: 'ok', doc: a.existing, duplicate: true } };
  if (!a.state.accepting) return { outcome: { kind: 'closed' } };
  const ipRate = bump(a.ipRate, a.input.now);
  const deviceRate = bump(a.deviceRate, a.input.now);
  if (ipRate.count > RATE.perIp || deviceRate.count > RATE.perDevice) return { outcome: { kind: 'rate' } };
  const doc: ResponseDoc = {
    id: a.input.id, name: a.input.name, idea: a.input.idea,
    status: 'approved',
    leafIndex: a.counter, seed: a.input.seed,
    createdAt: a.input.now, updatedAt: a.input.now,
    isTest: false, schemaVersion: 1,
  };
  return { outcome: { kind: 'ok', doc, duplicate: false }, counter: a.counter + 1, ipRate, deviceRate };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(sha(a)); const y = Buffer.from(sha(b));
  return timingSafeEqual(x, y);
}

const INVISIBLE = '\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\u007f-\\u009f';
const NAME_STRIP = new RegExp(`[\\u0000-\\u001f${INVISIBLE}]`, 'g');
const IDEA_STRIP = new RegExp(`[\\u0000-\\u0009\\u000b-\\u001f${INVISIBLE}]`, 'g');

export function cleanName(v: unknown) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(NAME_STRIP, ' ').replace(/\s+/g, ' ').trim();
}
export function cleanIdea(v: unknown) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/\r\n?/g, '\n').replace(IDEA_STRIP, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
const RUDE = /(?<!\p{L})(?:ху[йеёяию]|[её]б[аоуеёил]|бля|сук[аиу](?!\p{L})|мудак|мудил|пид[оа]р|г[ао]ндон|залуп|дроч)|пизд|бляд|блят/iu;
export const isRude = (s: string) => RUDE.test(s);

const chars = (s: string) => [...s].length;

const err = (status: number, code: string, message: string): ApiResult => ({ status, body: { ok: false, code, message } });

export async function routeConfig(ctx: Context): Promise<ApiResult> {
  const state = await ctx.store.getState();
  const body: PublicConfig = { mode: ctx.mode, accepting: state.accepting, publicUrl: ctx.publicUrl };
  return { status: 200, body };
}

export async function routeSubmit(ctx: Context, req: ApiRequest): Promise<ApiResult> {
  if (req.method !== 'POST') return err(405, 'method', 'Метод не поддерживается');
  if (!(req.headers['content-type'] ?? '').includes('application/json')) return err(415, 'type', 'Неверный формат запроса');
  const b = (req.body ?? {}) as Record<string, unknown>;
  const submissionId = typeof b.submissionId === 'string' ? b.submissionId : '';
  const deviceId = typeof b.deviceId === 'string' ? b.deviceId : '';
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(submissionId) || !uuid.test(deviceId)) return err(400, 'bad_request', 'Обновите страницу и попробуйте ещё раз');

  const id = sha(`submission:${submissionId}`).slice(0, 28);
  // Заполненное скрытое поле — признак бота: отвечаем успехом, но ничего не сохраняем.
  if (typeof b.website === 'string' && b.website.length > 0) return { status: 200, body: { ok: true, id } };
  if (typeof b.elapsedMs !== 'number' || b.elapsedMs < 1200) return err(429, 'too_fast', 'Подождите секунду и отправьте ещё раз');

  const name = cleanName(b.name); const idea = cleanIdea(b.idea);
  if (chars(name) < LIMITS.nameMin || chars(name) > LIMITS.nameMax) return err(422, 'name', `Укажите имя и фамилию (до ${LIMITS.nameMax} символов)`);
  if (chars(idea) < LIMITS.ideaMin || chars(idea) > LIMITS.ideaMax) return err(422, 'idea', `Напишите идею (до ${LIMITS.ideaMax} символов)`);

  if (isRude(name) || isRude(idea)) return err(422, 'rude', 'Пожалуйста, измените формулировку');

  const outcome = await ctx.store.createResponse({
    id, name, idea, seed: parseInt(id.slice(0, 8), 16),
    ipHash: sha(`ip:${ctx.salt}:${req.ip}`).slice(0, 32),
    deviceHash: sha(`device:${ctx.salt}:${deviceId}`).slice(0, 32),
    now: Date.now(),
  });
  if (outcome.kind === 'closed') return err(403, 'closed', 'Приём идей завершён. Спасибо за участие!');
  if (outcome.kind === 'rate') return err(429, 'rate', 'Слишком много отправок. Попробуйте через несколько минут');
  return { status: 201, body: { ok: true, id: outcome.doc.id } };
}

function toLeaf(d: ResponseDoc): FeedLeaf {
  if (d.status !== 'approved') return { id: d.id, visible: false, leafIndex: d.leafIndex, seed: d.seed };
  return { id: d.id, visible: true, leafIndex: d.leafIndex, seed: d.seed, name: d.name, idea: d.idea, createdAt: d.createdAt };
}

export async function routeFeed(ctx: Context, req: ApiRequest): Promise<ApiResult> {
  if (req.method !== 'GET') return err(405, 'method', 'Метод не поддерживается');
  if (!safeEqual(req.headers['x-display-key'] ?? '', ctx.displayKey)) return err(401, 'display_key', 'Неверный ключ экрана');
  const now = Date.now();
  const since = Math.max(0, Number(req.query.since) || 0);
  let state = await ctx.store.getState();
  if (req.query.fresh === '1') {
    // Новое открытие экрана сразу запускает рождение дерева и приём идей
    state = await ctx.store.updateState((s) => ({ phase: 'intro', introRun: s.introRun + 1, accepting: true, qrVisible: true, paused: false, phaseStartedAt: now, updatedAt: now }));
  } else if (state.phase === 'intro' && now - state.phaseStartedAt > 60_000) {
    state = await ctx.store.updateState(() => ({ phase: 'collect', phaseStartedAt: now, updatedAt: now }));
  }
  const docs = await ctx.store.listSince(since);
  const body: FeedResponse = { serverNow: now, cursor: Math.max(0, now - 10_000), state, leaves: docs.map(toLeaf) };
  return { status: 200, body };
}

/** Действия с экрана проектора. Доступны только по секретному адресу экрана. */
export async function routeScreen(ctx: Context, req: ApiRequest): Promise<ApiResult> {
  if (req.method !== 'POST') return err(405, 'method', 'Метод не поддерживается');
  if (!safeEqual(req.headers['x-display-key'] ?? '', ctx.displayKey)) return err(401, 'display_key', 'Нет доступа');
  const b = (req.body ?? {}) as Record<string, unknown>; const now = Date.now();
  switch (b.action) {
    case 'finish': {
      const state = await ctx.store.updateState((s) => ({ phase: 'finale', finaleRun: s.finaleRun + 1, accepting: false, qrVisible: false, paused: false, phaseStartedAt: now, updatedAt: now }));
      return { status: 200, body: { ok: true, state } };
    }
    case 'hide': {
      if (typeof b.id !== 'string') return err(400, 'bad_request', 'Неверные данные');
      const found = await ctx.store.patchResponse(b.id, { status: 'rejected', updatedAt: now });
      return found ? { status: 200, body: { ok: true } } : err(404, 'not_found', 'Запись не найдена');
    }
    case 'list':
      return { status: 200, body: { ok: true, responses: await ctx.store.listSince(0) } };
    case 'clear': {
      await ctx.store.deleteAll();
      // Полный сброс перед настоящей рефлексией: ответов нет, дерево растёт заново, приём открыт
      const state = await ctx.store.updateState((s) => ({ phase: 'intro', introRun: s.introRun + 1, accepting: true, qrVisible: true, paused: false, dataEpoch: s.dataEpoch + 1, phaseStartedAt: now, updatedAt: now }));
      return { status: 200, body: { ok: true, state } };
    }
    default:
      return err(400, 'bad_request', 'Неизвестное действие');
  }
}

export const withDefaults = (s?: Partial<SceneState>): SceneState => ({ ...DEFAULT_STATE, ...(s ?? {}) });
