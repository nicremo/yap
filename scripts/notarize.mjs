import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
const execute = promisify(execFile);

export async function notarize(file, profile, reportDirectory) {
  if (!profile) throw new Error('A notarytool Keychain profile is required.');
  await mkdir(reportDirectory, { recursive: true });
  const { stdout } = await execute('xcrun', ['notarytool', 'submit', file, '--keychain-profile', profile, '--wait', '--output-format', 'json'], { maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  await writeFile(path.join(reportDirectory, `${result.id}.json`), JSON.stringify(result, null, 2));
  console.log(`[notarize] ${path.basename(file)}: ${result.status} (${result.id})`);
  if (result.status !== 'Accepted') {
    await execute('xcrun', ['notarytool', 'log', result.id, '--keychain-profile', profile, path.join(reportDirectory, `${result.id}-log.json`)]);
    throw new Error(`Apple did not accept ${path.basename(file)}. Inspect the local notarization report.`);
  }
}

export async function notarizeApp(appPath, profile, workDirectory) {
  await mkdir(workDirectory, { recursive: true });
  const temporary = await mkdtemp(path.join(workDirectory, 'notary-'));
  const archive = path.join(temporary, 'Yap.zip');
  await execute('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archive]);
  await notarize(archive, profile, temporary);
  await execute('xcrun', ['stapler', 'staple', appPath]);
  await execute('xcrun', ['stapler', 'validate', appPath]);
  await execute('codesign', ['--verify', '--deep', '--strict', appPath]);
  await execute('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath]);
  console.log(`[notarize] Stapled and Gatekeeper accepted: ${appPath}`);
}
