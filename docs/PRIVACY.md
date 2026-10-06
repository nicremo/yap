# Privacy and data flow

Yap has no Yap account and no built-in usage analytics. Cloud mode still uses third-party services, and the app stores dictation data locally.

## What leaves the computer

| Feature | Destination and data |
| --- | --- |
| Cloud transcription | Groq receives the recording and transcription settings using your own API key. |
| Cloud polishing | Groq receives the transcript and writing instructions. This applies in local mode too if you enable polishing. |
| Key validation and model availability | Groq receives authenticated requests when checking a configured key and loading the available models. |
| Local model download | Model files are downloaded through the Hugging Face/Transformers.js model stack. The provider sees normal download requests. |
| Packaged-app update checks | Supported packaged builds check GitHub release metadata and may download an update. |
| Links you open | The chosen website receives a normal browser request. |

Local transcription works offline after the model is downloaded. Keep polishing disabled to avoid sending transcripts to Groq. Third-party terms, retention policies and limits apply to their services; Yap cannot guarantee provider-side deletion or retention.

## What stays on the computer

- Settings, the encrypted Groq key, dictionary, correction rules and dictation history are kept in the app's local profile.
- History keeps up to 500 entries, including raw and processed text, timestamps and optional target-app information.
- Recordings are saved locally for retries. The app schedules cleanup after seven days; cleanup runs when the app is active, so this is not an exact wall-clock deletion guarantee.
- Downloaded Whisper models remain in the configured storage directory.
- Local diagnostic logs can contain errors and machine-specific paths.

Key storage uses Electron's secure storage facilities. Its strength depends on the operating system and key-store availability. The renderer receives only whether a key is configured, not the encrypted key itself.

Automatic paste temporarily uses the clipboard. By default Yap restores the previous clipboard and marks the dictation as transient on macOS. Clipboard managers and operating-system behavior are outside Yap's control. Enabling Keep on clipboard leaves the result available until replaced.

## Sharing an issue safely

Use made-up text to reproduce a problem. Remove keys, account identifiers, names, file paths, transcripts and recording references from screenshots or diagnostic excerpts. Avoid sharing the whole app profile or a screenshot of your whole desktop.

The repository excludes local settings, history, recordings, models, workspace files and signing material through `.gitignore`. That is a safeguard, not permission to put sensitive files in a pull request. Review staged files before committing.

For a suspected credential exposure or vulnerability, use [SECURITY.md](../SECURITY.md).
