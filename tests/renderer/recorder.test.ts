import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioRecorder } from '../../src/renderer/recorder/recorder';
import { encodeWav, peakWindowRms, resample } from '../../src/renderer/recorder/wav';

class FakeTrack {
  stopCalls = 0;
  stop(): void {
    this.stopCalls += 1;
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

class FakeNode {
  disconnectCalls = 0;
  connect(target: unknown): unknown {
    return target;
  }
  disconnect(): void {
    this.disconnectCalls += 1;
  }
}

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: unknown): void {
    if (message === 'flush') {
      setTimeout(() => this.onmessage?.({ data: { type: 'flushed' } }));
    }
  }
}

class FakeWorkletNode extends FakeNode {
  static instances: FakeWorkletNode[] = [];
  readonly port = new FakePort();
  constructor() {
    super();
    FakeWorkletNode.instances.push(this);
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static fail = false;
  state: 'running' | 'closed' = 'running';
  sampleRate: number;
  closeCalls = 0;
  readonly audioWorklet = { addModule: vi.fn(async () => undefined) };

  constructor(options?: { sampleRate?: number }) {
    if (FakeAudioContext.fail) throw new Error('AudioContext unavailable');
    this.sampleRate = options?.sampleRate ?? 48_000;
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource(): FakeNode {
    return new FakeNode();
  }

  async resume(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]) });
      this.onstop?.();
    });
  }
}

const openedStreams: FakeStream[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

function everyTrackStopped(): boolean {
  return openedStreams.length > 0 && openedStreams.every((stream) => stream.tracks.every((track) => track.stopCalls > 0));
}

function feed(value: number, samples = 16_000): void {
  const node = FakeWorkletNode.instances.at(-1);
  node?.port.onmessage?.({ data: { type: 'samples', samples: new Float32Array(samples).fill(value) } });
}

beforeEach(() => {
  openedStreams.length = 0;
  FakeAudioContext.instances = [];
  FakeAudioContext.fail = false;
  FakeWorkletNode.instances = [];

  getUserMedia = vi.fn(async () => {
    const stream = new FakeStream();
    openedStreams.push(stream);
    return stream;
  });

  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [{ kind: 'audioinput', label: 'MacBook Pro Microphone', deviceId: 'built-in' }]),
    },
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wav helpers', () => {
  it('writes a mono 16 kHz PCM header', () => {
    const view = new DataView(encodeWav(new Float32Array(16_000), 16_000));
    expect(view.byteLength).toBe(44 + 32_000);
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it('downsamples 48 kHz to a third of the samples', () => {
    expect(resample(new Float32Array(48_000), 48_000, 16_000)).toHaveLength(16_000);
  });

  it('finds the loudest window', () => {
    const samples = new Float32Array(16_000);
    samples.fill(0.5, 8_000, 8_800);
    expect(peakWindowRms(samples, 16_000)).toBeCloseTo(0.5, 2);
    expect(peakWindowRms(new Float32Array(1_600), 16_000)).toBe(0);
  });
});

describe('AudioRecorder', () => {
  it('records 16 kHz audio, encodes WAV and Opus and releases the microphone', async () => {
    const recorder = new AudioRecorder();
    await recorder.start(true);

    expect(FakeAudioContext.instances[0].sampleRate).toBe(16_000);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { exact: 'built-in' }, echoCancellation: true }),
    });

    feed(0.25);
    const result = await recorder.stop();

    expect(result.durationMs).toBe(1_000);
    expect(result.wav.byteLength).toBe(44 + 32_000);
    expect(result.opus?.byteLength).toBe(4);
    expect(result.peakRms).toBeCloseTo(0.25, 2);
    expect(everyTrackStopped()).toBe(true);
    expect(FakeAudioContext.instances[0].closeCalls).toBe(1);
  });

  it('skips the Opus encoder when it was not asked for', async () => {
    const recorder = new AudioRecorder();
    await recorder.start(false);
    feed(0.1);
    expect((await recorder.stop()).opus).toBeNull();
  });

  it('releases the microphone when cancelled', async () => {
    const recorder = new AudioRecorder();
    await recorder.start(true);
    await recorder.cancel();
    expect(everyTrackStopped()).toBe(true);
  });

  it('releases a stream that finished opening after a cancel', async () => {
    let resolveStream!: (stream: FakeStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<FakeStream>((resolve) => {
          resolveStream = (stream) => {
            openedStreams.push(stream);
            resolve(stream);
          };
        }),
    );

    const recorder = new AudioRecorder();
    const starting = recorder.start(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await recorder.cancel();
    resolveStream(new FakeStream());

    await expect(starting).rejects.toThrow('cancelled');
    expect(everyTrackStopped()).toBe(true);
  });

  it('opens no stream at all when the audio graph cannot be built', async () => {
    FakeAudioContext.fail = true;
    const recorder = new AudioRecorder();
    await expect(recorder.start(true)).rejects.toThrow('AudioContext unavailable');
    expect(openedStreams).toHaveLength(0);
  });

  it('shares one start between concurrent callers', async () => {
    const recorder = new AudioRecorder();
    await Promise.all([recorder.start(true), recorder.start(true)]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await recorder.cancel();
  });

  it('records only once per instance', async () => {
    const recorder = new AudioRecorder();
    await recorder.start(false);
    feed(0.1);
    await recorder.stop();
    await expect(recorder.start(false)).rejects.toThrow('already been used');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('falls back to the default microphone when the built-in one is gone', async () => {
    getUserMedia.mockImplementationOnce(async () => {
      throw new DOMException('gone', 'OverconstrainedError');
    });
    const recorder = new AudioRecorder();
    await recorder.start(false);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0]).toEqual({ audio: expect.not.objectContaining({ deviceId: expect.anything() }) });
    await recorder.cancel();
    expect(everyTrackStopped()).toBe(true);
  });

  it('reports a start that never happened when stopped', async () => {
    FakeAudioContext.fail = true;
    const recorder = new AudioRecorder();
    await recorder.start(false).catch(() => undefined);
    await expect(recorder.stop()).rejects.toThrow('did not start');
  });
});
