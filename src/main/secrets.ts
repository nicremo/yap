import { safeStorage } from 'electron';

import type { AppSettings } from '../shared/types';

export function encryptSecret(rawValue: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system, so the API key cannot be saved.');
  }

  return safeStorage.encryptString(rawValue).toString('base64');
}

export function decryptSecret(encrypted: string): string {
  if (!encrypted) {
    throw new Error('There is no stored API key.');
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system, so the API key cannot be read.');
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

/* Decrypting touches the keychain, which can show a system prompt for an
   unsigned build. Doing it once per key, ideally at startup, keeps that prompt
   out of the middle of a dictation and the hot path free of keychain work. */
let cache: { encrypted: string; plain: string | null } | null = null;

export function getGroqApiKey(settings: AppSettings): string | null {
  const encrypted = settings.groqApiKeyEncrypted;
  if (!encrypted) {
    return null;
  }

  if (cache?.encrypted === encrypted) {
    return cache.plain;
  }

  let plain: string | null;
  try {
    plain = decryptSecret(encrypted);
  } catch (error) {
    console.warn('[yap] stored Groq key could not be decrypted:', error instanceof Error ? error.message : error);
    plain = null;
  }

  cache = { encrypted, plain };
  return plain;
}

export function isGroqKeySet(settings: AppSettings): boolean {
  return getGroqApiKey(settings) !== null;
}
