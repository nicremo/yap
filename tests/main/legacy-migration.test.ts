import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { migrateLegacyUserData } from '../../src/main/legacy-migration';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'yap-migration-'));
}

describe('migrateLegacyUserData', () => {
  it('copies the known files when the target has no settings yet', async () => {
    const root = await tempDir();
    const legacy = path.join(root, 'openwhisp');
    const target = path.join(root, 'yap');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'settings.json'), '{"a":1}');
    await writeFile(path.join(legacy, 'history.json'), '[]');

    const copied = await migrateLegacyUserData(legacy, target);

    expect(copied).toEqual(['settings.json', 'history.json']);
    // settings.json is rewritten rather than copied byte for byte, because the
    // encrypted keys have to be cleared. Everything else survives.
    expect(JSON.parse(await readFile(path.join(target, 'settings.json'), 'utf8'))).toMatchObject({ a: 1 });
    expect(await readFile(path.join(target, 'history.json'), 'utf8')).toBe('[]');
  });

  it('does nothing when the target already has settings', async () => {
    const root = await tempDir();
    const legacy = path.join(root, 'openwhisp');
    const target = path.join(root, 'yap');
    await mkdir(legacy, { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(legacy, 'settings.json'), '{"old":true}');
    await writeFile(path.join(target, 'settings.json'), '{"new":true}');

    expect(await migrateLegacyUserData(legacy, target)).toEqual([]);
    expect(await readFile(path.join(target, 'settings.json'), 'utf8')).toBe('{"new":true}');
  });

  it('does nothing when there is no legacy directory', async () => {
    const root = await tempDir();
    expect(await migrateLegacyUserData(path.join(root, 'nope'), path.join(root, 'yap'))).toEqual([]);
  });

  it('skips files the legacy install never wrote', async () => {
    const root = await tempDir();
    const legacy = path.join(root, 'openwhisp');
    const target = path.join(root, 'yap');
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, 'settings.json'), '{}');
    await writeFile(path.join(legacy, 'app-rules.json'), '[]');

    expect(await migrateLegacyUserData(legacy, target)).toEqual(['settings.json', 'app-rules.json']);
  });

  it('does not claim to have migrated settings it could not parse', async () => {
    const root = await tempDir();
    const legacy = path.join(root, 'openwhisp');
    const target = path.join(root, 'yap');
    await mkdir(legacy, { recursive: true });
    // Truncated file, as left behind by an app killed mid-write.
    await writeFile(path.join(legacy, 'settings.json'), '{"styleMode": "conv');
    await writeFile(path.join(legacy, 'history.json'), '[]');

    const copied = await migrateLegacyUserData(legacy, target);

    // history.json is a plain copy and survives; settings.json must not be
    // reported as migrated, or the log claims a carry-over that never happened
    // and the user silently loses their settings.
    expect(copied).toEqual(['history.json']);
  });

  it('never carries the encrypted API key across', async () => {
    const root = await tempDir();
    const legacy = path.join(root, 'openwhisp');
    const target = path.join(root, 'yap');
    await mkdir(legacy, { recursive: true });
    // safeStorage ciphertext is bound to the old application identity, so a
    // migrated key would be undecryptable and look like a corrupt setting.
    await writeFile(
      path.join(legacy, 'settings.json'),
      JSON.stringify({ openaiApiKeyEncrypted: 'ciphertext', styleMode: 'conversation' }),
    );

    await migrateLegacyUserData(legacy, target);

    const migrated = JSON.parse(await readFile(path.join(target, 'settings.json'), 'utf8'));
    expect(migrated.openaiApiKeyEncrypted).toBe('');
    expect(migrated.openrouterApiKeyEncrypted).toBe('');
    expect(migrated.fireworksApiKeyEncrypted).toBe('');
    expect(migrated.styleMode).toBe('conversation');
  });
});
