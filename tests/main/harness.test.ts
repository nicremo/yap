import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../../src/main/secrets';

describe('test harness', () => {
  it('imports a main-process module that depends on electron', () => {
    expect(decryptSecret(encryptSecret('hello'))).toBe('hello');
  });
});
