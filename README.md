# yap

![yap](assets/cover.png)

**Fast, free dictation for macOS.** Hold a key, speak, release. Your words are
transcribed, cleaned up and pasted where your cursor is, usually in well under
a second. No subscription, no account, no telemetry.

## How it works

1. **Hold your key** (fn by default). The microphone opens on the very first
   press, and Yap opens its connection to Groq while you are still speaking.
2. **Speak.** Double tap instead of holding to dictate hands-free, tap once more
   to finish.
3. **Release.** The recording goes to Groq as compact Opus audio, Whisper Large
   v3 transcribes it, a fast language model polishes it in your style, and the
   text is pasted into the app you were typing in.

```
fn down ──► mic open, TLS warm-up, clipboard snapshot   (while you speak)
fn up   ──► Opus upload ──► Whisper Large v3 (Groq) ──► polish (Groq) ──► paste
```

Every dictation shows its timing on the Home page, for example
`Total 0.64 s · Transcribe 0.31 s · Polish 0.24 s`.

### Two engines, pick one

| | Cloud (Groq) | Local |
|---|---|---|
| Speed | A fraction of a second | Seconds, depends on the Mac |
| Accuracy | Whisper Large v3 | Whisper Base or Small |
| Privacy | Audio goes to Groq | Nothing leaves the device |
| Cost | Free tier, about two hours of audio a day | Free |

Polishing (removing fillers, fixing grammar, applying your style) runs on Groq
and can be switched off. In local mode it starts switched off, so nothing
leaves the device unless you turn it on.

## Install

1. Download the latest `.dmg` from [Releases](https://github.com/nicremo/yap/releases)
   and drag Yap to Applications.
2. The build is not notarised by Apple, so clear the quarantine flag once:

   ```bash
   xattr -cr /Applications/Yap.app
   ```

3. Open Yap. The setup walks you through:
   - **Engine**: Groq cloud (recommended) or local.
   - **Connect**: paste a free key from [console.groq.com/keys](https://console.groq.com/keys),
     or download the local model. Everything happens inside the app.
   - **Access**: microphone and Accessibility. The list updates live while you
     flip the switches in System Settings.
   - **Shortcut**: fn or any key combination, with a live test.
   - **Try it**: dictate into a test box to see the whole pipeline work.

## Language

Yap speaks English and German. *Settings, Appearance, Language* offers
**System**, which follows the language order of macOS (the first language Yap
knows wins, otherwise English), or a fixed choice. It changes Yap itself: the
app, the dictation pill, menus and notifications. The language you dictate in
is a separate setting under *Engine*.

## Permissions

| Permission | Why | Required |
|---|---|---|
| Microphone | Recording while the key is held | Yes |
| Accessibility | Pasting into other apps and watching the shortcut | Yes |
| Input Monitoring | Watching the shortcut passively | No, only if the shortcut does not react |

Yap checks them continuously and shows the live state in Settings. If System
Settings shows Yap as allowed but Yap still reports a permission as missing,
macOS is holding on to an entry from an older build: press **Repair
permissions** in Settings (it clears Yap's entries with `tccutil`) and allow
access once more.

If you use **fn** as the shortcut, set *System Settings → Keyboard → Press 🌐
key to* → **Do Nothing**, otherwise macOS also opens the emoji picker or
switches the input source. Yap detects this and tells you.

## Clipboard

- **Paste automatically** on, **Keep on clipboard** off (default): Yap pastes,
  then puts back exactly what you had copied before. The dictation is marked
  as transient, so clipboard managers such as Raycast, Maccy or Paste do not
  record it.
- **Keep on clipboard** on: every dictation stays on the clipboard.
- **Paste automatically** off: the text is copied (if *Keep on clipboard* is
  on) or only saved to History.

If pasting is impossible (Accessibility off), the text lands on the clipboard
so it is never lost.

**Copy last dictation** (*Settings, Shortcuts*) is a shortcut of your own, up
to four modifiers plus a key, for example ⌃⌥⇧⌘6. Pressed in any app, it puts
your most recent dictation on the clipboard, also while a new one is still
being transcribed. It goes through the system's hotkey API, so it needs no
extra permission. Yap asks for at least two modifiers, one of them ⌃ or ⌘ (or
a function key), so the shortcut cannot swallow characters you type.

## Build from source

```bash
git clone https://github.com/nicremo/yap.git
cd yap
npm install
npm run dev
```

The native helper compiles itself on the first `npm run dev`. During
development macOS attributes permissions to the terminal that started Yap, so
grant them to your terminal app.

### Distributable build

```bash
scripts/create-signing-identity.sh   # once per build machine
npm run package:mac
```

`create-signing-identity.sh` creates a self-signed code signing certificate.
macOS ties privacy permissions to the code signature: with an ad-hoc signature
every new build counts as a different app, and users have to grant
Accessibility again after each update. Builds signed with the same certificate
keep their permissions. A `Developer ID Application` certificate in the
keychain is picked up automatically instead; `YAP_SIGN_IDENTITY` overrides both.

The native helper is built as a universal binary, the app for the architecture
of the build machine (`npx electron-builder --mac --x64` or `--universal` for
others).

## Architecture

```
src/
  main/
    index.ts            App lifecycle, windows, tray, state broadcasting
    dictation/
      engine.ts         Key press to pasted text, pipelined and ordered
      gesture.ts        Hold, tap and double-tap handling
      pipeline.ts       Transcription and polishing, silence and hallucination filters
    groq.ts             Groq client on Chromium's network stack, connection pre-warming
    rewrite.ts          Polishing prompts and output cleanup
    local-whisper.ts    On-device Whisper via transformers.js
    native/             Bridge to the native helper (persistent on macOS)
    permissions.ts      Live permission state, requests and repair
    settings.ts         Settings with migration from older versions
    prompts/            Prompt families for Conversation, Vibe Coding and Custom +
  renderer/
    App.tsx, pages/     Settings app
    setup/              First-run setup
    overlay/            Dictation pill and the recorder host
    recorder/           AudioWorklet capture at 16 kHz, Opus via MediaRecorder
swift/YapHelper.swift   Hotkey tap, focus, clipboard and paste (one long-lived process)
windows/YapHelper.cpp   Windows helper
```

What makes it fast:

- Recording starts on the first key press, no waiting to tell a tap from a hold.
- The connection to Groq is opened while you speak (`session.preconnect`), and
  requests use Chromium's HTTP/2 connection pool.
- Audio is uploaded as Opus, about a tenth of the WAV size; WAV is the fallback.
- No disk access between key release and paste; history and audio are saved
  in the background.
- One persistent native helper instead of a process launch per paste, and no
  fixed delays before pasting.
- Reasoning models run with minimal reasoning effort.

## Tests

```bash
npm test             # unit tests
npm run typecheck
npm run test:helper  # macOS: protocol test of the compiled native helper
npm run build && xvfb-run -a npm run test:e2e
                     # Linux: the built app against a mock Groq server
```

The end-to-end test launches the real app with Chromium's fake microphone,
drives the hotkey and checks the whole path: key setup, Opus upload, rewrite,
delivery, clipboard behaviour and history.

## Credits

Based on [OpenWhisp](https://github.com/giusmarci/openwhisp), MIT licensed.

## License

MIT. See [LICENSE](LICENSE).
