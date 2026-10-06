# Getting help

Start with the [README](README.md), the in-app setup wizard and the live permission status in Settings.

- **Shortcut does not react:** check macOS Accessibility and Input Monitoring. For fn, set the Globe-key action to Do Nothing.
- **Permission looks enabled but is not working:** use Repair permissions in Yap, then grant access again.
- **Cloud transcription fails:** check your connection, API-key validity, selected model and [Groq account limits](https://console.groq.com/docs/rate-limits).
- **Local transcription is not ready:** finish the model download and check the selected local model.
- **No installer is listed:** the source can be built locally. A tag does not imply a downloadable app has been published.
- **Packaging asks for a GitHub token:** use `--publish never` when you only want a local app.

For reproducible problems, [open a bug report](https://github.com/nicremo/yap/issues/new?template=bug_report.yml). Include app version, operating system, cloud or local mode and minimal steps to reproduce. Describe what happened and what you expected.

Screenshots and log excerpts must be sanitized. Never upload your settings file, API key, dictation history or recordings. See [the privacy guide](docs/PRIVACY.md).

For security issues, follow [SECURITY.md](SECURITY.md). Support is community based and has no guaranteed response time.
