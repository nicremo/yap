import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppSettings, HistoryEntry } from '../shared/types';

export const AUDIO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIO_DIRECTORY = 'audio';

function getAudioDirectory(settings: AppSettings): string {
  return path.join(settings.storageDirectory, AUDIO_DIRECTORY);
}

export function buildAudioFilename(entryId: string): string {
  return `${entryId}.wav`;
}

export function resolveAudioPath(settings: AppSettings, filename: string): string {
  // Filenames come from history.json. basename() keeps a tampered entry from
  // pointing outside the audio folder.
  return path.join(getAudioDirectory(settings), path.basename(filename));
}

export function computeAudioExpiresAt(createdAtIso: string): string {
  return new Date(new Date(createdAtIso).getTime() + AUDIO_RETENTION_MS).toISOString();
}

export async function writeAudioRecording(
  settings: AppSettings,
  entryId: string,
  wav: Buffer,
): Promise<{ filename: string; absolutePath: string }> {
  const directory = getAudioDirectory(settings);
  await mkdir(directory, { recursive: true });
  const filename = buildAudioFilename(entryId);
  const absolutePath = path.join(directory, filename);
  await writeFile(absolutePath, wav);
  return { filename, absolutePath };
}

export async function readAudioRecording(settings: AppSettings, filename: string): Promise<Buffer> {
  return readFile(resolveAudioPath(settings, filename));
}

export async function deleteAudioRecording(settings: AppSettings, filename: string): Promise<void> {
  await unlink(resolveAudioPath(settings, filename)).catch((error) => {
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
  const directory = getAudioDirectory(settings);
  await mkdir(directory, { recursive: true });
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
    if (!filename.endsWith('.wav') || knownFilenames.has(filename)) continue;

    const fileStat = await stat(path.join(directory, filename)).catch(() => null);
    if (fileStat && now.getTime() - fileStat.mtimeMs > AUDIO_RETENTION_MS) {
      await deleteAudioRecording(settings, filename);
      orphanFiles.push(filename);
    }
  }

  return { expiredEntryIds, orphanFiles };
}
