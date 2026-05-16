import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DictationStatus, EnhancementLevel, HistoryEntry, StyleMode } from '../shared/types';
import { computeAudioExpiresAt } from './audio-store';

const HISTORY_FILE = 'history.json';
const MAX_HISTORY_ENTRIES = 500;

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let resolve: () => void;
  const current = new Promise<void>((r) => { resolve = r; });
  locks.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    resolve!();
  }
}

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
  };
}

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(getHistoryPath(), 'utf8');
    const parsed = JSON.parse(raw) as Array<Partial<HistoryEntry> & { id: string; createdAt: string }>;
    return parsed.map(migrateEntry);
  } catch {
    return [];
  }
}

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const filePath = getHistoryPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export interface CreateHistoryInput {
  rawText: string;
  finalText: string;
  transcriptionSource: 'cloud' | 'local' | null;
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  appName?: string;
  audioFilename: string | null;
  status: DictationStatus;
  errorMessage?: string;
  id?: string;
  createdAt?: string;
}

export async function addHistoryEntry(input: CreateHistoryInput): Promise<{ entry: HistoryEntry; entries: HistoryEntry[] }> {
  return withLock('history', async () => {
    const entries = await loadHistory();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const entry: HistoryEntry = {
      id: input.id ?? randomUUID(),
      rawText: input.rawText,
      finalText: input.finalText,
      transcriptionSource: input.transcriptionSource,
      styleMode: input.styleMode,
      enhancementLevel: input.enhancementLevel,
      appName: input.appName,
      createdAt,
      audioFilename: input.audioFilename,
      audioExpiresAt: input.audioFilename ? computeAudioExpiresAt(createdAt) : null,
      status: input.status,
      errorMessage: input.errorMessage,
    };

    entries.unshift(entry);
    if (entries.length > MAX_HISTORY_ENTRIES) {
      entries.length = MAX_HISTORY_ENTRIES;
    }

    await saveHistory(entries);
    return { entry, entries };
  });
}

export type HistoryPatch = Partial<Omit<HistoryEntry, 'id' | 'createdAt'>>;

export async function updateHistoryEntry(id: string, patch: HistoryPatch): Promise<{ entry: HistoryEntry | null; entries: HistoryEntry[] }> {
  return withLock('history', async () => {
    const entries = await loadHistory();
    const index = entries.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      return { entry: null, entries };
    }

    const merged: HistoryEntry = { ...entries[index], ...patch };
    entries[index] = merged;
    await saveHistory(entries);
    return { entry: merged, entries };
  });
}

export async function removeHistoryEntry(id: string): Promise<HistoryEntry[]> {
  return withLock('history', async () => {
    const entries = await loadHistory();
    const filtered = entries.filter((e) => e.id !== id);
    await saveHistory(filtered);
    return filtered;
  });
}

export async function clearHistory(): Promise<HistoryEntry[]> {
  return withLock('history', async () => {
    await saveHistory([]);
    return [];
  });
}

export async function clearAudioReferences(entryIds: string[]): Promise<HistoryEntry[]> {
  if (entryIds.length === 0) {
    return loadHistory();
  }
  return withLock('history', async () => {
    const entries = await loadHistory();
    const ids = new Set(entryIds);
    const next = entries.map((entry) =>
      ids.has(entry.id)
        ? { ...entry, audioFilename: null, audioExpiresAt: null }
        : entry,
    );
    await saveHistory(next);
    return next;
  });
}
