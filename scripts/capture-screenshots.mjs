/* Capture the real renderer with fixed demo state, without the main app,
   installed user data, credentials, microphone or native helper. */
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..');
const OUTPUT = path.join(ROOT, 'assets/screenshots');

if (process.versions.electron) {
  // Electron emits ready after the entry module has finished evaluating.
  void startPreview().catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  await capture();
}

async function startPreview() {
  const { app, BrowserWindow, ipcMain, nativeTheme, session } = await import('electron');
  app.setName('Yap Preview');
  app.setPath('userData', process.env.YAP_SCREENSHOT_USER_DATA);
  app.disableHardwareAcceleration();
  const version = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;

  // Readiness flags illustrate a configured demo. There is no provider key.
  const state = {
    updater: { kind: 'disabled' }, platform: 'darwin', version, isPackaged: false,
    settings: {
      settingsVersion: 2, storageDirectory: '/Example/Yap',
      transcriptionMode: 'cloud', cloudModel: 'whisper-large-v3',
      localModel: 'onnx-community/whisper-base', language: 'en',
      enhancementEnabled: true, rewriteModel: 'openai/gpt-oss-20b',
      styleMode: 'conversation', customPlusVoice: 'conversation',
      enhancementLevel: 'medium', hotkey: { keyCode: 63, modifiers: 0, label: 'fn' },
      autoPaste: true, copyToClipboard: false, showOverlay: true,
      launchAtLogin: false, theme: 'light', uiLanguage: 'en',
      copyLastShortcut: '', setupComplete: false, setupStep: 'welcome',
    },
    permissions: {
      microphone: 'granted', accessibility: true, inputMonitoring: true,
      hotkeyActive: true, hotkeyError: null, nativePermissionsRequired: true,
    },
    engine: {
      groqKeySet: true, localModelReady: false, localModelDownload: null,
      rewriteModelIds: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'],
    },
    dictionary: [], corrections: [], appRules: [], history: [],
    status: { phase: 'idle', title: 'Ready', detail: '' },
    fnKeyAction: 'nothing', copyLastShortcut: 'off',
  };
  ipcMain.handle('app:getState', () => state);
  ipcMain.handle('settings:update', (_event, updates) => {
    Object.assign(state.settings, updates);
    nativeTheme.themeSource = state.settings.theme;
    return state;
  });
  ipcMain.handle('permissions:refresh', () => state);
  ipcMain.handle('system:openExternal', () => undefined);
  ipcMain.handle('system:showMainWindow', () => undefined);
  app.on('window-all-closed', () => app.quit());

  await app.whenReady();
  nativeTheme.themeSource = 'light';
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => {
    callback({ cancel: true });
  });
  const window = new BrowserWindow({
    width: 1080, height: 740, title: 'Yap Preview', backgroundColor: '#f1f0ea',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(ROOT, 'dist/preload/index.cjs'), contextIsolation: true,
      spellcheck: false, additionalArguments: ['--yap-theme=light', '--yap-locale=en'],
    },
  });
  await window.loadFile(path.join(ROOT, 'dist/renderer/index.html'));
}

async function capture() {
  const { _electron } = await import('playwright-core');
  await mkdir(OUTPUT, { recursive: true });
  const userData = await mkdtemp(path.join(os.tmpdir(), 'yap-preview-'));
  const preview = await _electron.launch({
    timeout: 30_000,
    executablePath: createRequire(import.meta.url)('electron'), args: [SCRIPT], cwd: ROOT,
    env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), YAP_SCREENSHOT_USER_DATA: userData },
  });
  preview.context().setDefaultTimeout(15_000);
  try {
    const page = await preview.firstWindow();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.setup-welcome');
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.welcome-logo').evaluate((image) => image.decode());
    await page.screenshot({ path: path.join(OUTPUT, 'welcome-light.png') });

    await page.getByRole('button', { name: 'Cancel setup', exact: true }).click();
    await page.waitForSelector('.layout');
    await page.locator('.brand-logo').evaluate((image) => image.decode());
    await page.screenshot({ path: path.join(OUTPUT, 'home-light.png') });

    await page.evaluate(async () => {
      await window.yap.updateSettings({ theme: 'dark' });
      document.documentElement.dataset.theme = 'dark';
    });
    await page.screenshot({ path: path.join(OUTPUT, 'home-dark.png') });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Captured welcome, home light and home dark from the built renderer.');
  } finally {
    await preview.close();
  }
}
