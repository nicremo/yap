import type { AppState, UpdateSettingsInput } from '../../shared/types';
import { HotkeySettings } from '../components/HotkeyRecorder';
import { PermissionList } from '../components/PermissionList';
import { Button, Card, Notice, ToggleRow } from '../components/ui';
import { useAction } from '../lib/store';

export function SettingsPage({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const { settings } = state;
  const { busy, error, run } = useAction();
  const update = (patch: UpdateSettingsInput) => run('settings', async () => onState(await window.yap.updateSettings(patch)));

  return (
    <>
      <header className="page-header">
        <h1>Settings</h1>
      </header>
      {error && <Notice tone="danger">{error}</Notice>}

      <Card title="Shortcut">
        <HotkeySettings state={state} onSave={(hotkey) => void update({ hotkey })} />
      </Card>

      <Card title="After dictating">
        <ToggleRow
          title="Paste automatically"
          description="Puts the text where your cursor is, in any app."
          checked={settings.autoPaste}
          onChange={(autoPaste) => void update({ autoPaste })}
        />
        <ToggleRow
          title="Keep on clipboard"
          description={
            settings.autoPaste
              ? settings.copyToClipboard
                ? 'Every dictation stays on the clipboard and shows up in clipboard managers.'
                : 'Off: Yap pastes, then puts back what you had copied. Clipboard managers do not record the dictation.'
              : 'Copies every dictation to the clipboard.'
          }
          checked={settings.copyToClipboard}
          onChange={(copyToClipboard) => void update({ copyToClipboard })}
        />
        <ToggleRow
          title="Show the dictation pill"
          description="A small indicator at the bottom of the screen while you dictate."
          checked={settings.showOverlay}
          onChange={(showOverlay) => void update({ showOverlay })}
        />
        <ToggleRow
          title="Open at login"
          description={state.isPackaged ? 'Starts Yap in the background when you log in.' : 'Only available in the installed app.'}
          checked={settings.launchAtLogin}
          disabled={!state.isPackaged}
          onChange={(launchAtLogin) => void update({ launchAtLogin })}
        />
      </Card>

      <Card
        title="Permissions"
        action={
          <Button size="sm" variant="ghost" icon="refresh" busy={busy === 'refresh'} onClick={() => void run('refresh', async () => onState(await window.yap.refreshPermissions()))}>
            Check again
          </Button>
        }
      >
        <PermissionList state={state} onState={onState} />
      </Card>

      <Card
        title="Storage"
        description="Recordings for the last seven days and the local Whisper models."
        action={
          <div className="button-row">
            <Button size="sm" variant="ghost" icon="folder" onClick={() => void window.yap.revealStorage()}>
              Open
            </Button>
            <Button size="sm" variant="ghost" busy={busy === 'storage'} onClick={() => void run('storage', async () => onState(await window.yap.chooseStorage()))}>
              Change
            </Button>
          </div>
        }
      >
        <code className="path">{settings.storageDirectory}</code>
      </Card>

      <Card title="About">
        <div className="about">
          <span>
            Yap {state.version}. Free and open source under the MIT licence, made by{' '}
            <button type="button" className="inline-link" onClick={() => void window.yap.openExternal('https://github.com/nicremo')}>
              Fabian Bitzer
            </button>
            .
          </span>
          <div className="button-row">
            <Button size="sm" variant="ghost" icon="external" onClick={() => void window.yap.openExternal('https://github.com/nicremo/yap')}>
              GitHub
            </Button>
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => void update({ setupComplete: false })}>
              Run setup again
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
