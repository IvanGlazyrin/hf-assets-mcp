/**
 * Post-processing pipeline for game audio assets.
 *
 * - Trims leading/trailing silence
 * - Seamless equal-power loop crossfade
 * - Loudness normalisation to target dBFS RMS
 * - OGG / WAV export with measurement reporting
 */

import { maxAbs, rms } from "./arrays.js";
import { readAudio, writeAudio, type Audio } from "./wav.js";

/** Trim leading and trailing silence. */
export function trimSilence(audio: Audio, thresholdDb = -60): Audio {
  const thresh = Math.pow(10, thresholdDb / 20);
  const frames = audio.channels[0].length;
  const mono = audio.channels.length === 1;

  let first = -1;
  let last = -1;
  for (let i = 0; i < frames; i++) {
    let mag: number;
    if (mono) {
      mag = Math.abs(audio.channels[0][i]);
    } else {
      mag = 0;
      for (const ch of audio.channels) mag = Math.max(mag, Math.abs(ch[i]));
    }
    if (mag > thresh) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return audio;

  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((ch) => ch.slice(first, last + 1)),
  };
}

/**
 * Applies an equal-power crossfade across the loop boundary to eliminate seams.
 *
 * The last `fadeSamples` are blended into the first `fadeSamples` using
 * sin/cos curves: sin(t)^2 + cos(t)^2 == 1 preserving RMS power.
 */
export function equalPowerLoopCrossfade(audio: Audio, fadeSamples = 4410): Audio {
  const frames = audio.channels[0].length;
  let fade = fadeSamples;
  if (fade >= Math.floor(frames / 2)) fade = Math.floor(frames / 4);

  const outLen = frames - fade;
  const out = audio.channels.map((ch) => ch.slice(0, outLen));

  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const gainIn = Math.sin(t * Math.PI * 0.5);
    const gainOut = Math.cos(t * Math.PI * 0.5);
    for (let c = 0; c < out.length; c++) {
      const head = audio.channels[c][i];
      const tail = audio.channels[c][outLen + i];
      out[c][i] = head * gainIn + tail * gainOut;
    }
  }
  return { channels: out, sampleRate: audio.sampleRate };
}

/** Scale to a target RMS level in dBFS, without clipping. */
export function normaliseRms(audio: Audio, targetDbfs = -19): Audio {
  const all = audio.channels.flatMap((ch) => Array.from(ch));
  const level = rms(Float64Array.from(all));
  if (level < 1e-9) return audio;

  const currentDbfs = 20 * Math.log10(level);
  const gain = Math.pow(10, (targetDbfs - currentDbfs) / 20);
  const scaled = audio.channels.map((ch) => ch.map((v) => v * gain));

  // Prevent clipping.
  let peak = 0;
  for (const ch of scaled) peak = Math.max(peak, maxAbs(ch));
  if (peak > 0.99) {
    const k = 0.99 / peak;
    return { channels: scaled.map((ch) => ch.map((v) => v * k)), sampleRate: audio.sampleRate };
  }
  return { channels: scaled, sampleRate: audio.sampleRate };
}

/** How big the step is across the loop boundary. */
export function measureSeamDelta(audio: Audio): number {
  let worst = 0;
  for (const ch of audio.channels) {
    worst = Math.max(worst, Math.abs(ch[0] - ch[ch.length - 1]));
  }
  return worst;
}

export interface Processed {
  path: string;
  rmsDbfs: number;
  seam: number;
  seconds: number;
}

/** Process one file and write the result. */
export function processFile(
  inputPath: string,
  outputPath: string,
  targetDbfs = -19,
  fadeMs = 100,
  loop = true,
): Processed {
  let data = readAudio(inputPath);
  data = trimSilence(data);

  if (loop) {
    const fadeSamples = Math.floor(data.sampleRate * (fadeMs / 1000));
    data = equalPowerLoopCrossfade(data, fadeSamples);
  }

  data = normaliseRms(data, targetDbfs);
  const seam = loop ? measureSeamDelta(data) : 0;

  writeAudio(outputPath, data);

  const all = Float64Array.from(data.channels.flatMap((ch) => Array.from(ch)));
  const finalRms = 20 * Math.log10(Math.max(rms(all), 1e-9));
  return {
    path: outputPath,
    rmsDbfs: Math.round(finalRms * 100) / 100,
    seam: Math.round(seam * 1e5) / 1e5,
    seconds: Math.round((data.channels[0].length / data.sampleRate) * 1000) / 1000,
  };
}
