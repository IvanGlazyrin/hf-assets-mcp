/**
 * Procedural breakbeat music.
 *
 * Synthesises seamless looping electronic music tracks in four intensity tiers
 * plus a chill menu theme.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { cumsum, linspace, rms } from "./arrays.js";
import { Rng } from "./rng.js";
import { writeAudio } from "./wav.js";

export const SAMPLE_RATE = 44100;

const TWO_PI = Math.PI * 2;

/** 909-style punchy electronic kick. */
export function createKick(rng: Rng): Float64Array {
  const n = Math.floor(SAMPLE_RATE * 0.35);
  const t = linspace(0, 0.35, n, false);
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = 140 * Math.exp(-t[i] / 0.04) + 48;
  const phase = cumsum(f);
  const click = new Float64Array(n);
  for (let i = 0; i < n; i++) click[i] = Math.exp(-t[i] / 0.005) * rng.uniform(-0.5, 0.5);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const body = Math.sin((TWO_PI * phase[i]) / SAMPLE_RATE) * Math.exp(-t[i] / 0.12);
    out[i] = Math.tanh((body * 1.6 + click[i] * 0.8) * 1.2);
  }
  return out;
}

/** Crisp breakbeat snare with tone and noise snap. */
export function createSnare(rng: Rng): Float64Array {
  const n = Math.floor(SAMPLE_RATE * 0.28);
  const t = linspace(0, 0.28, n, false);
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = 190 * Math.exp(-t[i] / 0.03) + 120;
  const phase = cumsum(f);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const tone = Math.sin((TWO_PI * phase[i]) / SAMPLE_RATE) * Math.exp(-t[i] / 0.06);
    const noise = rng.uniform(-1, 1) * Math.exp(-t[i] / 0.14);
    const snap = Math.exp(-t[i] / 0.008) * 1.5;
    out[i] = Math.tanh((tone * 0.7 + noise * 1.1 + snap * 0.6) * 1.1);
  }
  return out;
}

/** Metallic hi-hat. */
export function createHat(rng: Rng, closed = true): Float64Array {
  const dur = closed ? 0.045 : 0.18;
  const n = Math.floor(SAMPLE_RATE * dur);
  const t = linspace(0, dur, n, false);
  const freqs = [2800, 3600, 4800, 6200, 7800, 9500];
  const out = new Float64Array(n);
  for (const f of freqs) {
    for (let i = 0; i < n; i++) out[i] += Math.sin(TWO_PI * f * t[i]);
  }
  const noise = rng.uniformArray(n, -1, 1);
  const decay = closed ? 0.015 : 0.06;
  for (let i = 0; i < n; i++) {
    out[i] = (out[i] * 0.35 + noise[i] * 0.65) * Math.exp(-t[i] / decay) * 0.45;
  }
  return out;
}

/** Subtractive synthesised note with a filter envelope. */
export function createSynthNote(
  freq: number,
  duration: number,
  wave: "saw" | "square" | "sine" = "saw",
  brightness = 0.5,
): Float64Array {
  const n = Math.floor(SAMPLE_RATE * duration);
  const t = linspace(0, duration, n, false);
  const sig = new Float64Array(n);

  if (wave === "saw") {
    for (let h = 1; h < 14; h++) {
      const weight = (1 / h) * Math.pow(brightness, h - 1);
      for (let i = 0; i < n; i++) sig[i] += weight * Math.sin(TWO_PI * freq * h * t[i]);
    }
  } else if (wave === "square") {
    for (let h = 1; h < 14; h += 2) {
      for (let i = 0; i < n; i++) sig[i] += (1 / h) * Math.sin(TWO_PI * freq * h * t[i]);
    }
  } else {
    for (let i = 0; i < n; i++) sig[i] = Math.sin(TWO_PI * freq * t[i]);
  }

  // ADSR envelope: fast attack, gentle release.
  const env = new Float64Array(n).fill(1);
  const att = Math.min(Math.floor(0.015 * SAMPLE_RATE), Math.floor(n * 0.1));
  const rel = Math.min(Math.floor(0.05 * SAMPLE_RATE), Math.floor(n * 0.3));
  for (let i = 0; i < att; i++) env[i] = att > 1 ? i / (att - 1) : 1;
  for (let i = 0; i < rel; i++) env[n - rel + i] = rel > 1 ? 1 - i / (rel - 1) : 0;
  for (let i = 0; i < n; i++) sig[i] *= env[i];
  return sig;
}

/** Mix a mono source into a stereo buffer with panning. */
export function mixInto(
  target: [Float64Array, Float64Array],
  source: Float64Array,
  startSample: number,
  pan = 0,
  vol = 1,
): void {
  const total = target[0].length;
  if (startSample >= total) return;
  const srcLen = Math.min(source.length, total - startSample);
  if (srcLen <= 0) return;

  const panL = Math.cos(((pan + 1) * Math.PI) / 4);
  const panR = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < srcLen; i++) {
    target[0][startSample + i] += source[i] * panL * vol;
    target[1][startSample + i] += source[i] * panR * vol;
  }
}

/** Crossfade the ends into a seamless loop, normalise and write. */
export function exportTrack(filename: string, audio: Float64Array[], targetDbfs = -19): void {
  const channels = audio.map((c) => c.slice());
  const frames = channels[0].length;

  // Seamless loop equal power crossfade on the last 1.2 s.
  const fadeLen = Math.floor(1.2 * SAMPLE_RATE);
  if (frames > fadeLen * 2) {
    const loopLen = frames - fadeLen;
    for (let c = 0; c < channels.length; c++) {
      const body = channels[c].slice(0, loopLen);
      const tail = channels[c].slice(loopLen);
      for (let i = 0; i < fadeLen; i++) {
        const u = i / fadeLen;
        body[i] = body[i] * Math.sin(u * Math.PI * 0.5) + tail[i] * Math.cos(u * Math.PI * 0.5);
      }
      channels[c] = body;
    }
  }

  const level = rms(Float64Array.from(channels.flatMap((c) => Array.from(c))));
  let out = channels;
  if (level > 1e-6) {
    const gain = Math.pow(10, (targetDbfs - 20 * Math.log10(level)) / 20);
    out = channels.map((c) => c.map((v) => v * gain));
  }

  // Soft limiter.
  out = out.map((c) => c.map((v) => Math.tanh(v * 1.1) * 0.96));

  mkdirSync(join(filename, ".."), { recursive: true });
  writeAudio(filename, { channels: out, sampleRate: SAMPLE_RATE });
}

/** The four intensity tiers plus the menu theme. */
export function generateAll(outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const files = [
    ...generateIntensityTracks(outDir),
    ...generateMenuTheme(outDir),
  ];
  return files;
}

export function generateIntensityTracks(outDir: string): string[] {
  const rng = new Rng(21);
  const bpm = 130;
  const spb = 60 / bpm; // seconds per beat (~0.4615s)
  const spbar = spb * 4; // seconds per 4/4 bar (~1.846s)
  const bars = 16; // 16-bar loop (~29.54s)
  const totalDur = bars * spbar;
  const nSamples = Math.floor(SAMPLE_RATE * (totalDur + 1.5)); // extra for tail crossfade

  const kick = createKick(rng);
  const snare = createSnare(rng);
  const hatC = createHat(rng, true);
  const hatO = createHat(rng, false);

  // Chord progression: Dm9 -> Bbmaj7 -> Gm7 -> A7alt.
  const chordRoots = [146.83, 116.54, 98.0, 110.0];
  const chordPads = [
    [146.83, 220.0, 261.63, 329.63, 440.0],
    [116.54, 174.61, 220.0, 293.66, 349.23],
    [98.0, 146.83, 174.61, 220.0, 293.66],
    [110.0, 164.81, 196.0, 277.18, 329.63],
  ];

  const files: string[] = [];
  for (const tier of ["calm", "steady", "intense", "frantic"]) {
    const left = new Float64Array(nSamples);
    const right = new Float64Array(nSamples);
    const track: [Float64Array, Float64Array] = [left, right];

    for (let barIdx = 0; barIdx <= bars; barIdx++) {
      const chordIdx = Math.floor(barIdx / 2) % 4;
      const barSample = Math.floor(barIdx * spbar * SAMPLE_RATE);

      // 1. Pads
      if (tier === "calm" || tier === "steady" || tier === "intense") {
        const padLen = spbar * 2.1;
        for (const noteF of chordPads[chordIdx]) {
          const note = createSynthNote(noteF, padLen, "saw", 0.25);
          mixInto(track, note, barSample, rng.uniform(-0.4, 0.4), tier === "calm" ? 0.18 : 0.14);
        }
      }

      // 2. Arpeggio plucks
      const arpNotes = chordPads[chordIdx];
      for (let step = 0; step < 16; step++) {
        const stepSample = barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE);
        const noteF = arpNotes[step % arpNotes.length] * (tier === "frantic" ? 1 : 2);
        const arp = createSynthNote(noteF, spb * 0.35, "square", 0.35);
        mixInto(track, arp, stepSample, ((step % 4) - 1.5) * 0.4, 0.16);
      }

      // 3. Bassline
      const rootF = chordRoots[chordIdx];
      if (tier === "steady" || tier === "intense" || tier === "frantic") {
        const bassPattern = [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0];
        const bassVol = tier === "steady" ? 0.42 : 0.52;
        for (let step = 0; step < bassPattern.length; step++) {
          if (!bassPattern[step]) continue;
          const stepSample = barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE);
          let freq = rootF * 0.5; // sub octave
          if (step === 6 || step === 14) freq *= 1.5; // fifth bounce
          let bass = createSynthNote(freq, spb * 0.3, "saw", tier === "frantic" ? 0.85 : 0.6);
          if (tier === "intense" || tier === "frantic") {
            bass = bass.map((v) => Math.tanh(v * 2.2)); // acid drive
          }
          mixInto(track, bass, stepSample, 0, bassVol);
        }
      }

      // 4. Drums and percussion
      if (tier === "calm") {
        for (let beat = 0; beat < 4; beat++) {
          const bSample = barSample + Math.floor(beat * spb * SAMPLE_RATE);
          if (beat === 0 || (beat === 2 && barIdx % 2 === 1)) mixInto(track, kick, bSample, 0, 0.35);
          if (beat === 1 || beat === 3) mixInto(track, snare, bSample, 0, 0.25);
        }
        for (let h = 0; h < 8; h++) {
          const hSample = barSample + Math.floor(h * (spb / 2) * SAMPLE_RATE);
          mixInto(track, hatC, hSample, 0.25, 0.2);
        }
      } else if (tier === "steady") {
        const kickPattern = [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
        for (let step = 0; step < kickPattern.length; step++) {
          if (!kickPattern[step]) continue;
          mixInto(track, kick, barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE), 0, 0.75);
        }
        for (const [step, sVol] of [
          [4, 0.7],
          [12, 0.75],
          [7, 0.35],
          [15, 0.3],
        ] as const) {
          mixInto(track, snare, barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE), 0, sVol);
        }
        for (let h = 0; h < 16; h++) {
          const hSample = barSample + Math.floor(h * (spb / 4) * SAMPLE_RATE);
          if (h % 4 === 2) mixInto(track, hatO, hSample, -0.3, 0.35);
          else mixInto(track, hatC, hSample, 0.25, 0.25);
        }
      } else if (tier === "intense") {
        const kickPattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
        for (let step = 0; step < kickPattern.length; step++) {
          if (!kickPattern[step]) continue;
          mixInto(track, kick, barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE), 0, 0.85);
        }
        for (const [step, sVol] of [
          [4, 0.8],
          [12, 0.85],
          [6, 0.4],
          [10, 0.35],
          [14, 0.45],
        ] as const) {
          mixInto(track, snare, barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE), 0, sVol);
        }
        for (let h = 0; h < 16; h++) {
          const hSample = barSample + Math.floor(h * (spb / 4) * SAMPLE_RATE);
          const sound = h % 2 === 1 ? hatO : hatC;
          mixInto(track, sound, hSample, h % 2 === 0 ? 0.3 : -0.3, 0.3);
        }
      } else {
        for (let step = 0; step < 16; step++) {
          const sSample = barSample + Math.floor(step * (spb / 4) * SAMPLE_RATE);
          if ([0, 3, 6, 8, 11, 14].includes(step)) mixInto(track, kick, sSample, 0, 0.9);
          if ([4, 9, 12, 15].includes(step)) mixInto(track, snare, sSample, 0, 0.85);
          mixInto(track, step % 2 === 1 ? hatO : hatC, sSample, rng.uniform(-0.5, 0.5), 0.35);
        }
      }
    }

    const outPath = join(outDir, `${tier}.wav`);
    const cut = Math.floor(totalDur * SAMPLE_RATE) + Math.floor(1.2 * SAMPLE_RATE);
    exportTrack(outPath, [left.slice(0, cut), right.slice(0, cut)], -19);
    files.push(outPath);
  }
  return files;
}

export function generateMenuTheme(outDir: string): string[] {
  const rng = new Rng(22);
  const bpm = 100;
  const spb = 60 / bpm;
  const spbar = spb * 4;
  const bars = 8;
  const totalDur = bars * spbar;
  const nSamples = Math.floor(SAMPLE_RATE * (totalDur + 1.5));

  const kick = createKick(rng);
  const snare = createSnare(rng);
  const hatC = createHat(rng, true);
  const hatO = createHat(rng, false);

  const left = new Float64Array(nSamples);
  const right = new Float64Array(nSamples);
  const track: [Float64Array, Float64Array] = [left, right];

  // Ambient chord progression in F minor (Fm9 -> Dbmaj7 -> Bbm9 -> C7alt).
  const chords = [
    [174.61, 261.63, 311.13, 392.0, 523.25],
    [138.59, 207.65, 261.63, 329.63, 415.3],
    [116.54, 174.61, 207.65, 277.18, 349.23],
    [130.81, 196.0, 246.94, 311.13, 392.0],
  ];

  for (let barIdx = 0; barIdx <= bars; barIdx++) {
    const chord = chords[Math.floor(barIdx / 2) % 4];
    const barSample = Math.floor(barIdx * spbar * SAMPLE_RATE);

    // Warm rhodes/analog pad
    for (const f of chord) {
      const pad = createSynthNote(f, spbar * 2.2, "saw", 0.2);
      mixInto(track, pad, barSample, rng.uniform(-0.3, 0.3), 0.15);
    }

    // Chill sub bass
    const subF = chord[0] * 0.5;
    for (const beat of [0, 2]) {
      const sub = createSynthNote(subF, spb * 1.5, "sine");
      mixInto(track, sub, barSample + Math.floor(beat * spb * SAMPLE_RATE), 0, 0.45);
    }

    // Slow rhythmic breakbeat
    for (let beat = 0; beat < 4; beat++) {
      const bSample = barSample + Math.floor(beat * spb * SAMPLE_RATE);
      if (beat === 0 || beat === 2.5) mixInto(track, kick, bSample, 0, 0.55);
      if (beat === 1 || beat === 3) mixInto(track, snare, bSample, 0, 0.4);
    }

    // Shuffled hi-hats
    for (let h = 0; h < 8; h++) {
      const hSample = barSample + Math.floor(h * (spb / 2) * SAMPLE_RATE);
      mixInto(track, h === 3 || h === 7 ? hatO : hatC, hSample, 0.2, 0.22);
    }
  }

  const outPath = join(outDir, "menu.wav");
  const cut = Math.floor(totalDur * SAMPLE_RATE) + Math.floor(1.2 * SAMPLE_RATE);
  exportTrack(outPath, [left.slice(0, cut), right.slice(0, cut)], -20);
  return [outPath];
}
