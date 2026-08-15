import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/* The rebrand changed the bundle identifier, which moves
   app.getPath('userData'). These are the files worth carrying across from an
   install that predates it. */
const MIGRATED_FILES = [
  'settings.json',
  'history.json',
  'dictionary.json',
  'corrections.json',
  'app-rules.json',
] as const;

/* safeStorage ciphertext is bound to the application identity that produced
   it, so a migrated key cannot be decrypted under the new one. Carrying it
   over would surface as a corrupt-looking setting rather than an empty field,
   so the keys are cleared and the user re-enters them once. */
const CLEARED_SETTINGS_KEYS = [
  'openaiApiKeyEncrypted',
  'openrouterApiKeyEncrypted',
  'fireworksApiKeyEncrypted',
] as const;

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function copySettingsWithoutKeys(source: string, destination: string): Promise<void> {
  const raw = await readFile(source, 'utf8');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A settings file we cannot parse is not worth migrating.
    return;
  }

  for (const key of CLEARED_SETTINGS_KEYS) {
    parsed[key] = '';
  }

  await writeFile(destination, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

/**
 * Copies user data from a pre-rebrand install. Runs once: a settings file in
 * the target directory means this install already has state of its own, which
 * must not be overwritten.
 *
 * @returns the names of the files that were copied, empty when nothing was.
 */
export async function migrateLegacyUserData(
  legacyDirectory: string,
  targetDirectory: string,
): Promise<string[]> {
  if (await readIfPresent(path.join(targetDirectory, 'settings.json'))) {
    return [];
  }
  if (!(await readIfPresent(path.join(legacyDirectory, 'settings.json')))) {
    return [];
  }

  await mkdir(targetDirectory, { recursive: true });

  const copied: string[] = [];
  for (const name of MIGRATED_FILES) {
    const source = path.join(legacyDirectory, name);
    const destination = path.join(targetDirectory, name);

    if (!(await readIfPresent(source))) {
      continue;
    }

    if (name === 'settings.json') {
      await copySettingsWithoutKeys(source, destination);
    } else {
      await copyFile(source, destination);
    }

    copied.push(name);
  }

  return copied;
}
