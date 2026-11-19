import type { FeedResponse, PublicConfig } from '../shared/domain';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function request<T>(url: string, init: RequestInit = {}, timeoutMs = 12000): Promise<T> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store' });
    const data = await res.json().catch(() => null) as { message?: string; code?: string } | null;
    if (!res.ok) throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? 'Сервис временно недоступен');
    if (data === null) throw new ApiError(503, 'bad_response', 'Сервис временно недоступен');
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз');
  } finally { clearTimeout(timer); }
}

export const getConfig = () => request<PublicConfig>('/api/config');

export const getFeed = (key: string, since: number, fresh = false) =>
  request<FeedResponse>(`/api/feed?since=${since}${fresh ? '&fresh=1' : ''}`, { headers: { 'x-display-key': key } }, 9000);

export const submitIdea = (b: Record<string, unknown>) => request<{ ok: true; id: string }>('/api/submit', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
});

export const screenCall = <T,>(key: string, action: string, payload: Record<string, unknown> = {}) => request<T>('/api/screen', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-display-key': key }, body: JSON.stringify({ action, ...payload }),
});

export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
