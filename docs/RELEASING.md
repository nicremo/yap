# Releasing Yap

Public releases contain a Developer ID signed and Apple notarized macOS app,
DMG installers for Apple Silicon and Intel, ZIP archives for automatic updates,
and the Windows installer built by GitHub Actions. Stage all assets in a draft
release and publish only after checking signatures, notarization and manifests.

## Local macOS credentials

Install your Developer ID Application certificate in your local Keychain.
Create a notarytool Keychain profile using Apple's interactive command:

```sh
xcrun notarytool store-credentials Yap-notary
```

Enter credentials in the local terminal, never in an issue, a commit or a chat.
The release script uses the profile name and does not read or export credentials.
See [Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

## Build and notarize

From a clean checkout with `npm ci` completed:

```sh
npm run release:mac -- --profile Yap-notary
```

The command verifies authentication and the Developer ID certificate first,
runs type checking and tests, builds both architectures, submits each signed app
to Apple and staples its ticket before creating the ZIP and DMG artifacts.
It then signs and notarizes the DMGs, validates their tickets and Gatekeeper
assessment, and refreshes the manifest checksums after stapling. Local reports
are written to the ignored `work/notarization` directory.

Do not modify or re-sign the apps after notarization. Do not replace release
artifacts without updating their manifests and blockmaps.

## GitHub release

1. Merge the version change and release notes after CI passes.
2. Push the matching `vX.Y.Z` tag. The Build workflow stages Windows assets in a draft.
3. Add the local DMGs, macOS ZIPs and their blockmaps, `latest-mac.yml`, and SHA256SUMS.
4. Verify both `latest-mac.yml` and `latest.yml` point to uploaded files with matching SHA512 and byte sizes.
5. Publish the draft only when all platform assets are complete.

The macOS updater requires the signed ZIP archives. DMGs alone are insufficient.
Keep `latest-mac.yml`, `latest.yml` and the referenced assets available on the
same public GitHub release. See [electron-builder's update documentation](https://www.electron.build/v26/docs/features/auto-update/).

Yap checks stable releases after launch and every four hours. Users can check
from Settings and restart to install a downloaded update after finishing their
dictation. Updates also install when the app quits. Development builds do not
contact the update feed. A signed build without a notarization ticket is not a
completed public macOS release.
