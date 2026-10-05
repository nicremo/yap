import { encodeWav, mergeChunks, peakWindowRms, resample, TARGET_SAMPLE_RATE } from './wav';

/* Runs on the audio thread. Collects samples into small blocks and hands
   them to the page; with no outputs the node needs no connection to the
   speakers, so recording never opens an output device. */
const CAPTURE_WORKLET = `
class YapCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(1024);
    this.length = 0;
    this.port.onmessage = (event) => {
      if (event.data === 'flush') {
        this.send();
        this.port.postMessage({ type: 'flushed' });
      }
    };
  }

  send() {
    if (this.length === 0) return;
    const samples = this.block.slice(0, this.length);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let index = 0; index < channel.length; index += 1) {
        this.block[this.length++] = channel[index];
        if (this.length === this.block.length) this.send();
      }
    }
    return true;
  }
}
registerProcessor('yap-capture', YapCapture);
`;

let workletUrl: string | null = null;
function getWorkletUrl(): string {
  workletUrl ??= URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
  return workletUrl;
}

const OPUS_MIME = 'audio/webm;codecs=opus';
/* Speech-grade Opus: a tenth of the WAV size, so the upload is over in one
   or two round trips instead of a dozen. */
const OPUS_BITRATE = 32_000;
/* Audio still travelling through the capture pipeline when the key comes up
   would otherwise clip the last syllable. */
const TAIL_MS = 60;
const SLOW_OPEN_WARNING_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, sleep(ms).then(() => fallback)]);
}

let builtInMicrophoneId: string | null | undefined;

/* MacBooks get their built-in microphone even when headphones are connected:
   recording through AirPods switches them to the low-quality headset profile
   for everything else that is playing. */
async function findBuiltInMicrophone(): Promise<string | null> {
  if (builtInMicrophoneId !== undefined) return builtInMicrophoneId;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const builtIn = devices.find(
      (device) =>
        device.kind === 'audioinput' &&
        /macbook|built-in|integriert/i.test(device.label),
    );
    // Labels are empty before the first permission grant; do not cache that.
    if (devices.some((device) => device.label)) {
      builtInMicrophoneId = builtIn?.deviceId ?? null;
    }
    return builtIn?.deviceId ?? null;
  } catch {
    return null;
  }
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener?.('devicechange', () => {
    builtInMicrophoneId = undefined;
  });
}

async function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  const constraints = (id: string | null): MediaStreamConstraints => ({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(id ? { deviceId: { exact: id } } : {}),
    },
  });

  try {
    return await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    // The preferred device went away (unplugged, renamed): use the default one.
    if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError' || name === 'NotReadableError')) {
      builtInMicrophoneId = undefined;
      return navigator.mediaDevices.getUserMedia(constraints(null));
    }
    throw error;
  }
}

export function describeMicrophoneError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow Yap under System Settings, Privacy & Security, Microphone.';
    case 'NotFoundError':
      return 'No microphone was found.';
    case 'NotReadableError':
      return 'The microphone is in use by another app or unavailable.';
    default:
      return error instanceof Error ? error.message : 'The microphone could not start.';
  }
}

export interface RecordingResult {
  wav: ArrayBuffer;
  opus: ArrayBuffer | null;
  durationMs: number;
  peakRms: number;
}

/**
 * One recording. The microphone opens in start() and is handed back the
 * moment the recording ends: a live input track keeps macOS from idle sleep
 * and the audio service busy, so nothing is kept warm in between.
 */
export class AudioRecorder {
  onLevel: ((level: number) => void) | null = null;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private opusChunks: Blob[] = [];
  private chunks: Float32Array[] = [];
  private sampleRate = TARGET_SAMPLE_RATE;
  private starting: Promise<void> | null = null;
  private released = false;
  private lastLevelAt = 0;

  /** A recorder records once; every dictation gets a new instance. */
  start(encodeOpus: boolean): Promise<void> {
    if (this.released) {
      return Promise.reject(new Error('This recorder has already been used.'));
    }
    this.starting ??= this.open(encodeOpus);
    return this.starting;
  }

  private createContext(): AudioContext {
    try {
      // Let the browser resample the microphone to Whisper's native rate.
      return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
    } catch {
      return new AudioContext({ latencyHint: 'interactive' });
    }
  }

  private async open(encodeOpus: boolean): Promise<void> {
    const openedAt = performance.now();
    const context = this.createContext();
    this.context = context;
    this.sampleRate = context.sampleRate;

    try {
      // Device lookup, module load and the microphone open all overlap.
      const moduleLoaded = context.audioWorklet.addModule(getWorkletUrl());
      const stream = await openMicrophone(await findBuiltInMicrophone());
      this.stream = stream;
      await moduleLoaded;

      if (this.released) {
        throw new Error('The recording was cancelled.');
      }

      const node = new AudioWorkletNode(context, 'yap-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
        if (event.data.type === 'samples' && event.data.samples) {
          this.chunks.push(event.data.samples);
          this.reportLevel(event.data.samples);
        }
      };
      this.node = node;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(node);

      if (context.state !== 'running') {
        await context.resume();
      }

      if (encodeOpus && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(OPUS_MIME)) {
        try {
          const recorder = new MediaRecorder(stream, { mimeType: OPUS_MIME, audioBitsPerSecond: OPUS_BITRATE });
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) this.opusChunks.push(event.data);
          };
          recorder.start();
          this.mediaRecorder = recorder;
        } catch (error) {
          // The WAV path covers this.
          console.warn('[yap] Opus encoder unavailable:', error);
        }
      }

      const elapsed = performance.now() - openedAt;
      if (elapsed > SLOW_OPEN_WARNING_MS) {
        console.warn(`[yap] microphone took ${Math.round(elapsed)} ms to open`);
      }
    } catch (error) {
      await this.release();
      throw error;
    }
  }

  private reportLevel(samples: Float32Array): void {
    if (!this.onLevel) return;
    const now = performance.now();
    if (now - this.lastLevelAt < 40) return;
    this.lastLevelAt = now;
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
    this.onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
  }

  private flushWorklet(): Promise<void> {
    const node = this.node;
    if (!node) return Promise.resolve();
    const flushed = new Promise<void>((resolve) => {
      const previous = node.port.onmessage;
      node.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
        if (event.data.type === 'flushed') {
          resolve();
          return;
        }
        previous?.call(node.port, event);
      };
    });
    node.port.postMessage('flush');
    return withTimeout(flushed, 150, undefined);
  }

  private stopMediaRecorder(): Promise<Blob | null> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.resolve(this.opusChunks.length > 0 ? new Blob(this.opusChunks, { type: OPUS_MIME }) : null);
    }
    const stopped = new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => resolve(this.opusChunks.length > 0 ? new Blob(this.opusChunks, { type: OPUS_MIME }) : null);
      recorder.onerror = () => resolve(null);
    });
    recorder.stop();
    return withTimeout(stopped, 500, null);
  }

  /** Hands every audio resource back. Safe to call at any point and more than once. */
  private async release(): Promise<void> {
    this.released = true;
    const { node, source, context, stream, mediaRecorder } = this;
    this.node = null;
    this.source = null;
    this.context = null;
    this.stream = null;
    this.mediaRecorder = null;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {
        // Already stopping.
      }
    }
    if (node) node.port.onmessage = null;
    source?.disconnect();
    node?.disconnect();

    // Stopping the tracks is what actually releases the microphone.
    for (const track of stream?.getTracks() ?? []) track.stop();

    if (context && context.state !== 'closed') {
      await context.close().catch(() => undefined);
    }
  }

  async stop(): Promise<RecordingResult> {
    try {
      await this.starting;
    } catch {
      // start() already released everything; the checks below report it.
    }

    if (!this.context) {
      await this.release();
      throw new Error('The microphone did not start.');
    }

    await sleep(TAIL_MS);
    const [, opusBlob] = await Promise.all([this.flushWorklet(), this.stopMediaRecorder()]);
    const sampleRate = this.sampleRate;
    const chunks = this.chunks;
    this.chunks = [];
    await this.release();

    const samples = resample(mergeChunks(chunks), sampleRate, TARGET_SAMPLE_RATE);
    const opus = opusBlob ? await opusBlob.arrayBuffer() : null;

    return {
      wav: encodeWav(samples, TARGET_SAMPLE_RATE),
      opus: opus && opus.byteLength > 0 ? opus : null,
      durationMs: Math.round((samples.length / TARGET_SAMPLE_RATE) * 1000),
      peakRms: peakWindowRms(samples, TARGET_SAMPLE_RATE),
    };
  }

  /** Drops the recording without producing anything. */
  async cancel(): Promise<void> {
    this.chunks = [];
    this.opusChunks = [];
    await this.release();
  }
}
