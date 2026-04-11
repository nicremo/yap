# Openwhisp

![Openwhisp](assets/cover.png)

Voice to text, entirely on your machine. Hold **Fn**, speak, release — your words are transcribed, polished, and pasted right where you need them. No cloud, no account, no latency.

Built in a weekend because I kept getting ads for Wispr Flow and thought — why not build it myself?

## How it works

1. **Hold Fn** — OpenWhisp starts listening
2. **Speak** — your voice is captured locally
3. **Release Fn** — Whisper transcribes your speech, a local LLM polishes the text, and the result is pasted into whatever app you were using

The entire pipeline runs locally via [Whisper](https://github.com/openai/whisper) (speech-to-text) and [Ollama](https://ollama.com) (text enhancement).

## Features

- **Fully local** — no data leaves your Mac
- **Styles** — switch between Conversation and Vibe Coding modes depending on context
- **Enhancement levels** — from raw transcription (No Filter) to professional polish (High)
- **Intent resolution** — if you change your mind mid-sentence ("make it white... actually, black"), OpenWhisp resolves to your final intent
- **Auto-paste** — refined text is pasted directly into the active app
- **Auto-launch Ollama** — if Ollama is installed, OpenWhisp starts it automatically
- **Setup wizard** — guided first-launch experience for permissions, models, and configuration
- **Minimal overlay** — a small audio-reactive grid appears at the bottom of your screen during dictation

## Styles

| Style | Use case |
|-------|----------|
| **Conversation** | Messages, emails, notes, everyday writing |
| **Vibe Coding** | Developer communication — translates casual speech into proper engineering language |

Each style has four enhancement levels: **No Filter**, **Soft**, **Medium**, and **High**.

## Requirements

- macOS (Apple Silicon recommended)
- [Ollama](https://ollama.com/download/mac) — OpenWhisp auto-launches it if installed
- ~10 GB disk space for models (downloaded on first launch)

## Getting started

```bash
# Clone the repo
git clone https://github.com/user/openwhisp.git
cd openwhisp

# Install dependencies
npm install

# Compile the native Swift helper
npm run build:native

# Start the app
npm run dev
```

On first launch, the setup wizard will walk you through:

1. **Ollama** — if not installed, the wizard links you to the download. If installed, OpenWhisp launches it automatically.
2. **Speech model** — downloads Whisper Base Multilingual (~150 MB) for local speech recognition.
3. **Text model** — downloads Gemma 4 E4B (~9.6 GB) for local text enhancement. This takes a few minutes on the first run.
4. **Permissions** — microphone access for recording, plus Accessibility and Input Monitoring for Fn key listening and auto-paste.

After setup, click into the text field where you want the text to go (an email, chat, code editor, etc.), then hold **Fn** and speak. When you release, the transcribed and enhanced text is automatically pasted into that field. If you move away or no text field is selected, the text is still copied to your clipboard — just use **Cmd+V** to paste it wherever you need.

## Default models

| Purpose | Model | Size |
|---------|-------|------|
| Speech-to-text | `onnx-community/whisper-base` | ~150 MB |
| Text enhancement | `gemma4:e4b` | ~9.6 GB |

You can switch to any Ollama-compatible model from the Models page.

## Tech stack

- **Electron** + **React** + **TypeScript** — desktop shell and UI
- **@huggingface/transformers** — local Whisper inference
- **Ollama** — local LLM inference via API
- **Swift** — native macOS helper for Fn key listening, focus detection, and paste simulation
- **electron-vite** — build tooling
- **Hugeicons** — UI icons

## Building for distribution

```bash
npm run package
```

Builds the Electron app, compiles the Swift helper, and packages everything into a `.dmg` and `.zip` in the `release/` directory.

## Project structure

```
src/
  main/           # Electron main process
    dictation.ts    # Transcription + rewrite pipeline
    ollama.ts       # Ollama API client + auto-launch
    prompts.ts      # Global rules + style + level prompt matrix
    settings.ts     # Settings persistence
    windows.ts      # Window creation and positioning
  renderer/       # React UI
    App.tsx         # Sidebar layout, pages, setup wizard, overlay
    styles.css      # Complete styling
    audio-recorder.ts # Web Audio recorder with level metering
  preload/        # Electron preload bridge
  shared/         # Shared types and constants
swift/
  OpenWhispHelper.swift  # Native macOS helper
```

## License

MIT

---

Made by [Raelume](https://raelume.ai)
