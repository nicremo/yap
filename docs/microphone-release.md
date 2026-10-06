# Why the recorder stops its tracks

Short version: closing an `AudioContext` does not release the microphone. If
you are forking this project, or the upstream one, this is worth knowing.

## The symptom

After the first dictation, macOS held two power assertions until the app quit:

```
pid 432(coreaudiod): PreventUserIdleSystemSleep
  named "com.apple.audio.BuiltInMicrophoneDevice.context.preventuseridlesleep"
pid 432(coreaudiod): PreventUserIdleSystemSleep
  named "com.apple.audio.BuiltInSpeakerDevice.context.preventuseridlesleep"
```

The machine stopped going to idle sleep, `coreaudiod` sat at 12 to 17 percent
CPU, and the Chromium audio service process accumulated 109 minutes of CPU time
over two days. The audio service was spawned at the first dictation and never
exited.

## The cause

`AudioRecorder.stop()` closed the `AudioContext` but never stopped the
`MediaStreamTrack`s, and the stream was deliberately reused across dictations:

```ts
private async ensureStream(): Promise<MediaStream> {
  if (this.stream) {
    const tracks = this.stream.getAudioTracks();
    if (tracks.length > 0 && tracks[0].readyState === 'live') {
      return this.stream;   // still live, device still open
    }
  }
  ...
}
```

The context owns the audio graph. The track owns the device. Only the context
was being released.

## Why the speaker was open too

The app plays no audio at all. The output stream comes from the recording graph
itself: a `ScriptProcessorNode` only produces data while it is connected to
`context.destination`, so a muted `GainNode` sits at the end of the chain.

An isolated Electron probe, sampling `pmset -g assertions` after each step:

| Step | `echoCancellation: true` | `echoCancellation: false` |
|---|---|---|
| `getUserMedia` only | mic open, speaker closed | mic open, speaker closed |
| `AudioContext` connected | mic open, **speaker open** | mic open, **speaker open** |
| `context.close()` only | mic open, **speaker stays open** | mic open, speaker closed |
| `track.stop()` | **both closed** | **both closed** |

Row three is the interesting one. With echo cancellation enabled, the output
path serves as the AEC reference signal and is bound to the live capture track,
so closing the context does not release it. The speaker leak was a consequence
of the microphone leak, not a separate bug.

`track.stop()` resolves both cases, so echo cancellation stays on. It helps
transcription quality and costs nothing once the track is released.

## The fix

No warm-keeping. The stream is opened when a recording starts and fully
released when it ends.

- `release()` disconnects the graph, closes the context, then stops every
  track. Idempotent and safe on a half-built graph.
- `stop()` releases **before** it validates, so a too-short recording cannot
  leave the device open.
- A failed `start()` releases the stream it already opened.
- Concurrent `start()` calls share one promise, so a second stream cannot be
  opened by accident.
- `dispose()` releases from the outside, wired to unmount and `pagehide`.
- A log warning fires if opening the microphone takes longer than 500 ms, which
  is the point where the first spoken word starts getting clipped.

Covered by `tests/renderer/recorder.test.ts`.

## Verifying it

```bash
scripts/check-audio-assertions.sh
```

After a dictation and two minutes of waiting this must print `PASS`. The script
matches the assertion name rather than the `Resources:` line, so unrelated
holders such as an iOS Simulator audio device do not raise a false alarm.

## Since then

- Recording moved from `ScriptProcessorNode` to an `AudioWorkletNode` with no
  outputs, running in a 16 kHz `AudioContext`. Capture happens on the audio
  thread and nothing needs resampling in JavaScript.
- Every dictation gets its own `AudioRecorder` instance, so a new recording can
  start while the previous one is still being handed over. An instance records
  once and refuses a second `start()`.
- Hands-free recordings stop after ten minutes.
- Only the overlay window, which hosts the recorder, runs with
  `backgroundThrottling: false`.

Covered by `tests/renderer/recorder.test.ts`.
