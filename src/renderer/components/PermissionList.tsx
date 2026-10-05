import type { AppState, PermissionKind } from '../../shared/types';
import { useAction } from '../lib/store';
import { Icon, type IconName } from './Icon';
import { Button, Chip, Notice } from './ui';

interface Row {
  kind: PermissionKind;
  icon: IconName;
  title: string;
  description: string;
  granted: boolean;
  optional?: boolean;
  blocked?: boolean;
}

function buildRows(state: AppState): Row[] {
  const { permissions } = state;
  const rows: Row[] = [
    {
      kind: 'microphone',
      icon: 'mic',
      title: 'Microphone',
      description: 'Records your voice while the shortcut is held.',
      granted: permissions.microphone === 'granted' || permissions.microphone === 'unknown',
      blocked: permissions.microphone === 'denied' || permissions.microphone === 'restricted',
    },
  ];

  if (permissions.nativePermissionsRequired) {
    rows.push({
      kind: 'accessibility',
      icon: 'shield',
      title: 'Accessibility',
      description: 'Pastes the text into the app you are typing in and watches the shortcut.',
      granted: permissions.accessibility,
    });

    // With Accessibility the shortcut already works; Input Monitoring only
    // switches the listener to a fully passive mode.
    if (!permissions.inputMonitoring) {
      rows.push({
        kind: 'inputMonitoring',
        icon: 'keyboard',
        title: 'Input Monitoring',
        description: permissions.hotkeyActive
          ? 'Optional. Lets Yap watch the shortcut passively.'
          : 'Needed when the shortcut does not react.',
        granted: false,
        optional: permissions.hotkeyActive,
      });
    } else {
      rows.push({
        kind: 'inputMonitoring',
        icon: 'keyboard',
        title: 'Input Monitoring',
        description: 'Lets Yap watch the shortcut passively.',
        granted: true,
      });
    }
  }

  return rows;
}

export function PermissionList({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const { busy, error, run } = useAction();
  const rows = buildRows(state);
  const { permissions } = state;
  const missingRequired = rows.some((row) => !row.granted && !row.optional);
  const canRepair = state.platform === 'darwin' && state.isPackaged;

  const request = (kind: PermissionKind) =>
    run(kind, async () => {
      onState(await window.yap.requestPermission(kind));
    });

  return (
    <div className="permission-list">
      {rows.map((row) => (
        <div key={row.kind} className={`permission-row${row.granted ? ' permission-row-ok' : ''}`}>
          <span className="permission-icon">
            <Icon name={row.icon} size={18} />
          </span>
          <div className="permission-text">
            <strong>{row.title}</strong>
            <span>{row.description}</span>
          </div>
          {row.granted ? (
            <Chip tone="success" icon="check">Allowed</Chip>
          ) : row.optional ? (
            <Button size="sm" variant="ghost" busy={busy === row.kind} onClick={() => void request(row.kind)}>
              Allow
            </Button>
          ) : (
            <Button size="sm" variant="primary" busy={busy === row.kind} onClick={() => void request(row.kind)}>
              {row.blocked ? 'Open Settings' : 'Allow'}
            </Button>
          )}
        </div>
      ))}

      {permissions.nativePermissionsRequired && (
        <div className={`permission-row permission-row-status${permissions.hotkeyActive ? ' permission-row-ok' : ''}`}>
          <span className="permission-icon">
            <Icon name="zap" size={18} />
          </span>
          <div className="permission-text">
            <strong>Shortcut listener</strong>
            <span>
              {permissions.hotkeyActive
                ? `Reacting to ${state.settings.hotkey.label}.`
                : permissions.hotkeyError ?? 'Waiting for permissions.'}
            </span>
          </div>
          {permissions.hotkeyActive ? <Chip tone="success" icon="check">Active</Chip> : <Chip tone="warning">Inactive</Chip>}
        </div>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {permissions.nativePermissionsRequired && missingRequired && (
        <p className="permission-hint">
          macOS opens System Settings. Switch Yap on in the list, the status here updates by itself.
          {canRepair && (
            <>
              {' '}Switched on already and still missing? An update can leave an outdated entry behind.{' '}
              <button
                type="button"
                className="inline-link"
                disabled={busy === 'repair'}
                onClick={() => void run('repair', async () => onState(await window.yap.repairPermissions()))}
              >
                {busy === 'repair' ? 'Repairing…' : 'Repair permissions'}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
