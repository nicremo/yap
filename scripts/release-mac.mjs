import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { notarize } from './notarize.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const execute = promisify(execFile);
const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : process.env.YAP_NOTARY_PROFILE;
if (process.platform !== 'darwin' || !profile) throw new Error('Run on macOS with --profile <notarytool Keychain profile>.');
// Check authentication before compiling. Credentials stay inside the Keychain.
await execute('xcrun', ['notarytool', 'history', '--keychain-profile', profile, '--output-format', 'json']);
const { stdout: identities } = await execute('security', ['find-identity', '-v', '-p', 'codesigning']);
const identity = identities.match(/"(Developer ID Application: [^"]+)"/)?.[1];
if (!identity) throw new Error('A valid Developer ID Application certificate is required.');

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, YAP_NOTARY_PROFILE: profile, YAP_SIGN_IDENTITY: identity } });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
await run('node', ['scripts/prepare-mac-dependencies.mjs']);
await run('npm', ['run', 'typecheck']);
await run('npm', ['test']);
await run('npm', ['run', 'build']);
await run('npm', ['run', 'build:native']);
await run('npx', ['electron-builder', '--mac', '--arm64', '--x64', '--publish', 'never']);

const release = path.join(root, 'release');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
for (const arch of ['arm64', 'x64']) {
  const image = path.join(release, `Yap-${version}-${arch}.dmg`);
  await execute('codesign', ['--force', '--timestamp', '--sign', identity, image]);
  await notarize(image, profile, path.join(root, 'work', 'notarization'));
  await execute('xcrun', ['stapler', 'staple', image]);
  await execute('xcrun', ['stapler', 'validate', image]);
  await execute(require('app-builder-bin').appBuilderPath, ['blockmap', '--input', image, '--output', `${image}.blockmap`]);
  await execute('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', image]);
}
// Stapling changes DMG bytes. Recompute its manifest hash only after stapling.
const manifestPath = path.join(release, 'latest-mac.yml');
const manifest = yaml.load(await readFile(manifestPath, 'utf8'));
if (manifest.version !== version) throw new Error('The update manifest version does not match the app.');
for (const file of manifest.files) {
  const artifact = path.join(release, path.basename(file.url));
  file.size = (await stat(artifact)).size;
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(artifact)) hash.update(chunk);
  file.sha512 = hash.digest('base64');
}
const legacy = manifest.files.find((file) => file.url === manifest.path);
if (!legacy) throw new Error('Missing default updater archive.');
manifest.sha512 = legacy.sha512;
await writeFile(manifestPath, yaml.dump(manifest));
console.log('[release] Notarized installers and update archives are ready.');
