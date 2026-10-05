/* End-to-end dictation test.

   Launches the built app (dist/) in Electron with Chromium's fake microphone,
   points it at a mock Groq server and drives the hotkey the way the native
   helper would. Covers what the unit tests cannot: the recorder in the overlay
   window, the binary IPC, the Opus upload, the rewrite request, delivery and
   history.

   Linux only. There is no native helper there, so the app falls back to the
   clipboard instead of pasting; on macOS or Windows the real helper would
   paste into whichever app has focus on the developer's machine.

   Usage: npm run build && xvfb-run -a npm run test:e2e */

import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { _electron } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_KEY = 'gsk_e2e_test_key';
const TRANSCRIPT = 'hallo welt das ist ein test';
const POLISHED = 'Hallo Welt, das ist ein Test.';
const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const TEST_TIMEOUT_MS = 120_000;

/* ── Mock Groq ──────────────────────────────────────────────────────────── */

function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  const fields = {};
  let file = null;
  if (!match) return { fields, file };

  const parts = body.toString('latin1').split(`--${match[1] ?? match[2]}`).slice(1, -1);
  for (const part of parts) {
    const separator = part.indexOf('\r\n\r\n');
    const head = part.slice(0, separator);
    const value = part.slice(separator + 4).replace(/\r\n$/, '');
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const filename = /filename="([^"]+)"/.exec(head)?.[1];
    if (filename) {
      file = { filename, type: /content-type:\s*([^\r\n]+)/i.exec(head)?.[1], bytes: Buffer.from(value, 'latin1') };
    } else if (name) {
      fields[name] = value;
    }
  }
  return { fields, file };
}

async function startMockGroq() {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = { path: req.url, authorization: req.headers.authorization, at: Date.now() };
      requests.push(entry);

      const sendJson = (value) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(value));
      };

      switch (req.url) {
        case '/openai/v1/models':
          sendJson({ data: [{ id: 'whisper-large-v3' }, { id: 'whisper-large-v3-turbo' }, { id: 'openai/gpt-oss-20b' }] });
          return;
        case '/openai/v1/audio/transcriptions':
          Object.assign(entry, parseMultipart(body, req.headers['content-type']));
          res.setHeader('content-type', 'text/plain');
          res.end(`${TRANSCRIPT}\n`);
          return;
        case '/openai/v1/chat/completions':
          entry.body = JSON.parse(body.toString('utf8'));
          sendJson({ choices: [{ index: 0, message: { role: 'assistant', content: POLISHED }, finish_reason: 'stop' }] });
          return;
        default:
          res.statusCode = 404;
          res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, base: `http://127.0.0.1:${server.address().port}/openai/v1` };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function expect(condition, message, detail) {
  if (!condition) {
    throw new Error(detail === undefined ? message : `${message}\n    got: ${JSON.stringify(detail)}`);
  }
  console.log(`  ok  ${message}`);
}

async function waitFor(what, probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

/* ── Test ───────────────────────────────────────────────────────────────── */

async function run(context) {
  const mock = await startMockGroq();
  context.cleanup.push(() => new Promise((resolve) => mock.server.close(resolve)));

  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'yap-e2e-'));
  context.cleanup.push(() => rm(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  const userData = path.join(sandbox, 'user-data');
  const storage = path.join(sandbox, 'storage');
  await mkdir(home, { recursive: true });
  await mkdir(userData, { recursive: true });
  await writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({ settingsVersion: 2, setupComplete: true, transcriptionMode: 'cloud', language: 'de', storageDirectory: storage }),
  );

  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, '.config'), YAP_E2E: '1', YAP_GROQ_API_BASE: mock.base };
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await _electron.launch({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--password-store=basic',
      `--user-data-dir=${userData}`,
      path.join(ROOT, 'dist/main/index.js'),
    ],
    cwd: ROOT,
    env,
  });
  context.cleanup.unshift(() => app.close().catch(() => undefined));
  app.process().stdout.on('data', (data) => context.logs.push(String(data)));
  app.process().stderr.on('data', (data) => context.logs.push(String(data)));

  const window = await waitFor('the main window', () => app.windows().find((page) => page.url() && !page.url().includes('#overlay')));
  await window.waitForSelector('.layout');
  console.log('app started');

  // CI has no keyring; Chromium's fallback encryption is enough for a test.
  await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption?.(true));

  // Collect every status the main process publishes.
  await window.evaluate(() => {
    window.__statuses = [];
    window.yap.onStatus((status) => window.__statuses.push(status));
  });
  const statusCount = () => window.evaluate(() => window.__statuses.length);
  const waitForResult = (since) =>
    waitFor('the dictation result', () =>
      window.evaluate((from) => window.__statuses.slice(from).find((status) => status.phase === 'done' || status.phase === 'error'), since),
    );
  const hotkey = (type) => app.evaluate((_electron, signal) => globalThis.__yapE2E.hotkey(signal), type);
  const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
  const readHistory = async () => JSON.parse((await readFile(path.join(userData, 'history.json'), 'utf8').catch(() => '[]')) || '[]');

  console.log('\nGroq key through the Engine page');
  await window.click('.nav-item:has-text("Engine")');
  await window.fill('input[placeholder="gsk_…"]', API_KEY);
  await window.click('button:has-text("Verify & save")');
  await window.waitForSelector('text=Connected', { timeout: 10_000 });
  const validation = mock.requests.find((request) => request.path === '/openai/v1/models');
  expect(validation?.authorization === `Bearer ${API_KEY}`, 'the key is verified against /models', validation);

  console.log('\nHold to dictate (paste unavailable, so the text lands on the clipboard)');
  await window.click('.nav-item:has-text("Home")');
  let since = await statusCount();
  await hotkey('down');
  await sleep(1_500);
  const releasedAt = Date.now();
  await hotkey('up');
  let result = await waitForResult(since);

  const uploads = mock.requests.filter((request) => request.path === '/openai/v1/audio/transcriptions');
  expect(uploads.length === 1, 'exactly one transcription request', uploads.length);
  const upload = uploads[0];
  expect(upload.authorization === `Bearer ${API_KEY}`, 'the upload carries the saved key');
  expect(upload.file?.filename === 'dictation.webm' && upload.file.type === 'audio/webm', 'the audio goes up as WebM', upload.file && { filename: upload.file.filename, type: upload.file.type });
  expect(upload.file.bytes.subarray(0, 4).equals(WEBM_MAGIC), 'the upload is a real WebM container');
  // 1.5 s of 16 kHz PCM is ~48 KB as WAV; Opus at 32 kbit/s is a fraction of that.
  expect(upload.file.bytes.length > 1_000 && upload.file.bytes.length < 24_000, 'the upload is compressed Opus, not WAV', upload.file.bytes.length);
  expect(upload.fields.model === 'whisper-large-v3' && upload.fields.language === 'de' && upload.fields.response_format === 'text', 'model, language and response format are sent', upload.fields);
  const uploadLatency = upload.at - releasedAt;
  console.log(`      release -> upload received: ${uploadLatency} ms`);
  expect(uploadLatency < 3_000, 'the upload starts right after the key is released', uploadLatency);

  const chats = mock.requests.filter((request) => request.path === '/openai/v1/chat/completions');
  expect(chats.length === 1, 'exactly one rewrite request', chats.length);
  const chat = chats[0].body;
  expect(chat.model === 'openai/gpt-oss-20b' && chat.reasoning_effort === 'low' && chat.include_reasoning === false, 'the rewrite uses gpt-oss with low reasoning', { model: chat.model, reasoning_effort: chat.reasoning_effort, include_reasoning: chat.include_reasoning });
  expect(chat.messages.some((message) => message.role === 'user' && message.content.includes(TRANSCRIPT)), 'the transcript is what gets polished');

  expect(result.phase === 'done' && result.title === 'Copied instead', 'the result says it was copied instead of pasted', result);
  expect(result.preview === POLISHED, 'the polished text is shown', result.preview);
  expect((await readClipboard()) === POLISHED, 'the polished text is on the clipboard');

  const first = await waitFor('the history entry', async () => (await readHistory()).find((entry) => entry.finalText === POLISHED), 3_000);
  expect(first.status === 'success' && first.rawText === TRANSCRIPT && typeof first.latencyMs === 'number', 'history records the dictation', first);
  const audioFiles = await readdir(path.join(storage, 'audio')).catch(() => []);
  expect(audioFiles.includes(first.audioFilename), 'the recording is kept for retranscription', audioFiles);

  console.log('\nA quick tap is dropped without touching the network');
  const requestsBeforeTap = mock.requests.length;
  since = await statusCount();
  await hotkey('down');
  await sleep(80);
  await hotkey('up');
  await sleep(900);
  expect(mock.requests.length === requestsBeforeTap, 'no request was made', mock.requests.slice(requestsBeforeTap).map((request) => request.path));
  const tapStatuses = await window.evaluate((from) => window.__statuses.slice(from), since);
  expect(tapStatuses.at(-1)?.phase === 'idle', 'the app is idle again', tapStatuses.at(-1));

  console.log('\nWith auto-paste and "Keep on clipboard" off, the clipboard is left alone');
  await window.click('.nav-item:has-text("Settings")');
  const autoPaste = window.getByRole('switch', { name: 'Paste automatically' });
  await autoPaste.click();
  await waitFor('auto-paste to turn off', async () => (await autoPaste.getAttribute('aria-checked')) === 'false');
  expect((await window.getByRole('switch', { name: 'Keep on clipboard' }).getAttribute('aria-checked')) === 'false', '"Keep on clipboard" is off');
  await app.evaluate(({ clipboard }) => clipboard.writeText('something the user copied'));

  since = await statusCount();
  await hotkey('down');
  await sleep(1_200);
  await hotkey('up');
  result = await waitForResult(since);
  expect(result.phase === 'done' && result.title === 'Saved', 'the dictation is saved to history only', result);
  expect((await readClipboard()) === 'something the user copied', 'the clipboard still holds what the user copied');
  const history = await waitFor('the second history entry', async () => {
    const entries = await readHistory();
    return entries.length >= 2 && entries;
  }, 3_000);
  expect(history.every((entry) => entry.status === 'success'), 'both dictations are in the history', history.map((entry) => entry.status));
}

async function main() {
  if (process.platform !== 'linux') {
    console.log('e2e: skipped. This test drives the Linux build, which has no native helper; it runs in CI.');
    return;
  }

  const context = { cleanup: [], logs: [] };
  const timeout = setTimeout(() => {
    console.error(`\nFAIL: the test did not finish within ${TEST_TIMEOUT_MS / 1000} s`);
    process.exit(1);
  }, TEST_TIMEOUT_MS);

  let failed = false;
  try {
    await run(context);
    console.log('\nAll end-to-end checks passed.');
  } catch (error) {
    failed = true;
    console.error(`\nFAIL: ${error instanceof Error ? error.message : error}`);
    const appLog = context.logs
      .join('')
      .split('\n')
      .filter((line) => line.trim() && !/dbus|Gtk|libva|vaapi|gpu|viz_main|ALSA|pulse|Fontconfig/i.test(line));
    if (appLog.length > 0) console.error(`\nApp output (last 40 lines):\n${appLog.slice(-40).join('\n')}`);
  } finally {
    for (const step of context.cleanup) await step();
    clearTimeout(timeout);
  }
  process.exit(failed ? 1 : 0);
}

await main();
