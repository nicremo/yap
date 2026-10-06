import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { DictationStatus, EnhancementLevel, HistoryEntry, StyleMode } from '../shared/types';
import { computeAudioExpiresAt } from './audio-store';
import { readJsonFile, writeJsonFile } from './json-file';

const HISTORY_FILE = 'history.json';
const MAX_HISTORY_ENTRIES = 500;
const SAVE_DELAY_MS = 400;

/* History lives in memory and is written to disk shortly after each change.
   Every dictation touches it two or three times, which used to mean as many
   full read-parse-write cycles of a file with up to 500 entries, some of them
   before transcription could even start. */
let entries: HistoryEntry[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function getHistoryPath(): string {
  return path.join(app.getPath('userData'), HISTORY_FILE);
}

function migrateEntry(entry: Partial<HistoryEntry> & { id: string; createdAt: string }): HistoryEntry {
  return {
    id: entry.id,
    rawText: entry.rawText ?? '',
    finalText: entry.finalText ?? '',
    transcriptionSource: entry.transcriptionSource ?? null,
    styleMode: (entry.styleMode ?? 'conversation') as StyleMode,
    enhancementLevel: (entry.enhancementLevel ?? 'medium') as EnhancementLevel,
    appName: entry.appName,
    createdAt: entry.createdAt,
    audioFilename: entry.audioFilename ?? null,
    audioExpiresAt: entry.audioExpiresAt ?? null,
    status: (entry.status as DictationStatus) ?? 'success',
    errorMessage: entry.errorMessage,
    latencyMs: entry.latencyMs,
  };
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  if (!entries) {
    const raw = await readJsonFile<Array<Partial<HistoryEntry> & { id: string; createdAt: string }>>(getHistoryPath());
    entries = Array.isArray(raw)
      ? raw.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.createdAt === 'string').map(migrateEntry)
      : [];
  }
  return entries;
}

function scheduleSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeJsonFile(getHistoryPath(), entries ?? [], false).catch((error) => {
      console.warn('[yap] history could not be saved:', error instanceof Error ? error.message : error);
    });
  }, SAVE_DELAY_MS);
}

/** Writes pending changes immediately. Called on quit. */
export async function flushHistory(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await writeJsonFile(getHistoryPath(), entries ?? [], false);
  }
}

function commit(next: HistoryEntry[]): HistoryEntry[] {
  entries = next.length > MAX_HISTORY_ENTRIES ? next.slice(0, MAX_HISTORY_ENTRIES) : next;
  scheduleSave();
  return entries;
}

export interface CreateHistoryInput {
  rawText: string;
  finalText: string;
  transcriptionSource: 'cloud' | 'local' | null;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  appName?: string;
  appBundleId?: string;
  audioFilename: string | null;
  status: DictationStatus;
  errorMessage?: string;
  id?: string;
  createdAt?: string;
}

export async function addHistoryEntry(input: CreateHistoryInput): Promise<{ entry: HistoryEntry; entries: HistoryEntry[] }> {
  const current = await loadHistory();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const entry: HistoryEntry = {
    id: input.id ?? randomUUID(),
    rawText: input.rawText,
    finalText: input.finalText,
    transcriptionSource: input.transcriptionSource,
    styleMode: input.styleMode,
    enhancementLevel: input.enhancementLevel,
    appName: input.appName,
    appBundleId: input.appBundleId,
    createdAt,
    audioFilename: input.audioFilename,
    audioExpiresAt: input.audioFilename ? computeAudioExpiresAt(createdAt) : null,
    status: input.status,
    errorMessage: input.errorMessage,
  };

  return { entry, entries: commit([entry, ...current]) };
}

export type HistoryPatch = Partial<Omit<HistoryEntry, 'id' | 'createdAt'>>;

export async function updateHistoryEntry(
  id: string,
  patch: HistoryPatch,
): Promise<{ entry: HistoryEntry | null; entries: HistoryEntry[] }> {
  const current = await loadHistory();
  const index = current.findIndex((candidate) => candidate.id === id);
  if (index === -1) {
    return { entry: null, entries: current };
  }

  const merged: HistoryEntry = { ...current[index], ...patch };
  if (merged.audioFilename && !merged.audioExpiresAt) {
    merged.audioExpiresAt = computeAudioExpiresAt(merged.createdAt);
  }
  const next = [...current];
  next[index] = merged;
  return { entry: merged, entries: commit(next) };
}

export async function removeHistoryEntry(id: string): Promise<HistoryEntry[]> {
  const current = await loadHistory();
  return commit(current.filter((entry) => entry.id !== id));
}

export async function clearHistory(): Promise<HistoryEntry[]> {
  await loadHistory();
  return commit([]);
}

export async function clearAudioReferences(entryIds: string[]): Promise<HistoryEntry[]> {
  const current = await loadHistory();
  if (entryIds.length === 0) {
    return current;
  }
  const ids = new Set(entryIds);
  return commit(
    current.map((entry) => (ids.has(entry.id) ? { ...entry, audioFilename: null, audioExpiresAt: null } : entry)),
  );
}
