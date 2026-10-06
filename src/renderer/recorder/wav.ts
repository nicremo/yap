export const TARGET_SAMPLE_RATE = 16_000;

export function mergeChunks(chunks: Float32Array[]): Float32Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/**
 * Downsamples to 16 kHz. Only used when the platform refused a 16 kHz
 * AudioContext. Averages over each output step so frequencies above the new
 * Nyquist limit do not fold back into the speech band as noise.
 */
export function resample(input: Float32Array, inputRate: number, outputRate: number = TARGET_SAMPLE_RATE): Float32Array {
  if (inputRate === outputRate || input.length === 0) {
    return input;
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  if (ratio < 1) {
    // Upsampling (unusual for a microphone): linear interpolation.
    for (let index = 0; index < outputLength; index += 1) {
      const position = index * ratio;
      const left = Math.floor(position);
      const right = Math.min(left + 1, input.length - 1);
      const weight = position - left;
      output[index] = input[left] * (1 - weight) + input[right] * weight;
    }
    return output;
  }

  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    output[index] = sum / (end - start);
  }
  return output;
}

/** RMS of the loudest 50 ms window, 0 for silence, about 0.05 to 0.3 for speech. */
export function peakWindowRms(samples: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): number {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.05));
  let peak = 0;
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(samples.length, start + windowSize);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
    const rms = Math.sqrt(sum / (end - start));
    if (rms > peak) peak = rms;
  }
  return peak;
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): ArrayBuffer {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeTag = (offset: number, tag: string) => {
    for (let index = 0; index < tag.length; index += 1) view.setUint8(offset + index, tag.charCodeAt(index));
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, 'data');
  view.setUint32(40, dataLength, true);

  for (let index = 0, offset = 44; index < samples.length; index += 1, offset += 2) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}
