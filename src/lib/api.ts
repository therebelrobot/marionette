// Figure storage: server is the source of truth (desktop and iPad share
// figures); localStorage keeps a draft so an unreachable server loses nothing.

import type { FigureDocument } from '../core/types';

export interface FigureSummary { id: string; name: string; updatedAt: number }

const DRAFT_PREFIX = 'marionette:draft:';
const LAST_KEY = 'marionette:last';

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}`);
  return (await response.json()) as T;
}

export const figureApi = {
  list: () => request<FigureSummary[]>('/api/figures'),
  get: (id: string) => request<{ id: string; document: FigureDocument }>(`/api/figures/${encodeURIComponent(id)}`),
  create: (document: FigureDocument) => request<{ id: string }>('/api/figures', { method: 'POST', body: JSON.stringify({ document }) }),
  save: (id: string, document: FigureDocument) =>
    request<{ id: string; updatedAt: number }>(`/api/figures/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ document }) }),
  remove: (id: string) => request<{ ok: true }>(`/api/figures/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export function saveDraft(id: string, document: FigureDocument): void {
  try { storage()?.setItem(DRAFT_PREFIX + id, JSON.stringify({ savedAt: Date.now(), document })); } catch { /* quota */ }
}
export function loadDraft(id: string): { savedAt: number; document: FigureDocument } | null {
  try { const raw = storage()?.getItem(DRAFT_PREFIX + id); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearDraft(id: string): void {
  try { storage()?.removeItem(DRAFT_PREFIX + id); } catch { /* ignore */ }
}
export function rememberLast(id: string): void {
  try { storage()?.setItem(LAST_KEY, id); } catch { /* ignore */ }
}
export function lastId(): string | null {
  try { return storage()?.getItem(LAST_KEY) ?? null; } catch { return null; }
}
