import { app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CorrectionEntry, DictionaryEntry } from '../shared/types';

const DICTIONARY_FILE = 'dictionary.json';
const CORRECTIONS_FILE = 'corrections.json';

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

function getDictionaryPath(): string {
  return path.join(app.getPath('userData'), DICTIONARY_FILE);
}

function getCorrectionsPath(): string {
  return path.join(app.getPath('userData'), CORRECTIONS_FILE);
}

export async function loadDictionary(): Promise<DictionaryEntry[]> {
  try {
    const raw = await readFile(getDictionaryPath(), 'utf8');
    return JSON.parse(raw) as DictionaryEntry[];
  } catch {
    return [];
  }
}

async function saveDictionary(entries: DictionaryEntry[]): Promise<void> {
  const filePath = getDictionaryPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export async function addDictionaryEntry(word: string): Promise<DictionaryEntry[]> {
  return withLock('dictionary', async () => {
    const entries = await loadDictionary();
    const trimmed = word.trim();

    if (!trimmed) {
      return entries;
    }

    const exists = entries.some((e) => e.word.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      return entries;
    }

    entries.push({ word: trimmed, addedAt: new Date().toISOString() });
    entries.sort((a, b) => a.word.localeCompare(b.word));
    await saveDictionary(entries);
    return entries;
  });
}

export async function removeDictionaryEntry(word: string): Promise<DictionaryEntry[]> {
  return withLock('dictionary', async () => {
    const entries = await loadDictionary();
    const filtered = entries.filter((e) => e.word !== word);
    await saveDictionary(filtered);
    return filtered;
  });
}

export async function loadCorrections(): Promise<CorrectionEntry[]> {
  try {
    const raw = await readFile(getCorrectionsPath(), 'utf8');
    return JSON.parse(raw) as CorrectionEntry[];
  } catch {
    return [];
  }
}

async function saveCorrections(entries: CorrectionEntry[]): Promise<void> {
  const filePath = getCorrectionsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

export async function addCorrection(from: string, to: string): Promise<CorrectionEntry[]> {
  return withLock('corrections', async () => {
    const entries = await loadCorrections();
    const trimmedFrom = from.trim();
    const trimmedTo = to.trim();

    if (!trimmedFrom || !trimmedTo) {
      return entries;
    }

    const exists = entries.some((e) => e.from.toLowerCase() === trimmedFrom.toLowerCase());
    if (exists) {
      return entries;
    }

    entries.push({ from: trimmedFrom, to: trimmedTo, addedAt: new Date().toISOString() });
    entries.sort((a, b) => a.from.localeCompare(b.from));
    await saveCorrections(entries);
    return entries;
  });
}

export async function removeCorrection(from: string): Promise<CorrectionEntry[]> {
  return withLock('corrections', async () => {
    const entries = await loadCorrections();
    const filtered = entries.filter((e) => e.from !== from);
    await saveCorrections(filtered);
    return filtered;
  });
}

const WHISPER_PROMPT_MAX_CHARS = 800;

export function buildWhisperPrompt(
  dictionary: DictionaryEntry[],
  corrections: CorrectionEntry[],
): string {
  const dictWords = dictionary.map((e) => e.word);
  const correctionTargets = corrections.map((e) => e.to);
  const unique = [...new Set([...dictWords, ...correctionTargets])];

  if (unique.length === 0) {
    return '';
  }

  const parts: string[] = [];
  let length = 0;

  for (const word of unique) {
    const addition = parts.length > 0 ? word.length + 2 : word.length;
    if (length + addition > WHISPER_PROMPT_MAX_CHARS) {
      console.warn(`[openwhisp] Whisper prompt truncated at ${parts.length}/${unique.length} words (224 token limit)`);
      break;
    }
    parts.push(word);
    length += addition;
  }

  return parts.join(', ');
}

export function buildDictionaryContext(
  dictionary: DictionaryEntry[],
  corrections: CorrectionEntry[],
): string {
  const parts: string[] = [];

  if (dictionary.length > 0) {
    parts.push(`DICTIONARY: The following terms must be spelled exactly as shown: ${dictionary.map((e) => e.word).join(', ')}.`);
  }

  if (corrections.length > 0) {
    const rules = corrections.map((e) => `"${e.from}" -> "${e.to}"`).join(', ');
    parts.push(`CORRECTIONS: Apply these replacements in the output: ${rules}.`);
  }

  if (parts.length === 0) {
    return '';
  }

  return '\n' + parts.join('\n');
}
