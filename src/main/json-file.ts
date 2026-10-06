import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/* Every file has its own write queue, so two writes to the same file can
   never interleave, and every write goes through a temp file and a rename, so
   a crash mid-write leaves the previous version intact instead of a truncated
   file that parses as nothing. */
const queues = new Map<string, Promise<void>>();

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function writeJsonFile(filePath: string, data: unknown, pretty = true): Promise<void> {
  const serialized = `${JSON.stringify(data, null, pretty ? 2 : undefined)}\n`;
  const previous = queues.get(filePath) ?? Promise.resolve();

  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(tempPath, serialized, 'utf8');
      await rename(tempPath, filePath);
    });

  queues.set(filePath, next);
  void next.finally(() => {
    if (queues.get(filePath) === next) {
      queues.delete(filePath);
    }
  }).catch(() => undefined);

  return next;
}

/** Resolves once every queued write has hit the disk. Used on quit. */
export async function flushJsonWrites(): Promise<void> {
  await Promise.allSettled([...queues.values()]);
}
