import path from 'node:path';

import { app } from 'electron';

import { DEFAULT_REWRITE_MODEL, REWRITE_MODELS } from '../shared/models';
import { listGroqModels } from './groq';
import { readJsonFile, writeJsonFile } from './json-file';

const CACHE_FILE = 'groq-models.json';
/** Groq's list changes rarely; once a day is plenty and costs one tiny request. */
export const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface ModelListCache {
  checkedAt: string;
  ids: string[];
}

let cache: ModelListCache | null = null;
let cacheLoaded = false;
/** Learned from a failed request in this session, so later dictations skip the round trip. */
const unavailable = new Set<string>();
const listeners = new Set<() => void>();

function cachePath(): string {
  return path.join(app.getPath('userData'), CACHE_FILE);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function onGroqModelsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadGroqModelList(): Promise<ModelListCache | null> {
  if (!cacheLoaded) {
    const raw = await readJsonFile<Partial<ModelListCache>>(cachePath());
    cache =
      raw && typeof raw.checkedAt === 'string' && Array.isArray(raw.ids)
        ? { checkedAt: raw.checkedAt, ids: raw.ids.filter((id): id is string => typeof id === 'string') }
        : null;
    cacheLoaded = true;
  }
  return cache;
}

/** Stores what Groq says this key can use. An empty list says nothing and is ignored. */
export async function storeGroqModelList(ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) return;
  cache = { checkedAt: now.toISOString(), ids };
  cacheLoaded = true;
  // A fresh list is better evidence than an old failure.
  for (const id of ids) unavailable.delete(id);
  await writeJsonFile(cachePath(), cache);
  notify();
}

/** Asks Groq for the key's models when the stored list is older than a day. */
export async function refreshGroqModelList(apiKey: string, now = Date.now()): Promise<void> {
  const current = await loadGroqModelList();
  if (current && now - Date.parse(current.checkedAt) < MODEL_LIST_MAX_AGE_MS) return;
  await storeGroqModelList(await listGroqModels(apiKey), new Date(now));
}

/** Records that Groq no longer serves a model. Returns true the first time, for a one-off notice. */
export function markRewriteModelUnavailable(id: string): boolean {
  if (unavailable.has(id)) return false;
  unavailable.add(id);
  notify();
  return true;
}

/** The curated models this key can use, in catalogue order. Never empty. */
export function offeredRewriteModelIds(): string[] {
  const listed = cache && cache.ids.length > 0 ? new Set(cache.ids) : null;
  const offered = REWRITE_MODELS.map((model) => model.id).filter(
    (id) => (!listed || listed.has(id)) && !unavailable.has(id),
  );
  return offered.length > 0 ? offered : [DEFAULT_REWRITE_MODEL];
}

/** The model a dictation actually uses: the chosen one, or the default when it is not available. */
export function resolveRewriteModel(selected: string): string {
  return offeredRewriteModelIds().includes(selected) ? selected : DEFAULT_REWRITE_MODEL;
}

/** Test seam. */
export function resetGroqModelsForTests(): void {
  cache = null;
  cacheLoaded = true;
  unavailable.clear();
}
