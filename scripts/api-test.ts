import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isRude, routeFeed, routeScreen, routeSubmit, type ApiRequest, type Context } from '../server/core.js';
import { FileStore } from '../server/fileStore.js';
import { redisContext } from '../server/redisStore.js';
import { SCREEN_KEY } from '../server/screenKey.js';
import type { FeedResponse, ResponseDoc } from '../shared/domain.js';
import { buildCloud } from '../shared/wordCloud.js';

const useRedis = !!process.env.KV_REST_API_URL;
const ctx: Context = useRedis ? redisContext() : { mode: 'local', store: new FileStore(join(mkdtempSync(join(tmpdir(), 'tree-')), 'db.json')), displayKey: SCREEN_KEY, salt: 'salt-for-tests' };
const req = (p: Partial<ApiRequest>): ApiRequest => ({ method: 'POST', query: {}, headers: { 'content-type': 'application/json' }, body: {}, ip: '1.1.1.1', ...p });
const idea = (o: Record<string, unknown> = {}) => ({ name: 'Анна Иванова', idea: 'Использовать ИИ для анализа текста', submissionId: randomUUID(), deviceId: randomUUID(), elapsedMs: 5000, ...o });
const screen = (body: unknown) => routeScreen(ctx, req({ headers: { 'x-display-key': SCREEN_KEY }, body }));
const feed = (query: Record<string, string> = { since: '0' }) => routeFeed(ctx, req({ method: 'GET', headers: { 'x-display-key': SCREEN_KEY }, query }));
const list = async () => ((await screen({ action: 'list' })).body as { responses: ResponseDoc[] }).responses;
let n = 0; const t = async (name: string, f: () => Promise<void>) => { await f(); n++; console.log(`  ✓ ${name}`); };

await t('идея сразу появляется на экране', async () => {
  assert.equal((await routeSubmit(ctx, req({ body: idea() }))).status, 201);
  const f = (await feed()).body as FeedResponse;
  assert.equal(f.leaves.length, 1); assert.equal(f.leaves[0].visible, true); assert.equal(f.leaves[0].name, 'Анна Иванова');
});
await t('повторная отправка не создаёт дубликат', async () => {
  const b = idea(); await routeSubmit(ctx, req({ body: b })); await routeSubmit(ctx, req({ body: b }));
  assert.equal((await list()).length, 2);
});
await t('ответ можно убрать с экрана, запись сохраняется', async () => {
  const id = (await list())[0].id; await screen({ action: 'hide', id });
  assert.equal(((await feed()).body as FeedResponse).leaves.find((l) => l.id === id)?.visible, false);
  assert.ok((await list()).some((r) => r.id === id));
});
await t('номера мест для листьев уникальны', async () => {
  const idx = (await list()).map((r) => r.leafIndex); assert.equal(new Set(idx).size, idx.length);
});
await t('проверка полей, антиспам и грубые слова', async () => {
  assert.equal((await routeSubmit(ctx, req({ body: idea({ name: 'А' }) }))).status, 422);
  assert.equal((await routeSubmit(ctx, req({ body: idea({ idea: 'x'.repeat(501) }) }))).status, 422);
  assert.equal((await routeSubmit(ctx, req({ body: idea({ elapsedMs: 100 }) }))).status, 429);
  assert.equal((await routeSubmit(ctx, req({ body: idea({ idea: 'какая-то бляха сука' }) }))).status, 422);
  assert.ok(!isRude('Ребёнок себе учебник оскорбление небо хлеба страхуй потребление'));
  const before = (await list()).length;
  assert.equal((await routeSubmit(ctx, req({ body: idea({ website: 'spam' }) }))).status, 200);
  assert.equal((await list()).length, before);
});
await t('ограничение частоты с одного устройства', async () => {
  const deviceId = randomUUID(); const codes: number[] = [];
  for (let i = 0; i < 10; i++) codes.push((await routeSubmit(ctx, req({ body: idea({ deviceId }) }))).status);
  assert.equal(codes.filter((c) => c === 201).length, 8); assert.equal(codes.at(-1), 429);
});
await t('без адреса экрана нельзя читать и менять ответы', async () => {
  assert.equal((await routeFeed(ctx, req({ method: 'GET' }))).status, 401);
  assert.equal((await routeScreen(ctx, req({ body: { action: 'clear' } }))).status, 401);
  assert.equal((await routeScreen(ctx, req({ headers: { 'x-display-key': 'wrong' }, body: { action: 'list' } }))).status, 401);
});
await t('итог закрывает приём и не стирает ответы', async () => {
  const before = (await list()).length; await screen({ action: 'finish' });
  assert.equal((await routeSubmit(ctx, req({ body: idea() }))).status, 403); assert.equal((await list()).length, before);
});
await t('новое открытие экрана снова запускает дерево и приём', async () => {
  const s = ((await feed({ since: '0', fresh: '1' })).body as FeedResponse).state;
  assert.equal(s.phase, 'intro'); assert.equal(s.accepting, true);
  assert.equal((await routeSubmit(ctx, req({ body: idea() }))).status, 201);
});
await t('общие темы считаются по ответам', async () => {
  const c = buildCloud(['Проверять факты нейросети', 'Проверка фактов и анализ текста', 'Факты важнее: ИИ ошибается', 'ИИ помогает с анализом текста']);
  assert.equal(c.find((w) => w.text === 'Факты')?.count, 3); assert.equal(c.find((w) => w.text === 'Анализ')?.count, 2);
  assert.equal(buildCloud(['Развивать критическое мышление и обратную связь'])[0].text, 'Критическое мышление');
});
await t('очистка удаляет все ответы и начинает заново даже после итога', async () => {
  await screen({ action: 'finish' });
  const s = ((await screen({ action: 'clear' })).body as FeedResponse).state;
  assert.equal((await list()).length, 0); assert.equal(s.phase, 'intro'); assert.equal(s.accepting, true);
  assert.equal((await routeSubmit(ctx, req({ body: idea() }))).status, 201);
  await screen({ action: 'clear' });
});
console.log(`\nПройдено проверок: ${n}`);
