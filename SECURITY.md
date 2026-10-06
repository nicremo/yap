# Security policy

## Scope

Security fixes target the current version on `main`. Older builds may need to be updated before a fix can be applied. There is no promised response time or paid support agreement.

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/nicremo/yap/security/advisories/new). Include affected versions, a minimal reproduction and the expected impact.

Do not include real API keys, personal transcripts, recordings or private files. Use synthetic data. Do not publish a public issue containing an exploit or sensitive material.

If private reporting is unavailable, open a public issue that only asks for a private reporting channel, without vulnerability details.

## Credentials and permissions

Yap stores its Groq key using Electron's secure storage facilities. Protection depends on the operating system and the available key store. Keep your own key private and revoke it through Groq if exposed.

The app requests operating-system permissions for recording, global shortcuts and pasting. Builds are not currently notarized by Apple. Signing, notarization and source review are different checks.

See [PRIVACY.md](docs/PRIVACY.md) for network activity and local data retention.
