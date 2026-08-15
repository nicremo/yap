function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

function resample(input: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    output[index] = input[left] * (1 - weight) + input[right] * weight;
  }

  return output;
}

function encodeWave(audio: Float32Array, sampleRate: number): string {
  const bytesPerSample = 2;
  const dataLength = audio.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeTag = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const sample of audio) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

// Opening the microphone is a device round trip through coreaudiod. Anything
// beyond this is slow enough that the first spoken word can be clipped, so it
// is worth a log line in the field rather than silence.
const SLOW_OPEN_WARNING_MS = 500;

/**
 * Owns the microphone for exactly one recording.
 *
 * The device is opened when a recording starts and handed back the moment it
 * ends. Nothing is kept warm between recordings, because a live input track
 * makes coreaudiod hold a `PreventUserIdleSystemSleep` assertion for the whole
 * time, which blocks idle sleep and keeps the audio service process busy.
 *
 * Closing the `AudioContext` alone is not enough: the context owns the graph,
 * the `MediaStreamTrack` owns the device. Both have to go.
 */
export class AudioRecorder {
  onLevel: ((level: number) => void) | null = null;

  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silenceNode: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private inputSampleRate = 48_000;
  private pendingStart: Promise<void> | null = null;

  get isCapturing(): boolean {
    return this.audioContext !== null;
  }

  private async findBuiltInMicrophone(): Promise<string | undefined> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const builtIn = inputs.find(
      (d) => d.label.toLowerCase().includes('macbook') || d.label.toLowerCase().includes('built-in'),
    );
    return builtIn?.deviceId;
  }

  private async openStream(): Promise<MediaStream> {
    const builtInId = await this.findBuiltInMicrophone();

    // echoCancellation wires the output side of the graph up as the AEC
    // reference signal for this track. Measured consequence: once an
    // AudioContext has been connected to `destination`, closing that context
    // does not release the output device while this track is still live, so a
    // leaked track holds the speaker open as well as the microphone. Stopping
    // the track releases both.
    return navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(builtInId ? { deviceId: { exact: builtInId } } : {}),
      },
    });
  }

  /**
   * Hands every audio resource back to the system. Safe to call at any point,
   * safe to call twice, and never throws on a half-built graph.
   */
  private async release(): Promise<void> {
    const processor = this.processor;
    const source = this.source;
    const silenceNode = this.silenceNode;
    const audioContext = this.audioContext;
    const stream = this.stream;

    this.processor = null;
    this.source = null;
    this.silenceNode = null;
    this.audioContext = null;
    this.stream = null;

    if (processor) {
      processor.onaudioprocess = null;
      processor.disconnect();
    }
    source?.disconnect();
    silenceNode?.disconnect();

    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close();
    }

    // This is the step that actually releases the microphone. Without it the
    // device stays open for the rest of the app's lifetime.
    for (const track of stream?.getTracks() ?? []) {
      track.stop();
    }
  }

  async start(): Promise<void> {
    if (this.pendingStart) {
      return this.pendingStart;
    }
    if (this.audioContext) {
      return;
    }

    this.pendingStart = this.open().finally(() => {
      this.pendingStart = null;
    });

    return this.pendingStart;
  }

  private async open(): Promise<void> {
    const openedAt = Date.now();
    this.stream = await this.openStream();

    const elapsed = Date.now() - openedAt;
    if (elapsed > SLOW_OPEN_WARNING_MS) {
      console.warn(`[openwhisp] microphone took ${elapsed}ms to open`);
    }

    try {
      this.audioContext = new AudioContext();
      this.inputSampleRate = this.audioContext.sampleRate;
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.silenceNode = this.audioContext.createGain();
      this.silenceNode.gain.value = 0;
      this.chunks = [];

      this.processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        this.chunks.push(new Float32Array(data));

        if (this.onLevel) {
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            sum += data[i] * data[i];
          }
          this.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 5));
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.silenceNode);
      this.silenceNode.connect(this.audioContext.destination);
      await this.audioContext.resume();
    } catch (error) {
      await this.release();
      throw error;
    }
  }

  async stop(): Promise<string> {
    if (!this.audioContext) {
      // A start that failed halfway can still leave a stream behind.
      await this.release();
      throw new Error('The recorder is not running.');
    }

    const sampleRate = this.inputSampleRate;
    const recorded = this.chunks;
    this.chunks = [];

    // Release before any validation, so a rejected recording never keeps the
    // device open.
    await this.release();

    const merged = mergeChunks(recorded);
    if (merged.length < 1600) {
      throw new Error('The recording was too short.');
    }

    const resampled = resample(merged, sampleRate, 16_000);
    return encodeWave(resampled, 16_000);
  }

  /** Release everything without producing a recording. */
  async dispose(): Promise<void> {
    this.chunks = [];
    await this.release();
  }
}
