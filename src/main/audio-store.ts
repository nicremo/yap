import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppSettings, HistoryEntry } from '../shared/types';

export const AUDIO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIO_DIRECTORY = 'audio';

function getAudioDirectory(settings: AppSettings): string {
  return path.join(settings.storageDirectory, AUDIO_DIRECTORY);
}

export async function ensureAudioDirectory(settings: AppSettings): Promise<string> {
  const directory = getAudioDirectory(settings);
  await mkdir(directory, { recursive: true });
  return directory;
}

export function buildAudioFilename(entryId: string): string {
  return `${entryId}.wav`;
}

export function resolveAudioPath(settings: AppSettings, filename: string): string {
  return path.join(getAudioDirectory(settings), filename);
}

export function computeAudioExpiresAt(createdAtIso: string): string {
  const created = new Date(createdAtIso).getTime();
  return new Date(created + AUDIO_RETENTION_MS).toISOString();
}

export async function writeAudioRecording(
  settings: AppSettings,
  entryId: string,
  wavBase64: string,
): Promise<{ filename: string; absolutePath: string }> {
  const directory = await ensureAudioDirectory(settings);
  const filename = buildAudioFilename(entryId);
  const absolutePath = path.join(directory, filename);
  const buffer = Buffer.from(wavBase64, 'base64');
  await writeFile(absolutePath, buffer);
  return { filename, absolutePath };
}

export async function readAudioRecording(
  settings: AppSettings,
  filename: string,
): Promise<string> {
  const absolutePath = resolveAudioPath(settings, filename);
  const buffer = await readFile(absolutePath);
  return buffer.toString('base64');
}

export async function deleteAudioRecording(
  settings: AppSettings,
  filename: string,
): Promise<void> {
  const absolutePath = resolveAudioPath(settings, filename);
  await unlink(absolutePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  });
}

export interface SweepResult {
  expiredEntryIds: string[];
  orphanFiles: string[];
}

export async function sweepAudioStore(
  settings: AppSettings,
  entries: HistoryEntry[],
  now: Date = new Date(),
): Promise<SweepResult> {
  const directory = await ensureAudioDirectory(settings);
  const expiredEntryIds: string[] = [];
  const orphanFiles: string[] = [];

  const knownFilenames = new Set<string>();
  for (const entry of entries) {
    if (!entry.audioFilename) continue;
    knownFilenames.add(entry.audioFilename);

    const expiresAtIso = entry.audioExpiresAt ?? computeAudioExpiresAt(entry.createdAt);
    if (new Date(expiresAtIso).getTime() <= now.getTime()) {
      await deleteAudioRecording(settings, entry.audioFilename);
      expiredEntryIds.push(entry.id);
    }
  }

  const filesOnDisk = await readdir(directory).catch(() => [] as string[]);
  for (const filename of filesOnDisk) {
    if (!filename.endsWith('.wav')) continue;
    if (knownFilenames.has(filename)) continue;

    const absolutePath = path.join(directory, filename);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat) continue;

    const ageMs = now.getTime() - fileStat.mtimeMs;
    if (ageMs > AUDIO_RETENTION_MS) {
      await deleteAudioRecording(settings, filename);
      orphanFiles.push(filename);
    }
  }

  return { expiredEntryIds, orphanFiles };
}
