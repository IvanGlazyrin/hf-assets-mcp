/**
 * High-fidelity procedural audio synthesizer for Foley, crashes and engine sound.
 *
 * Generates broadcast-quality 44.1kHz 16-bit PCM audio assets for:
 * - Heavy metal crash & crumpled chassis impact with glass shatter
 * - Tyre skid / drift stick-slip friction loop
 * - Boost ignition boom and turbine roar
 * - Rich crossplane V8 engine rumble loop
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { convolveSame, cumsum, hanning, linspace, maxAbs, rms, roll } from "./arrays.js";
import { Rng } from "./rng.js";
import { writeAudio } from "./wav.js";

export const SAMPLE_RATE = 44100;

const TWO_PI = Math.PI * 2;

/** Write a stereo file at a target level, with a soft-clip limiter. */
export function saveWav(filename: string, channels: Float64Array[], targetDbfs = -18): void {
  let out = channels;
  if (out.length === 1) out = [out[0], out[0]];

  const level = rms(Float64Array.from(out.flatMap((c) => Array.from(c))));
  if (level > 1e-6) {
    const gain = Math.pow(10, (targetDbfs - 20 * Math.log10(level)) / 20);
    out = out.map((c) => c.map((v) => v * gain));
  }

  // Soft clip limiter to prevent harsh digital clipping.
  out = out.map((c) => c.map((v) => Math.tanh(v * 1.05) * 0.95));

  mkdirSync(join(filename, ".."), { recursive: true });
  writeAudio(filename, { channels: out, sampleRate: SAMPLE_RATE });
}

/** Simulates a heavy vehicle collision: shockwave, crumple, sub thud and glass. */
export function makeHeavyCrash(duration = 1.8, seed = 4): Float64Array[] {
  const rng = new Rng(seed);
  const n = Math.floor(SAMPLE_RATE * duration);
  const t = linspace(0, duration, n, false);

  // 1. Initial shockwave impact impulse
  const impulse = new Float64Array(n);
  for (let i = 0; i < n; i++) impulse[i] = Math.exp(-t[i] / 0.015) * rng.uniform(-1, 1);

  // 2. Deep sub-bass chassis thud
  const thud = new Float64Array(n);
  {
    const f = new Float64Array(n);
    for (let i = 0; i < n; i++) f[i] = 75 * Math.exp(-t[i] / 0.18) + 35;
    const phase = cumsum(f);
    for (let i = 0; i < n; i++) {
      thud[i] = Math.tanh(Math.sin((TWO_PI * phase[i]) / SAMPLE_RATE) * Math.exp(-t[i] / 0.45) * 2.2 * 1.5);
    }
  }

  // 3. Resonant crumpling metal modes
  const metal = new Float64Array(n);
  {
    const modalFreqs = [185, 310, 520, 840, 1420, 2100];
    const decayTimes = [0.65, 0.5, 0.38, 0.28, 0.18, 0.12];
    const weights = [1.2, 1.0, 0.8, 0.6, 0.4, 0.25];
    for (let m = 0; m < modalFreqs.length; m++) {
      const f = modalFreqs[m];
      const drift = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        drift[i] = f * (1 - 0.15 * Math.exp(-t[i] / 0.3) + 0.05 * Math.sin(TWO_PI * 12 * t[i]));
      }
      const phase = cumsum(drift);
      for (let i = 0; i < n; i++) {
        metal[i] +=
          weights[m] * Math.sin((TWO_PI * phase[i]) / SAMPLE_RATE) * Math.exp(-t[i] / decayTimes[m]);
      }
    }
  }

  // 4. Metal crunching friction
  const crunchEnv = new Float64Array(n);
  for (let i = 0; i < n; i++) crunchEnv[i] = (t[i] / 0.05) * Math.exp(-t[i] / 0.25);
  const crunchKernel = hanning(32);
  for (let i = 0; i < crunchKernel.length; i++) crunchKernel[i] /= 16;
  const crunch = convolveSame(rng.uniformArray(n, -1, 1), crunchKernel);
  for (let i = 0; i < n; i++) crunch[i] *= crunchEnv[i] * 1.5;

  // 5. Shattering safety glass cascade
  const glassNoise = rng.standardNormal(n);
  const glassHp = new Float64Array(n);
  {
    const box = new Float64Array(8).fill(1 / 8);
    const smoothed = convolveSame(glassNoise, box);
    for (let i = 0; i < n; i++) glassHp[i] = glassNoise[i] - smoothed[i];
  }
  const glassEnv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    glassEnv[i] = Math.max(0, Math.exp(-(t[i] - 0.08) / 0.6) - Math.exp(-(t[i] - 0.08) / 0.02));
  }
  const tinkles = new Float64Array(n);
  for (let k = 0; k < 35; k++) {
    const pos = Math.floor(rng.uniform(0.05, 0.9) * SAMPLE_RATE);
    if (pos >= n) continue;
    const tLen = Math.min(Math.floor(0.04 * SAMPLE_RATE), n - pos);
    const tf = rng.uniform(3200, 6800);
    for (let i = 0; i < tLen; i++) {
      const u = (i / tLen) * 0.04;
      tinkles[pos + i] += Math.sin(TWO_PI * tf * u) * Math.exp(-u / 0.01) * 0.4;
    }
  }

  const glass = new Float64Array(n);
  for (let i = 0; i < n; i++) glass[i] = (glassHp[i] * 0.4 + tinkles[i]) * glassEnv[i];

  // Combine left and right with slight stereo decorrelation.
  const left = new Float64Array(n);
  const right = new Float64Array(n);
  const rolledImpulse = roll(impulse, 12);
  const rolledMetal = roll(metal, -15);
  const rolledCrunch = roll(crunch, 18);
  for (let i = 0; i < n; i++) {
    left[i] = impulse[i] * 1.2 + thud[i] * 1.5 + metal[i] * 0.9 + crunch[i] * 1.1 + glass[i] * 0.8;
    right[i] =
      rolledImpulse[i] * 1.1 + thud[i] * 1.5 + rolledMetal[i] * 0.95 + rolledCrunch[i] * 1.0 + glass[i] * 0.85;
  }
  return [left, right];
}

/** Seamless loop of high-performance rubber tyre squeal on a road surface. */
export function makeTireSkidLoop(duration = 2.0, seed = 5): Float64Array[] {
  const rng = new Rng(seed);
  const n = Math.floor(SAMPLE_RATE * duration);
  const t = linspace(0, duration, n, false);

  // Stick-slip friction fundamentals with vibrato.
  const f1 = new Float64Array(n);
  const f2 = new Float64Array(n);
  const f3 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const vibrato = 0.04 * Math.sin(TWO_PI * 8.5 * t[i]) + 0.02 * Math.sin(TWO_PI * 14.2 * t[i]);
    f1[i] = 740 * (1 + vibrato);
    f2[i] = 1180 * (1 + vibrato * 1.2);
    f3[i] = 1860 * (1 + vibrato * 0.8);
  }
  const p1 = cumsum(f1);
  const p2 = cumsum(f2);
  const p3 = cumsum(f3);
  const squeal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    squeal[i] =
      Math.sin((TWO_PI * p1[i]) / SAMPLE_RATE) * 0.6 +
      Math.sin((TWO_PI * p2[i]) / SAMPLE_RATE) * 0.45 +
      Math.sin((TWO_PI * p3[i]) / SAMPLE_RATE) * 0.25;
  }

  // Road-surface scrubbing texture.
  const grain = rng.standardNormal(n);
  let kernel = hanning(24);
  let kernelSum = 0;
  for (const v of kernel) kernelSum += v;
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;
  let grainBp = convolveSame(grain, kernel);
  for (let i = 0; i < n; i++) grainBp[i] = grain[i] - grainBp[i];
  const smooth = hanning(12);
  for (let i = 0; i < smooth.length; i++) smooth[i] /= 6;
  grainBp = convolveSame(grainBp, smooth);

  const skid = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    skid[i] = squeal[i] * (0.7 + 0.3 * Math.abs(grainBp[i])) + grainBp[i] * 0.35;
  }

  // Equal power crossfade across the loop seam.
  const fadeLen = Math.floor(0.25 * SAMPLE_RATE);
  const body = skid.slice(0, skid.length - fadeLen);
  const tail = skid.slice(skid.length - fadeLen);
  for (let i = 0; i < fadeLen; i++) {
    const t2 = i / fadeLen;
    body[i] = body[i] * Math.sin(t2 * Math.PI * 0.5) + tail[i] * Math.cos(t2 * Math.PI * 0.5);
  }

  const right = new Float64Array(body.length);
  const rolled = roll(body, 28);
  const rolledBack = roll(body, -14);
  for (let i = 0; i < body.length; i++) right[i] = rolled[i] * 0.95 + rolledBack[i] * 0.1;
  return [body, right];
}

/** Sub-bass ignition explosion transitioning into high-pressure jet roar. */
export function makeBoost(duration = 2.5, seed = 6): Float64Array[] {
  const rng = new Rng(seed);
  const n = Math.floor(SAMPLE_RATE * duration);
  const t = linspace(0, duration, n, false);

  // 1. Initial ignition detonation (120 Hz -> 35 Hz drop)
  const fDrop = new Float64Array(n);
  for (let i = 0; i < n; i++) fDrop[i] = 120 * Math.exp(-t[i] / 0.12) + 35;
  const pDrop = cumsum(fDrop);
  const ignition = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    ignition[i] = Math.tanh(
      Math.sin((TWO_PI * pDrop[i]) / SAMPLE_RATE) * Math.exp(-t[i] / 0.4) * 2.0 * 1.8,
    );
  }

  // 2. Pressurised nozzle jet hiss and turbine roar
  const noise = rng.standardNormal(n);
  const roarEnv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rise = Math.min(1, t[i] / 0.15);
    roarEnv[i] = rise * Math.exp(-t[i] / 1.8);
  }
  const whirF = new Float64Array(n);
  for (let i = 0; i < n; i++) whirF[i] = 2400 + 800 * Math.sin(TWO_PI * 6 * t[i]);
  const pWhir = cumsum(whirF);
  const jet = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const turbine = Math.sin((TWO_PI * pWhir[i]) / SAMPLE_RATE) * 0.15;
    jet[i] = (noise[i] * 0.6 + turbine) * roarEnv[i];
  }

  const left = new Float64Array(n);
  const right = new Float64Array(n);
  const rolledJet = roll(jet, 35);
  for (let i = 0; i < n; i++) {
    left[i] = ignition[i] * 1.4 + jet[i] * 1.1;
    right[i] = ignition[i] * 1.4 + rolledJet[i] * 1.1;
  }
  return [left, right];
}

/** High-fidelity crossplane V8 engine idle and rumble loop. */
export function makeV8EngineLoop(duration = 2.0, seed = 7): Float64Array[] {
  const rng = new Rng(seed);
  const n = Math.floor(SAMPLE_RATE * duration);
  const t = linspace(0, duration, n, false);

  // 850 RPM = ~14.16 rev/sec. In a 4-stroke crossplane V8 there are 4 power
  // strokes per revolution, with uneven spacing between the cylinders.
  const rpmHz = 14.16;
  const offsets = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  const cylinderWeights = [1.0, 0.88, 1.05, 0.92, 0.97, 1.02, 0.89, 0.95];

  const engine = new Float64Array(n);
  for (let c = 0; c < offsets.length; c++) {
    const shifted = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      shifted[i] = (t[i] + offsets[c] / rpmHz) % (1 / rpmHz);
    }
    for (let i = 0; i < n; i++) {
      const s = shifted[i];
      const pulse = Math.sin(TWO_PI * 2 * rpmHz * s) * Math.exp(-s * rpmHz * 3.5);
      const harmonics =
        Math.sin(TWO_PI * 4 * rpmHz * s) * 0.6 +
        Math.sin(TWO_PI * 6 * rpmHz * s) * 0.4 +
        Math.sin(TWO_PI * 8 * rpmHz * s) * 0.25;
      engine[i] += (pulse + harmonics) * cylinderWeights[c];
    }
  }

  // Warm analog saturation.
  for (let i = 0; i < n; i++) engine[i] = Math.tanh(engine[i] * 1.4);

  // Subtle mechanical valvetrain chatter.
  const chatter = rng.uniformArray(n, -0.08, 0.08);
  for (let i = 0; i < n; i++) {
    const gate = Math.sin(TWO_PI * rpmHz * 2 * t[i]) ** 2;
    engine[i] += chatter[i] * gate;
  }

  // Seamless loop equal power crossfade.
  const fadeLen = Math.floor(0.2 * SAMPLE_RATE);
  const body = engine.slice(0, engine.length - fadeLen);
  const tail = engine.slice(engine.length - fadeLen);
  for (let i = 0; i < fadeLen; i++) {
    const u = i / fadeLen;
    body[i] = body[i] * Math.sin(u * Math.PI * 0.5) + tail[i] * Math.cos(u * Math.PI * 0.5);
  }

  const right = new Float64Array(body.length);
  const rolled = roll(body, 16);
  const rolledBack = roll(body, -8);
  for (let i = 0; i < body.length; i++) right[i] = rolled[i] * 0.92 + rolledBack[i] * 0.08;
  return [body, right];
}

/** Synthesise the whole Foley set and the V8 loop under `outDir`. */
export function generateAll(outDir: string): string[] {
  mkdirSync(join(outDir, "sfx"), { recursive: true });
  mkdirSync(join(outDir, "engine"), { recursive: true });

  saveWav(join(outDir, "sfx", "crash_heavy.wav"), makeHeavyCrash(1.8), -16);
  saveWav(join(outDir, "sfx", "tire_skid.wav"), makeTireSkidLoop(2.0), -18);
  saveWav(join(outDir, "sfx", "boost.wav"), makeBoost(2.2), -15);
  saveWav(join(outDir, "engine", "engine_v8_loop.wav"), makeV8EngineLoop(2.0), -18);

  return [
    join(outDir, "sfx", "crash_heavy.wav"),
    join(outDir, "sfx", "tire_skid.wav"),
    join(outDir, "sfx", "boost.wav"),
    join(outDir, "engine", "engine_v8_loop.wav"),
  ];
}

/** Exported for the tests: the peak of a signal. */
export { maxAbs };
