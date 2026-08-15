# Mikrofon und Lautsprecher blieben nach dem Diktat dauerhaft offen

**Datum:** 15.08.2026
**Betroffen:** alle Versionen bis einschließlich 0.9.0
**Datei:** `src/renderer/audio-recorder.ts`

## Symptom

Nach dem ersten Diktat hielt macOS bis zum Beenden der App zwei Energie-Assertions offen:

```
pid 432(coreaudiod): 13:46:09 PreventUserIdleSystemSleep
  named "com.apple.audio.BuiltInMicrophoneDevice.context.preventuseridlesleep"
pid 432(coreaudiod): 13:46:09 PreventUserIdleSystemSleep
  named "com.apple.audio.BuiltInSpeakerDevice.context.preventuseridlesleep"
```

Folgen: der Mac ging nicht mehr in den Idle-Sleep, `coreaudiod` lief mit 12 bis 17 Prozent Dauerlast, und der Chromium-Audio-Service-Prozess sammelte in knapp zwei Tagen 109 Minuten CPU-Zeit.

## Messung, die die App als Verursacher belegt

Die App lief seit dem 13.08. 17:19 Uhr. Der Audio-Service-Prozess wurde erst 17:49 Uhr gestartet, also beim ersten Diktat, und lief danach ununterbrochen weiter:

```
PID   ELAPSED       TIME       COMMAND
30490 01-22:59:30   108:56.97  OpenWhisp Helper --utility-sub-type=audio.mojom.AudioService
```

Das letzte erfolgreiche Diktat endete laut `main.log` um 14:42:25 Uhr. Über zwei Stunden später waren beide Assertions weiterhin offen. Beim Beenden von OpenWhisp verschwanden sie sofort.

## Ursache

`AudioRecorder.stop()` hat den `AudioContext` geschlossen, aber die `MediaStreamTrack`s nie gestoppt. `ensureStream()` war zusätzlich darauf ausgelegt, den einmal geöffneten Stream über alle Diktate hinweg wiederzuverwenden:

```ts
private async ensureStream(): Promise<MediaStream> {
  if (this.stream) {
    const tracks = this.stream.getAudioTracks();
    if (tracks.length > 0 && tracks[0].readyState === 'live') {
      return this.stream;   // Stream lebt weiter, Gerät bleibt offen
    }
  }
  ...
}
```

Der Kontext besitzt den Audio-Graphen, der Track besitzt das Gerät. Es wurde nur der Kontext freigegeben.

## Warum auch der Lautsprecher offen war

Die App spielt nirgends Audio ab. Es gibt weder ein `Audio`-Objekt noch ein `<audio>`-Element, keinen Feedback-Sound und im Swift-Helper keinerlei Audio-Code. Der Output-Stream kam ausschließlich aus dem Aufnahme-Graphen: ein `ScriptProcessorNode` liefert nur dann Daten, wenn er mit `context.destination` verbunden ist, deshalb hängt am Ende der Kette ein stummgeschalteter `GainNode` am Ausgabegerät.

Ein isoliertes Electron-Experiment hat die Rollen sauber getrennt, gemessen nach jedem Schritt über `pmset -g assertions`:

| Schritt | mit `echoCancellation: true` | mit `echoCancellation: false` |
|---|---|---|
| nur `getUserMedia` | mic offen, Speaker zu | mic offen, Speaker zu |
| `AudioContext` verbunden | mic offen, **Speaker offen** | mic offen, **Speaker offen** |
| nur `context.close()` | mic offen, **Speaker bleibt offen** | mic offen, Speaker zu |
| `track.stop()` | **beide zu** | **beide zu** |

Das erklärt die dritte Zeile: mit aktiver Echo Cancellation dient der Ausgabepfad als Referenzsignal und ist an den lebenden Aufnahme-Track gebunden. `context.close()` gibt ihn dann nicht frei. Der Lautsprecher-Leak war also kein eigener Fehler, sondern eine Folge des Mikrofon-Leaks.

`track.stop()` löst in beiden Varianten alles auf. Echo Cancellation bleibt deshalb aktiv, sie ist für die Transkriptionsqualität wertvoll.

## Fix

`src/renderer/audio-recorder.ts`

- Kein Warmhalten. Der Stream wird beim Start der Aufnahme geöffnet und danach vollständig freigegeben. `ensureStream()` ist durch `openStream()` ersetzt, das immer neu öffnet.
- Neues privates `release()`: trennt den Graphen, schließt den Kontext und stoppt danach jeden Track. Idempotent und auch auf einem halb aufgebauten Graphen sicher.
- `stop()` gibt frei, bevor es die Länge prüft. Eine zu kurze Aufnahme lässt das Gerät nicht mehr offen.
- `start()` fängt Fehler beim Aufbau des Graphen ab und gibt den bereits geöffneten Stream wieder frei.
- Parallele `start()`-Aufrufe teilen sich eine Promise, ein zweiter Aufruf kann keinen zweiten Stream mehr öffnen.
- Neues `dispose()` für den Abbau von außen.
- Warnung im Log, wenn das Öffnen des Mikrofons länger als 500 ms dauert.

`src/renderer/App.tsx`

- Der Recorder wird beim Unmount und bei `pagehide` freigegeben.
- Die Fehlerpfade von Hotkey-Down und Hotkey-Up geben zusätzlich frei.

## Bewusst kein zeitlich begrenztes Warmhalten

Ein Warmhalten mit Timeout wäre möglich, wurde aber nicht gebaut. Die Aufnahme startet erst, nachdem `start()` aufgelöst ist, und das Overlay erscheint erst dann, das heißt der Nutzer bekommt den Startzeitpunkt visuell angezeigt. Falls sich das Öffnen im Alltag als zu langsam erweist, meldet sich das über die 500-ms-Warnung im Log, und dann ist ein Fenster von etwa 30 Sekunden mit anschließender Freigabe der richtige nächste Schritt. Ohne belegte Latenzprobleme ist Dauerbetrieb des Mikrofons der falsche Preis.

## Tests

`tests/renderer/audio-recorder.test.ts`, acht Fälle mit Fakes für `getUserMedia` und `AudioContext`:

- Tracks werden nach einer fertigen Aufnahme gestoppt
- Tracks werden auch bei zu kurzer Aufnahme gestoppt
- jede Aufnahme öffnet einen neuen Stream, es wird keiner wiederverwendet
- ein Fehler beim Aufbau des Graphen stoppt trotzdem das Mikrofon
- parallele Starts öffnen nur einen Stream
- `dispose()` räumt eine laufende Aufnahme ab
- `dispose()` ohne laufende Aufnahme wirft nicht
- `stop()` ohne `start()` meldet sauber

## Verifikation

```bash
scripts/check-audio-assertions.sh
```

Nach App-Start, einem Diktat und zwei Minuten Wartezeit muss `PASS` kommen. Das Skript prüft den Assertion-Namen und nicht die `Resources:`-Zeile, damit fremde Halter wie ein iOS-Simulator-Audiogerät keinen Fehlalarm auslösen.

## Offene Punkte

- Handsfree-Modus hat kein Zeitlimit. Wer per Doppelklick startet und es vergisst, hält das Mikrofon beliebig lange offen. Das ist gewolltes Verhalten, aber ohne obere Schranke.
- Beide Fenster laufen mit `backgroundThrottling: false` (`src/main/windows.ts`). Für das Overlay ist das nötig, für das Hauptfenster wäre zu prüfen, ob es im Hintergrund gedrosselt werden kann.
- `ScriptProcessorNode` ist deprecated. `AudioWorkletNode` würde die Audio-Verarbeitung vom Main-Thread lösen und dabei den Zwang zur Verbindung mit `destination` beseitigen, wodurch während der Aufnahme gar kein Ausgabegerät mehr geöffnet werden müsste.
