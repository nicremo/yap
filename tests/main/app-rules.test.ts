import { describe, expect, it } from 'vitest';

import { resolveStyleForApp } from '../../src/main/app-rules';
import type { AppRule } from '../../src/shared/types';

const rules: AppRule[] = [
  { appIdentifier: 'com.mitchellh.ghostty', label: 'Ghostty', styleMode: 'vibe-coding', enhancementLevel: 'high' },
  { appIdentifier: 'com.apple.Terminal', label: 'Terminal', styleMode: 'vibe-coding', enhancementLevel: 'off' },
];

describe('resolveStyleForApp', () => {
  it('uses the rule of the app that has focus, by bundle identifier', () => {
    expect(resolveStyleForApp({ bundleIdentifier: 'com.mitchellh.ghostty', appName: 'Ghostty' }, rules, 'conversation', 'soft')).toEqual({
      styleMode: 'vibe-coding',
      enhancementLevel: 'high',
      polish: true,
      matchedApp: 'Ghostty',
    });
  });

  it('falls back to the defaults for apps without a rule', () => {
    expect(resolveStyleForApp({ bundleIdentifier: 'com.apple.Notes', appName: 'Notes' }, rules, 'conversation', 'soft')).toEqual({
      styleMode: 'conversation',
      enhancementLevel: 'soft',
      polish: true,
    });
  });

  it('does not match on the app name alone', () => {
    expect(resolveStyleForApp({ appName: 'Ghostty' }, rules, 'conversation', 'soft').matchedApp).toBeUndefined();
    expect(resolveStyleForApp(undefined, rules, 'conversation', 'soft').matchedApp).toBeUndefined();
  });

  it('turns polishing off for an app whose rule says Off', () => {
    const style = resolveStyleForApp({ bundleIdentifier: 'com.apple.Terminal' }, rules, 'conversation', 'soft');
    expect(style).toMatchObject({ polish: false, matchedApp: 'Terminal', styleMode: 'vibe-coding' });
  });
});
