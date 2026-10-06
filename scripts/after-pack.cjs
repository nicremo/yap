/* electron-builder afterPack hook (macOS): signs the app.

   macOS remembers privacy permissions (Accessibility, Input Monitoring,
   Microphone) per code signature. An ad-hoc signature changes with every
   build, so after an update System Settings still shows Yap as allowed while
   macOS no longer honours it. Signing every build with the same certificate
   keeps the permissions across updates.

   electron-builder's own signing is switched off (mac.identity: null),
   because on Apple Silicon it would fall back to an ad-hoc signature and
   overwrite this one. Identity, in order of preference:
     1. YAP_SIGN_IDENTITY
     2. A "Developer ID Application" certificate in the keychain
     3. "Yap Self-Signed" from scripts/create-signing-identity.sh
     4. Ad-hoc: valid, but permissions must be granted again after updates. */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SELF_SIGNED_NAME = 'Yap Self-Signed';
const MACH_O_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);

function chooseIdentity() {
  if (process.env.YAP_SIGN_IDENTITY) return { name: process.env.YAP_SIGN_IDENTITY, developerId: false };

  const valid = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout ?? '';
  const developerId = valid.match(/"(Developer ID Application: [^"]+)"/);
  if (developerId) return { name: developerId[1], developerId: true };

  const all = spawnSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' }).stdout ?? '';
  if (all.includes(`"${SELF_SIGNED_NAME}"`)) return { name: SELF_SIGNED_NAME, developerId: false };

  return { name: '-', developerId: false };
}

function isMachO(file) {
  try {
    const handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(4);
    fs.readSync(handle, buffer, 0, 4, 0);
    fs.closeSync(handle);
    return MACH_O_MAGICS.has(buffer.toString('hex'));
  } catch {
    return false;
  }
}

/** Loose binaries outside the standard bundle locations, which --deep does not reach. */
function findLooseBinaries(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      found.push(...findLooseBinaries(full));
    } else if (entry.isFile() && isMachO(full)) {
      found.push(full);
    }
  }
  return found;
}

function codesign(target, identity, entitlements, extra = []) {
  execFileSync(
    'codesign',
    [
      '--force',
      '--options',
      'runtime',
      // Notarisation needs a secure timestamp; everything else must not wait for Apple's server.
      identity.developerId ? '--timestamp' : '--timestamp=none',
      '--entitlements',
      entitlements,
      ...extra,
      '--sign',
      identity.name,
      target,
    ],
    { stdio: 'inherit' },
  );
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const entitlements = path.resolve(__dirname, '..', 'build', 'entitlements.mac.plist');
  const identity = chooseIdentity();
  console.log(`[afterPack] signing with ${identity.name === '-' ? 'an ad-hoc signature' : `"${identity.name}"`}`);

  // Inside out: loose binaries first, then the bundles that contain them.
  for (const binary of findLooseBinaries(path.join(appPath, 'Contents', 'Resources'))) {
    codesign(binary, identity, entitlements);
  }
  codesign(appPath, identity, entitlements, ['--deep']);
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });

  if (identity.name === '-') {
    console.log('[afterPack] Ad-hoc signed. Run scripts/create-signing-identity.sh once so permissions survive updates.');
  }
};
