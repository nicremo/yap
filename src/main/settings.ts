import { dialog, app } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { encryptApiKey } from './api-key';
import { createDefaultSettings } from './defaults';
import type { AppSettings, UpdateSettingsInput } from '../shared/types';

const SETTINGS_FILE = 'settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();

  try {
    const raw = await readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...createDefaultSettings(), ...parsed };
  } catch {
    const defaults = createDefaultSettings();
    await saveSettings(defaults);
    return defaults;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const settingsPath = getSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

export async function updateSettings(
  current: AppSettings,
  updates: UpdateSettingsInput,
): Promise<AppSettings> {
  const { openaiApiKey, openrouterApiKey, fireworksApiKey, ...settingUpdates } = updates;

  const nextSettings: AppSettings = {
    ...current,
    ...settingUpdates,
  };

  if (openaiApiKey !== undefined) {
    nextSettings.openaiApiKeyEncrypted = openaiApiKey.length > 0
      ? encryptApiKey(openaiApiKey)
      : '';
  }

  if (openrouterApiKey !== undefined) {
    nextSettings.openrouterApiKeyEncrypted = openrouterApiKey.length > 0
      ? encryptApiKey(openrouterApiKey)
      : '';
  }

  if (fireworksApiKey !== undefined) {
    nextSettings.fireworksApiKeyEncrypted = fireworksApiKey.length > 0
      ? encryptApiKey(fireworksApiKey)
      : '';
  }

  await saveSettings(nextSettings);
  return nextSettings;
}

export async function chooseStorageDirectory(currentDirectory: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose storage folder',
    defaultPath: currentDirectory,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}
