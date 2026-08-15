import { describe, expect, it } from 'vitest';

import { encryptApiKey, decryptApiKey } from '../../src/main/api-key';

describe('test harness', () => {
  it('imports a main-process module that depends on electron', () => {
    expect(decryptApiKey(encryptApiKey('hello'))).toBe('hello');
  });
});
