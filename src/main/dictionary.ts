import { app } from 'electron';
import path from 'node:path';

import type { CorrectionEntry, DictionaryEntry } from '../shared/types';
import { readJsonFile, writeJsonFile } from './json-file';

const DICTIONARY_FILE = 'dictionary.json';
const CORRECTIONS_FILE = 'corrections.json';

/* Both lists are read once and then served from memory. Only this module
   writes the files, so the cache cannot go stale, and a dictation no longer
   pays for two file reads before it can start transcribing. */
let dictionaryCache: DictionaryEntry[] | null = null;
let correctionsCache: CorrectionEntry[] | null = null;

function filePath(name: string): string {
  return path.join(app.getPath('userData'), name);
}

function isDictionaryEntry(value: unknown): value is DictionaryEntry {
  return !!value && typeof (value as DictionaryEntry).word === 'string';
}

function isCorrectionEntry(value: unknown): value is CorrectionEntry {
  return (
    !!value &&
    typeof (value as CorrectionEntry).from === 'string' &&
    typeof (value as CorrectionEntry).to === 'string'
  );
}

export async function loadDictionary(): Promise<DictionaryEntry[]> {
  if (!dictionaryCache) {
    const raw = await readJsonFile<unknown[]>(filePath(DICTIONARY_FILE));
    dictionaryCache = Array.isArray(raw) ? raw.filter(isDictionaryEntry) : [];
  }
  return dictionaryCache;
}

export async function loadCorrections(): Promise<CorrectionEntry[]> {
  if (!correctionsCache) {
    const raw = await readJsonFile<unknown[]>(filePath(CORRECTIONS_FILE));
    correctionsCache = Array.isArray(raw) ? raw.filter(isCorrectionEntry) : [];
  }
  return correctionsCache;
}

export async function addDictionaryEntry(word: string): Promise<DictionaryEntry[]> {
  const entries = await loadDictionary();
  const trimmed = word.trim();
  if (!trimmed || entries.some((entry) => entry.word.toLowerCase() === trimmed.toLowerCase())) {
    return entries;
  }

  dictionaryCache = [...entries, { word: trimmed, addedAt: new Date().toISOString() }].sort((a, b) =>
    a.word.localeCompare(b.word),
  );
  await writeJsonFile(filePath(DICTIONARY_FILE), dictionaryCache);
  return dictionaryCache;
}

export async function removeDictionaryEntry(word: string): Promise<DictionaryEntry[]> {
  const entries = await loadDictionary();
  dictionaryCache = entries.filter((entry) => entry.word !== word);
  await writeJsonFile(filePath(DICTIONARY_FILE), dictionaryCache);
  return dictionaryCache;
}

export async function addCorrection(from: string, to: string): Promise<CorrectionEntry[]> {
  const entries = await loadCorrections();
  const trimmedFrom = from.trim();
  const trimmedTo = to.trim();
  if (
    !trimmedFrom ||
    !trimmedTo ||
    entries.some((entry) => entry.from.toLowerCase() === trimmedFrom.toLowerCase())
  ) {
    return entries;
  }

  correctionsCache = [...entries, { from: trimmedFrom, to: trimmedTo, addedAt: new Date().toISOString() }].sort(
    (a, b) => a.from.localeCompare(b.from),
  );
  await writeJsonFile(filePath(CORRECTIONS_FILE), correctionsCache);
  return correctionsCache;
}

export async function removeCorrection(from: string): Promise<CorrectionEntry[]> {
  const entries = await loadCorrections();
  correctionsCache = entries.filter((entry) => entry.from !== from);
  await writeJsonFile(filePath(CORRECTIONS_FILE), correctionsCache);
  return correctionsCache;
}

/* Whisper only reads the last 224 tokens of the prompt. 800 characters stays
   under that for typical vocabulary. */
const WHISPER_PROMPT_MAX_CHARS = 800;

export function buildWhisperPrompt(dictionary: DictionaryEntry[], corrections: CorrectionEntry[]): string {
  const unique = [...new Set([...dictionary.map((e) => e.word), ...corrections.map((e) => e.to)])];
  const parts: string[] = [];
  let length = 0;

  for (const word of unique) {
    const addition = parts.length > 0 ? word.length + 2 : word.length;
    if (length + addition > WHISPER_PROMPT_MAX_CHARS) {
      break;
    }
    parts.push(word);
    length += addition;
  }

  return parts.join(', ');
}

export function buildDictionaryContext(dictionary: DictionaryEntry[], corrections: CorrectionEntry[]): string {
  const parts: string[] = [];

  if (dictionary.length > 0) {
    parts.push(`DICTIONARY: The following terms must be spelled exactly as shown: ${dictionary.map((e) => e.word).join(', ')}.`);
  }

  if (corrections.length > 0) {
    const rules = corrections.map((e) => `"${e.from}" -> "${e.to}"`).join(', ');
    parts.push(`CORRECTIONS: Apply these replacements in the output: ${rules}.`);
  }

  return parts.length === 0 ? '' : '\n' + parts.join('\n');
}

/**
 * Applies the user's misspelling corrections to text directly. The rewrite
 * model is told about them as well, but with enhancement off (or when the
 * model ignores the instruction) this is what actually fixes the words.
 */
export function applyCorrections(text: string, corrections: CorrectionEntry[]): string {
  let result = text;
  for (const { from, to } of corrections) {
    if (!from) continue;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Unicode-aware word boundaries so "Ä" and "ß" count as letters.
    result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), to);
  }
  return result;
}
