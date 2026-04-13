import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { EnhancementLevel, HistoryEntry, StyleMode } from '../shared/types';

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

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(getHistoryPath(), 'utf8');
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

async function saveHistory(entries: HistoryEntry[]): Promise<void> {
  const filePath = getHistoryPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export interface AddHistoryInput {
  rawText: string;
  finalText: string;
  transcriptionSource: 'cloud' | 'local';
  styleMode: StyleMode;
  enhancementLevel: EnhancementLevel;
  appName?: string;
}

export async function addHistoryEntry(input: AddHistoryInput): Promise<HistoryEntry[]> {
  return withLock('history', async () => {
    const entries = await loadHistory();

    entries.unshift({
      id: randomUUID(),
      rawText: input.rawText,
      finalText: input.finalText,
      transcriptionSource: input.transcriptionSource,
      styleMode: input.styleMode,
      enhancementLevel: input.enhancementLevel,
      appName: input.appName,
      createdAt: new Date().toISOString(),
    });

    if (entries.length > MAX_HISTORY_ENTRIES) {
      entries.length = MAX_HISTORY_ENTRIES;
    }

    await saveHistory(entries);
    return entries;
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
