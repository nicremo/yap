import type { Messages } from '../../shared/i18n';
import type { AppState } from '../../shared/types';
import type { Page } from '../App';

export interface Issue {
  key: string;
  /** Short enough to stand alone as the status line. */
  title: string;
  detail: string;
  action: string;
  page: Page;
}

/** Everything that keeps a dictation from working, most important first. */
export function findIssues(state: AppState, t: Messages): Issue[] {
  const { permissions, engine, settings } = state;
  const issues: Issue[] = [];
  const toEngine = { action: t.common.openEngine, page: 'engine' as const };
  const toSettings = { action: t.common.openSettings, page: 'settings' as const };

  if (settings.transcriptionMode === 'cloud' && !engine.groqKeySet) {
    issues.push({ key: 'groq', ...t.issues.groq, ...toEngine });
  }
  if (settings.transcriptionMode === 'local' && !engine.localModelReady) {
    issues.push({ key: 'local', ...t.issues.local, ...toEngine });
  }
  if (permissions.microphone === 'denied' || permissions.microphone === 'restricted' || permissions.microphone === 'not-determined') {
    issues.push({ key: 'mic', ...t.issues.microphone, ...toSettings });
  }
  if (permissions.nativePermissionsRequired && !permissions.accessibility) {
    issues.push({ key: 'ax', ...t.issues.accessibility, ...toSettings });
  }
  if (permissions.nativePermissionsRequired && !permissions.hotkeyActive) {
    issues.push({
      key: 'hotkey',
      title: t.issues.hotkey.title,
      detail: permissions.hotkeyError ? t.hotkey.errors[permissions.hotkeyError] : t.issues.hotkey.detail,
      ...toSettings,
    });
  }
  return issues;
}
