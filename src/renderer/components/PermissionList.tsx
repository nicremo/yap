import { hotkeyLabel } from '../../shared/hotkeys';
import type { Messages } from '../../shared/i18n';
import type { AppState, PermissionKind } from '../../shared/types';
import { useT } from '../lib/i18n';
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

function buildRows(state: AppState, t: Messages): Row[] {
  const { permissions } = state;
  const rows: Row[] = [
    {
      kind: 'microphone',
      icon: 'mic',
      title: t.permissions.microphone,
      description: t.permissions.microphoneHint,
      granted: permissions.microphone === 'granted' || permissions.microphone === 'unknown',
      blocked: permissions.microphone === 'denied' || permissions.microphone === 'restricted',
    },
  ];

  if (permissions.nativePermissionsRequired) {
    rows.push({
      kind: 'accessibility',
      icon: 'shield',
      title: t.permissions.accessibility,
      description: t.permissions.accessibilityHint,
      granted: permissions.accessibility,
    });

    // With Accessibility the shortcut already works; Input Monitoring only
    // switches the listener to a fully passive mode.
    if (!permissions.inputMonitoring) {
      rows.push({
        kind: 'inputMonitoring',
        icon: 'keyboard',
        title: t.permissions.inputMonitoring,
        description: permissions.hotkeyActive ? t.permissions.inputMonitoringOptional : t.permissions.inputMonitoringNeeded,
        granted: false,
        optional: permissions.hotkeyActive,
      });
    } else {
      rows.push({
        kind: 'inputMonitoring',
        icon: 'keyboard',
        title: t.permissions.inputMonitoring,
        description: t.permissions.inputMonitoringGranted,
        granted: true,
      });
    }
  }

  return rows;
}

export function PermissionList({ state, onState }: { state: AppState; onState: (next: AppState) => void }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const rows = buildRows(state, t);
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
            <Chip tone="success" icon="check">
              {t.common.allowed}
            </Chip>
          ) : row.optional ? (
            <Button size="sm" variant="ghost" busy={busy === row.kind} onClick={() => void request(row.kind)}>
              {t.common.allow}
            </Button>
          ) : (
            <Button size="sm" variant="primary" busy={busy === row.kind} onClick={() => void request(row.kind)}>
              {row.blocked ? t.common.openSettings : t.common.allow}
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
            <strong>{t.permissions.listener}</strong>
            <span>
              {permissions.hotkeyActive
                ? t.permissions.listenerReacting(hotkeyLabel(state.settings.hotkey, t.keys))
                : permissions.hotkeyError
                  ? t.hotkey.errors[permissions.hotkeyError]
                  : t.permissions.listenerWaiting}
            </span>
          </div>
          {permissions.hotkeyActive ? (
            <Chip tone="success" icon="check">
              {t.common.active}
            </Chip>
          ) : (
            <Chip tone="warning">{t.common.inactive}</Chip>
          )}
        </div>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {permissions.nativePermissionsRequired && missingRequired && (
        <p className="permission-hint">
          {t.permissions.hint}
          {canRepair && (
            <>
              {' '}
              {t.permissions.repairHint}{' '}
              <button
                type="button"
                className="inline-link"
                disabled={busy === 'repair'}
                onClick={() => void run('repair', async () => onState(await window.yap.repairPermissions()))}
              >
                {busy === 'repair' ? t.permissions.repairing : t.permissions.repair}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
