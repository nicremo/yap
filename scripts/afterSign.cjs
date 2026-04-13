const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const helperPath = path.join(appPath, 'Contents/Resources/native/openwhisp-helper');
  const entitlements = path.resolve('build/entitlements.mac.plist');

  const identity = context.packager.platformSpecificBuildOptions.identity
    || 'Developer ID Application';

  console.log(`[afterSign] Re-signing helper: ${helperPath}`);
  execSync(
    `codesign --sign "${identity}" --force --timestamp --options runtime --entitlements "${entitlements}" "${helperPath}"`,
    { stdio: 'inherit' },
  );
  console.log('[afterSign] Helper re-signed successfully');
};
