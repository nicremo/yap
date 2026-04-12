# OpenWhisp Enhanced

![OpenWhisp](assets/cover.png)

**WisprFlow Alternative, komplett kostenlos.** Halte **Fn**, sprich, lass los. Deine Worte werden transkribiert, poliert und direkt eingefuegt. Cloud-Transkription via Groq (kostenlos!) mit lokalem LLM Post-Processing.

> Fork von [OpenWhisp](https://github.com/giusmarci/openwhisp) von [Raelume](https://raelume.ai), erweitert um Cloud-Transkription, kleinere/schnellere Modelle und Deutsch-Optimierung.

## Was ist anders gegenueber dem Original?

| Feature | Original OpenWhisp | Enhanced |
|---|---|---|
| **Transkription** | Nur lokal (Whisper Base, 150 MB) | Cloud via Groq (Whisper Large v3) + lokaler Fallback |
| **Genauigkeit** | Basis | Deutlich besser (Large v3 statt Base) |
| **Text-Model** | gemma4:e4b (9.6 GB) | qwen3.5:2b (2.7 GB), 3.5x kleiner |
| **Sprache** | Englisch-fokussiert | Deutsch-optimiert (konfigurierbar) |
| **Cloud-Kosten** | Keine (alles lokal) | Kostenlos (Groq Free Tier: 2 Stunden Audio/Tag) |
| **RAM-Bedarf** | ~12 GB (Whisper + Gemma 4) | ~3 GB (nur Ollama LLM, Transkription laeuft in der Cloud) |
| **API Key Sicherheit** | Nicht relevant | Verschluesselt via macOS Keychain |
| **Offline** | Ja | Ja (automatischer Fallback auf lokales Whisper) |

## So funktioniert es

1. **Fn halten**: OpenWhisp hoert zu
2. **Sprechen**: Audio wird aufgenommen
3. **Fn loslassen**: Groq transkribiert (Cloud), Ollama poliert den Text (lokal), Ergebnis wird eingefuegt

```
Audio -> Groq Whisper Large v3 (Cloud, kostenlos)
           |
           v
      Roher Text (Deutsch)
           |
           v
      Ollama qwen3.5:2b (lokal, 2.7 GB)
           |
           v
      Polierter Text -> Clipboard -> Auto-Paste
```

Kein Internet? Kein Problem. OpenWhisp faellt automatisch auf lokales Whisper zurueck.

## Features

- **Cloud + Local Hybrid**: Groq fuer beste Genauigkeit, lokales Whisper als Fallback
- **Deutsch-optimiert**: Transkription und LLM-Rewrite auf Deutsch konfiguriert
- **Winziges LLM**: qwen3.5:2b (2.7 GB) statt 9.6 GB, laeuft auf jedem Mac
- **3 Transkriptions-Modi**: Auto (Cloud + Fallback), Cloud-only, Local-only
- **Styles**: Conversation und Vibe Coding Modi
- **4 Enhancement Levels**: No Filter, Soft, Medium, High
- **Intent Resolution**: "Mach es weiss... nein doch schwarz" -> nur der finale Intent
- **Auto-Paste**: Text wird direkt in die aktive App eingefuegt
- **API Key verschluesselt**: Gespeichert via macOS Keychain, nie im Klartext
- **Konfigurierbarer API Provider**: Groq, OpenAI, Lemonfox.ai oder jeder OpenAI-kompatible Anbieter

## Warum Groq?

| Anbieter | Preis/Minute | Modell | Free Tier |
|---|---|---|---|
| **Groq** | $0.0002 | Whisper Large v3 | 7.200 Sek/Std (2h Audio/Tag kostenlos) |
| OpenAI | $0.006 | Whisper v2 | Nein |
| Lemonfox | $0.003 | Whisper Large v3 | 1 Monat gratis |

Groq ist **30x guenstiger als OpenAI** und bietet ein grosszuegiges Free Tier. Fuer normalen Gebrauch (ein paar Minuten Diktat pro Tag) ist es **komplett kostenlos**.

## Quick Start

### 1. Ollama installieren und Text-Model laden

```bash
# Ollama installieren: https://ollama.com/download/mac
ollama serve

# Text-Enhancement Model laden (nur 2.7 GB!)
ollama pull qwen3.5:2b
```

### 2. Groq API Key holen (kostenlos)

1. Gehe zu [console.groq.com](https://console.groq.com)
2. Account erstellen (kostenlos)
3. API Key generieren

### 3. App starten

```bash
git clone https://github.com/nicremo/openwhisp-enhanced.git
cd openwhisp-enhanced
npm install
npm run build:native
npm run dev
```

### 4. Setup Wizard

Der Setup Wizard fuehrt dich durch:

1. **Transcription Engine**: Groq API Key eingeben (oder lokales Whisper downloaden)
2. **Ollama**: Verbindung pruefen
3. **Permissions**: Mikrofon, Accessibility, Input Monitoring

Danach: Fn halten, sprechen, loslassen. Fertig.

## Auf Englisch umstellen

Die App ist standardmaessig auf Deutsch konfiguriert. So stellst du auf Englisch um:

1. **Models-Seite** oeffnen
2. **Language** Dropdown von "Deutsch" auf "English" wechseln
3. Fertig. Die Transkription und das LLM-Rewrite laufen ab sofort auf Englisch.

Oder in der Settings-Datei (`~/Library/Application Support/OpenWhisp/settings.json`):

```json
{
  "cloudLanguage": "en"
}
```

Unterstuetzte Sprachen: Deutsch, English, Francais, Espanol, Italiano, Portugues, Nederlands, Polski, Japanisch, Chinesisch, Koreanisch und 90+ weitere.

## Modelle

| Zweck | Model | Groesse | Anbieter |
|---|---|---|---|
| Transkription (Cloud) | Whisper Large v3 | Cloud | Groq (kostenlos) |
| Transkription (Lokal) | whisper-base | ~150 MB | Lokal via HuggingFace |
| Text Enhancement | qwen3.5:2b | ~2.7 GB | Lokal via Ollama |

### Alternative Cloud-Anbieter

Die App funktioniert mit jedem OpenAI-kompatiblen Anbieter. Einfach Base URL und API Key aendern:

| Anbieter | Base URL | Model |
|---|---|---|
| Groq (Standard) | `https://api.groq.com/openai` | `whisper-large-v3` |
| OpenAI | `https://api.openai.com` | `gpt-4o-mini-transcribe` |
| Lemonfox | `https://api.lemonfox.ai` | `whisper-1` |

### Alternative Text-Modelle

Jedes Ollama-Modell funktioniert. Empfehlungen nach Groesse:

| Model | Groesse | Qualitaet | Speed |
|---|---|---|---|
| qwen3.5:2b (Standard) | 2.7 GB | Sehr gut | Schnell |
| qwen3:4b | 2.5 GB | Exzellent | Schnell |
| gemma3:4b | 3.3 GB | Exzellent | Mittel |
| qwen3.5:4b | 3.4 GB | Top | Mittel |

## Tech Stack

- **Electron** + **React** + **TypeScript**
- **Groq API** (oder OpenAI-kompatibel) fuer Cloud-Transkription
- **@huggingface/transformers** fuer lokale Whisper Inferenz (Fallback)
- **Ollama** fuer lokales LLM Text-Enhancement
- **Swift** nativer macOS Helper fuer Fn-Key, Fokus-Erkennung, Auto-Paste
- **electron-vite** Build Tooling
- **Electron safeStorage** fuer verschluesselte API Key Speicherung

## Projektstruktur

```
src/
  main/
    api-key.ts          # API Key Verschluesselung (macOS Keychain)
    cloud-transcription.ts  # Cloud STT (Groq/OpenAI-kompatibel)
    dictation.ts        # Pipeline: Transkription -> Rewrite -> Paste
    transcription.ts    # Lokale Whisper Inferenz (Fallback)
    ollama.ts           # Ollama API Client + Auto-Launch
    prompts.ts          # Prompt Matrix (Style x Enhancement Level)
    settings.ts         # Settings Persistenz
    windows.ts          # Fenster-Verwaltung
  renderer/
    App.tsx             # UI: Sidebar, Pages, Setup Wizard, Overlay
    styles.css          # Styling
    audio-recorder.ts   # Web Audio Recorder mit Level Metering
  preload/              # Electron Preload Bridge
  shared/               # Geteilte Types und Konstanten
swift/
  OpenWhispHelper.swift # Nativer macOS Helper
```

## Building

```bash
npm run package
```

Erstellt die Electron App, kompiliert den Swift Helper und packt alles in `.dmg` und `.zip` im `release/` Verzeichnis.

## Credits

- Urspruengliches [OpenWhisp](https://github.com/giusmarci/openwhisp) von [GiusMarci](https://x.com/GiusMarci) / [Raelume](https://raelume.ai)
- Enhanced Version von [Fabian](https://github.com/nicremo)

## License

MIT (wie das Original)
