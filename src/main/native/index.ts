import { NativeBridge, NullBridge } from './bridge';
import { MacHelperBridge } from './mac';
import { WindowsHelperBridge } from './windows';

export function createNativeBridge(): NativeBridge {
  if (process.platform === 'darwin') return new MacHelperBridge();
  if (process.platform === 'win32') return new WindowsHelperBridge();
  return new NullBridge();
}

export type { HotkeySignal, ListenerStatus, NativePermissions, PasteRequest, PasteResult } from './bridge';
export { NativeBridge } from './bridge';
