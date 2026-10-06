import { app } from 'electron';

export function applyLaunchAtLogin(openAtLogin: boolean): void {
  // Development builds would register the Electron binary itself.
  if (!app.isPackaged) {
    return;
  }

  try {
    app.setLoginItemSettings(
      process.platform === 'win32'
        ? { openAtLogin, args: ['--hidden'] }
        : { openAtLogin },
    );
  } catch (error) {
    console.warn('[yap] launch at login could not be changed:', error instanceof Error ? error.message : error);
  }
}
