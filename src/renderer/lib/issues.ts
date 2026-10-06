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
export function findIssues(state: AppState): Issue[] {
  const { permissions, engine, settings } = state;
  const issues: Issue[] = [];

  if (settings.transcriptionMode === 'cloud' && !engine.groqKeySet) {
    issues.push({ key: 'groq', title: 'Add your Groq key', detail: 'Cloud transcription needs it.', action: 'Open Engine', page: 'engine' });
  }
  if (settings.transcriptionMode === 'local' && !engine.localModelReady) {
    issues.push({ key: 'local', title: 'Download a model', detail: 'Transcription on this computer needs one.', action: 'Open Engine', page: 'engine' });
  }
  if (permissions.microphone === 'denied' || permissions.microphone === 'restricted' || permissions.microphone === 'not-determined') {
    issues.push({ key: 'mic', title: 'Allow the microphone', detail: 'Yap cannot hear you yet.', action: 'Open Settings', page: 'settings' });
  }
  if (permissions.nativePermissionsRequired && !permissions.accessibility) {
    issues.push({
      key: 'ax',
      title: 'Allow Accessibility',
      detail: 'Without it Yap can copy, but not paste.',
      action: 'Open Settings',
      page: 'settings',
    });
  }
  if (permissions.nativePermissionsRequired && !permissions.hotkeyActive) {
    issues.push({
      key: 'hotkey',
      title: 'Start the shortcut listener',
      detail: permissions.hotkeyError ?? 'The shortcut does not react yet.',
      action: 'Open Settings',
      page: 'settings',
    });
  }
  return issues;
}

const COUNT_WORDS = ['No things', 'One thing', 'Two things', 'Three things', 'Four things', 'Five things'];

export function describeIssueCount(count: number): string {
  return `${COUNT_WORDS[count] ?? `${count} things`} ${count === 1 ? 'needs' : 'need'} a fix`;
}
