import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioRecorder } from '../../src/renderer/audio-recorder';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stopCalls = 0;

  stop(): void {
    this.stopCalls += 1;
    this.readyState = 'ended';
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];

  getTracks(): FakeTrack[] {
    return this.tracks;
  }

  getAudioTracks(): FakeTrack[] {
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

class FakeProcessor extends FakeNode {
  onaudioprocess: ((event: unknown) => void) | null = null;
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: 'running' | 'closed' = 'running';
  sampleRate = 48_000;
  destination = new FakeNode();
  closeCalls = 0;
  resumeCalls = 0;

  readonly source = new FakeNode();
  readonly processor = new FakeProcessor();
  readonly gain = new FakeGain();

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource(): FakeNode {
    return this.source;
  }

  createScriptProcessor(): FakeProcessor {
    return this.processor;
  }

  createGain(): FakeGain {
    return this.gain;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
  }
}

const openedStreams: FakeStream[] = [];
let getUserMedia: ReturnType<typeof vi.fn>;

function latestContext(): FakeAudioContext {
  const context = FakeAudioContext.instances.at(-1);
  if (!context) throw new Error('No AudioContext was created.');
  return context;
}

function feed(samples: number): void {
  const data = new Float32Array(samples).fill(0.1);
  latestContext().processor.onaudioprocess?.({
    inputBuffer: { getChannelData: () => data },
  });
}

function everyTrackStopped(): boolean {
  return openedStreams.every((stream) => stream.tracks.every((track) => track.stopCalls > 0));
}

beforeEach(() => {
  openedStreams.length = 0;
  FakeAudioContext.instances = [];

  getUserMedia = vi.fn(async () => {
    const stream = new FakeStream();
    openedStreams.push(stream);
    return stream;
  });

  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', label: 'MacBook Pro Microphone', deviceId: 'built-in' },
      ]),
    },
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AudioRecorder resource release', () => {
  it('stops every microphone track once a recording finished', async () => {
    const recorder = new AudioRecorder();

    await recorder.start();
    feed(4096);
    const wav = await recorder.stop();

    expect(wav.length).toBeGreaterThan(0);
    expect(everyTrackStopped()).toBe(true);
    expect(latestContext().closeCalls).toBe(1);
    expect(recorder.isCapturing).toBe(false);
  });

  it('stops every microphone track when the recording was too short', async () => {
    const recorder = new AudioRecorder();

    await recorder.start();
    feed(128);

    await expect(recorder.stop()).rejects.toThrow('The recording was too short.');
    expect(everyTrackStopped()).toBe(true);
    expect(latestContext().closeCalls).toBe(1);
  });

  it('opens a fresh stream for every recording instead of keeping one warm', async () => {
    const recorder = new AudioRecorder();

    await recorder.start();
    feed(4096);
    await recorder.stop();

    await recorder.start();
    feed(4096);
    await recorder.stop();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(openedStreams).toHaveLength(2);
    expect(everyTrackStopped()).toBe(true);
  });

  it('stops the microphone when the audio graph fails to start', async () => {
    vi.stubGlobal('AudioContext', class {
      constructor() {
        throw new Error('AudioContext unavailable');
      }
    });

    const recorder = new AudioRecorder();

    await expect(recorder.start()).rejects.toThrow('AudioContext unavailable');
    expect(openedStreams).toHaveLength(1);
    expect(everyTrackStopped()).toBe(true);
    expect(recorder.isCapturing).toBe(false);
  });

  it('never opens a second stream while a start is already in flight', async () => {
    const recorder = new AudioRecorder();

    await Promise.all([recorder.start(), recorder.start()]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);

    feed(4096);
    await recorder.stop();
    expect(everyTrackStopped()).toBe(true);
  });

  it('releases an active recording on dispose', async () => {
    const recorder = new AudioRecorder();

    await recorder.start();
    feed(4096);
    await recorder.dispose();

    expect(everyTrackStopped()).toBe(true);
    expect(latestContext().closeCalls).toBe(1);
    expect(recorder.isCapturing).toBe(false);
  });

  it('is safe to dispose when nothing is running', async () => {
    const recorder = new AudioRecorder();

    await expect(recorder.dispose()).resolves.toBeUndefined();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports that it is not running when stop is called without a start', async () => {
    const recorder = new AudioRecorder();

    await expect(recorder.stop()).rejects.toThrow('The recorder is not running.');
  });
});
