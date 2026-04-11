# OpenWhisp

Mac-first local dictation app. Hold **Fn**, speak, release — your words are transcribed, enhanced, and pasted into the active app. Everything runs on your machine. No cloud, no account, no latency.

## How it works

1. **Hold Fn** — OpenWhisp starts listening
2. **Speak** — your voice is captured locally
3. **Release Fn** — Whisper transcribes your speech, a local LLM polishes the text, and the result is pasted into whatever app you were using

The entire pipeline runs locally via [Whisper](https://github.com/openai/whisper) (speech-to-text) and [Ollama](https://ollama.com) (text enhancement).

## Features

- **Fully local** — no data leaves your Mac
- **Styles** — switch between Conversation and Vibe Coding modes depending on context
- **Enhancement levels** — from raw transcription (No Filter) to professional polish (High)
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
git clone https://github.com/user/openwhisp.git
cd openwhisp
npm install
npm run build:native
npm run dev
```

On first launch, the setup wizard will walk you through:
1. Connecting to Ollama
2. Downloading the speech model (Whisper Base English)
3. Downloading the text model (Gemma 4 E4B)
4. Granting microphone and system permissions

## Default models

| Purpose | Model | Size |
|---------|-------|------|
| Speech-to-text | `onnx-community/whisper-base.en` | ~150 MB |
| Text enhancement | `gemma4:e4b` | ~9.6 GB |

You can switch to any Ollama-compatible model from the Models page.

## Tech stack

- **Electron** + **React** + **TypeScript** — desktop shell and UI
- **@huggingface/transformers** — local Whisper inference
- **Ollama** — local LLM inference via API
- **Swift** — native macOS helper for Fn key listening, focus detection, and paste simulation
- **electron-vite** — build tooling

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
    prompts.ts      # Style + level prompt matrix
    settings.ts     # Settings persistence
    windows.ts      # Window creation and positioning
  renderer/       # React UI
    App.tsx         # Sidebar layout, pages, overlay
    styles.css      # Complete styling
    audio-recorder.ts # Web Audio recorder with level metering
  preload/        # Electron preload bridge
  shared/         # Shared types and constants
swift/
  OpenWhispHelper.swift  # Native macOS helper
```

## License

MIT
