// Exercises the native macOS helper's JSON-lines protocol end to end.
// Runs on CI, where no privacy permission is granted, so it checks that every
// command answers, that missing permissions are reported instead of hanging,
// and that the helper exits with the app.
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.argv[2] ?? path.join(root, 'build', 'native', 'yap-helper');

const child = spawn(binary, ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = readline.createInterface({ input: child.stdout });
const pending = new Map();
const events = [];
let nextId = 1;

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else {
    events.push(message);
  }
});

function call(cmd, args = {}, timeoutMs = 3000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to ${cmd}`)), timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ id, cmd, ...args })}\n`);
  });
}

function check(condition, label) {
  if (!condition) {
    console.error(`FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`ok   ${label}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until an event with the given name arrived, so a slow start is not mistaken for a missing event. */
async function waitForEvent(name, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!events.some((event) => event.event === name)) {
    if (Date.now() > deadline) return false;
    await sleep(20);
  }
  return true;
}

try {
  // The first launch of a freshly built binary takes several hundred
  // milliseconds while macOS checks it, which is exactly the CI situation.
  check(await waitForEvent('ready'), 'announces readiness');

  const hello = await call('hello');
  check(hello.ok && hello.result.version >= 3, `hello answers (version ${hello.result?.version})`);

  const permissions = await call('permissions');
  check(
    permissions.ok && ['accessibility', 'inputMonitoring', 'postEvents'].every((key) => typeof permissions.result[key] === 'boolean'),
    `permissions are reported ${JSON.stringify(permissions.result)}`,
  );

  const listen = await call('listen', { keyCode: 63, modifiers: 0 });
  check(listen.ok && typeof listen.result.active === 'boolean', `listen answers ${JSON.stringify(listen.result)}`);
  if (!listen.result.active) {
    check(typeof listen.result.error === 'string' && listen.result.error.length > 0, 'an inactive listener explains why');
  }

  const focus = await call('focus');
  check(focus.ok && typeof focus.result === 'object', `focus answers ${JSON.stringify(focus.result)}`);
  check(typeof focus.result.editable === 'boolean' && 'role' in focus.result, 'focus says whether a text field has it');

  const fn = await call('fnUsage');
  check(fn.ok && 'value' in fn.result, `fn usage answers ${JSON.stringify(fn.result)}`);

  const prepare = await call('prepareClipboard');
  check(prepare.ok, 'prepares the clipboard');

  // Empty text: with permissions granted this really pastes, into the terminal running the test.
  const pasteStartedAt = Date.now();
  const paste = await call('paste', { text: '', restore: true, selfEditable: false, processIdentifier: 1 });
  const pasteMs = Date.now() - pasteStartedAt;
  check(paste.ok && typeof paste.result.ok === 'boolean', `paste answers ${JSON.stringify(paste.result)}`);
  // It used to bring the dictation's start app forward and wait up to 400 ms for it.
  check(pasteMs < 300, `paste goes to the current focus without activating anything (${pasteMs} ms)`);
  if (!permissions.result.accessibility && !permissions.result.postEvents) {
    check(paste.result.ok === false && paste.result.reason === 'accessibility', 'paste without Accessibility is refused cleanly');
  }

  const unknown = await call('nonsense');
  check(unknown.ok === false && /Unknown command/.test(unknown.error), 'unknown commands are rejected');

  child.stdin.write('this is not json\n');
  check(await waitForEvent('error', 2000), 'malformed input is reported, not fatal');
  const stillAlive = await call('hello');
  check(stillAlive.ok, 'keeps serving after malformed input');

  const stopped = await call('stopListening');
  check(stopped.ok && stopped.result.active === false, 'stops listening');

  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  child.stdin.end();
  const code = await Promise.race([exited, sleep(3000).then(() => 'timeout')]);
  check(code === 0, `exits when the app closes its stdin (${code})`);
} catch (error) {
  console.error('FAIL', error.message);
  process.exitCode = 1;
  child.kill();
}
