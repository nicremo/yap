import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { AppSettings } from '../shared/types';

export interface StoragePaths {
  root: string;
  models: string;
}

export function getStoragePaths(settings: AppSettings): StoragePaths {
  return {
    root: settings.storageDirectory,
    models: path.join(settings.storageDirectory, 'models'),
  };
}

export async function ensureStorage(settings: AppSettings): Promise<StoragePaths> {
  const paths = getStoragePaths(settings);
  await mkdir(paths.models, { recursive: true });
  return paths;
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
