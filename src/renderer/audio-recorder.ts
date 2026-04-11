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

export class AudioRecorder {
  onLevel: ((level: number) => void) | null = null;

  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silenceNode: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private inputSampleRate = 48_000;

  private async ensureStream(): Promise<MediaStream> {
    if (this.stream) {
      return this.stream;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    return this.stream;
  }

  async start(): Promise<void> {
    if (this.audioContext) {
      return;
    }

    const stream = await this.ensureStream();
    this.audioContext = new AudioContext();
    this.inputSampleRate = this.audioContext.sampleRate;
    this.source = this.audioContext.createMediaStreamSource(stream);
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
  }

  async stop(): Promise<string> {
    if (!this.audioContext || !this.processor || !this.source || !this.silenceNode) {
      throw new Error('The recorder is not running.');
    }

    this.processor.disconnect();
    this.source.disconnect();
    this.silenceNode.disconnect();
    this.processor.onaudioprocess = null;

    await this.audioContext.close();

    this.audioContext = null;
    this.processor = null;
    this.source = null;
    this.silenceNode = null;

    const merged = mergeChunks(this.chunks);
    this.chunks = [];

    if (merged.length < 1600) {
      throw new Error('The recording was too short.');
    }

    const resampled = resample(merged, this.inputSampleRate, 16_000);
    return encodeWave(resampled, 16_000);
  }
}
