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

try {
  await sleep(300);
  check(events.some((event) => event.event === 'ready'), 'announces readiness');

  const hello = await call('hello');
  check(hello.ok && hello.result.version >= 2, `hello answers (version ${hello.result?.version})`);

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

  const fn = await call('fnUsage');
  check(fn.ok && 'value' in fn.result, `fn usage answers ${JSON.stringify(fn.result)}`);

  const prepare = await call('prepareClipboard');
  check(prepare.ok, 'prepares the clipboard');

  const paste = await call('paste', { text: 'smoke test', restore: true });
  check(paste.ok && typeof paste.result.ok === 'boolean', `paste answers ${JSON.stringify(paste.result)}`);
  if (!permissions.result.accessibility) {
    check(paste.result.ok === false && paste.result.reason === 'accessibility', 'paste without Accessibility is refused cleanly');
  }

  const unknown = await call('nonsense');
  check(unknown.ok === false && /Unknown command/.test(unknown.error), 'unknown commands are rejected');

  child.stdin.write('this is not json\n');
  await sleep(200);
  check(events.some((event) => event.event === 'error'), 'malformed input is reported, not fatal');
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
