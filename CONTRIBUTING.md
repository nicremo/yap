# Contributing to Yap

Bug reports, documentation fixes, translations and focused pull requests are welcome.

## Development

Use Node.js 22. Install Xcode Command Line Tools on macOS, or Visual Studio Build Tools with the C++ workload on Windows.

```bash
npm ci
npm run build:native
npm run dev
```

The project uses Electron, React and TypeScript. UI text lives in `src/shared/i18n/en.ts` and `src/shared/i18n/de.ts`; update both when a change affects visible text. Support light and dark appearance. Keep API keys in the app's settings rather than source files.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run build
```

For native-helper changes, also run `npm run build:native` and `npm run test:helper` on macOS. The Linux end-to-end check is:

```bash
npm run build
xvfb-run -a npm run test:e2e
```

Describe the problem, the resulting behavior and the checks you actually ran. Keep changes focused. Include a clean screenshot for visible UI changes.

## Packaging and signing

```bash
npm run build:native
npm run build
npx electron-builder --mac --publish never
```

Use `--win` on Windows. `--publish never` creates local artifacts without attempting a GitHub upload. Do not add signing certificates, private keys or provider credentials to the repository.

The macOS signing hook prefers `YAP_SIGN_IDENTITY`, then an available Developer ID Application certificate, then the local `Yap Self-Signed` identity. With none available, it falls back to ad-hoc signing. Ad-hoc builds can require permissions again after an update.

For a development-only persistent signing identity, `scripts/create-signing-identity.sh` creates a self-signed certificate in your login keychain. Run it only on a build machine where you intend to create that certificate. It is optional for source development and is not Apple notarization.

## Screenshot capture

```bash
npm run build
npm run screenshots
```

This launches only the built renderer in a separate Electron preview with fixed demo state. It does not start the dictation engine, open a microphone, use a real API key or read your installed Yap profile. The home screenshots depict a configured demo state with empty history. The welcome screenshot depicts first-run setup.

Captures go to `assets/screenshots/`. Check each image before committing. Do not replace them with personal history, keys, notifications or screenshots of your whole desktop.

## Safe contributions

Never include API keys, personal dictations, recordings, settings files, machine-specific paths or signing material. See [the privacy guide](docs/PRIVACY.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), rather than a public bug report.

Contributions are provided under the repository's MIT license.
