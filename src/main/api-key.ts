import { safeStorage } from 'electron';

import type { AppSettings } from '../shared/types';

export function encryptApiKey(rawKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system. Cannot store API key securely.');
  }

  const encrypted = safeStorage.encryptString(rawKey);
  return encrypted.toString('base64');
}

export function decryptApiKey(encrypted: string): string {
  if (!encrypted) {
    throw new Error('No encrypted API key to decrypt.');
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system. Cannot read API key.');
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

export function isApiKeySet(settings: AppSettings): boolean {
  return settings.openaiApiKeyEncrypted.length > 0;
}

export function getApiKey(settings: AppSettings): string | null {
  if (!isApiKeySet(settings)) {
    return null;
  }

  try {
    return decryptApiKey(settings.openaiApiKeyEncrypted);
  } catch {
    return null;
  }
}
