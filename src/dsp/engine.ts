/**
 * Synthesise a seamless engine loop that survives pitch-shifting.
 *
 * Why synthesis and not a generated or recorded sample
 * ----------------------------------------------------
 * The loop must contain an INTEGER number of firing cycles. The player resamples it
 * by `pitch_scale` to fake revs, and resampling a loop whose length is not a whole
 * number of cycles leaves a phase step at the seam that becomes a click on every
 * revolution. A recorded or AI-generated loop has an arbitrary length, so it
 * cannot be pitch-shifted like this without artefacts. A synthesised loop is
 * periodic by construction, so the seam is exact at any pitch.
 *
 * Everything in the loop is therefore built to be periodic: the combustion pulse
 * is tiled an integer number of times, and every filter is a circular convolution
 * in the FFT domain, which preserves periodicity exactly where an IIR with zeroed
 * state would not.
 *
 * Timing
 * ------
 * A 4-stroke engine fires each cylinder once per two crank revolutions, so the firing
 * rate is RPM/60 * cylinders/2 (RPM/15 for a V8, RPM/10 for a V12). Samples per firing cycle is
 * sample_rate / firing_rate. 3375 RPM gives 225 Hz and therefore exactly 196
 * samples per cycle at 44100 Hz -- an integer, which is what makes the prototype
 * tileable. The rate is validated, not assumed.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { arange, cumsum, exp, linspace, mean, removeDc, rms, saturate, scale, sin, tile } from "./arrays.js";
import { circularFilter, rfftfreq } from "./fft.js";
import { Rng } from "./rng.js";
import { writeAudio, type Audio } from "./wav.js";

export const SAMPLE_RATE = 44100;
export const CYLINDERS = 8;

/** Firing frequency in Hz for a 4-stroke engine. */
export function firingRate(rpm: number, cylinders = CYLINDERS): number {
  return (rpm / 60) * (cylinders / 2);
}

/** Samples in one firing cycle. Must be an integer or the loop will not tile. */
export function samplesPerCycle(rpm: number, sampleRate = SAMPLE_RATE, cylinders = CYLINDERS): number {
  const exact = sampleRate / firingRate(rpm, cylinders);
  const n = Math.round(exact);
  if (Math.abs(exact - n) > 1e-6) {
    throw new Error(
      `${rpm} RPM on ${cylinders} cylinders at ${sampleRate} Hz gives ${exact.toFixed(4)} samples per firing ` +
        "cycle, which is not an integer. Pick an RPM that divides evenly: for 8 cylinders " +
        "3375 (196 samples), 2700 (245) or 3150 (210); for 12 cylinders 3000 (147) or 2250 (196).",
    );
  }
  return n;
}

/**
 * One firing cycle: fast pressure rise, expansion decay, valve-seat transient.
 *
 * The asymmetry is the point. A symmetric excitation sounds like a buzzer; an
 * engine is a sharp knock followed by a long decay, and that ratio is most of
 * what the ear reads as "combustion".
 */
export function combustionPulse(n: number): Float64Array {
  const t = linspace(0, 1, n, false);
  const attack = exp(scale(t, -90)); // pressure spike, dies in ~1% of the cycle
  const decay = exp(scale(t, -9)); // expansion through the exhaust port
  const body = mulExpSin(t); // the "chuff" ring

  const pulse = new Float64Array(n);
  for (let i = 0; i < n; i++) pulse[i] = 0.72 * attack[i] + 0.45 * decay[i] + 0.18 * body[i];

  // Valve seat / injector tick a few samples in, before the expansion tail.
  const seatAt = Math.max(1, Math.floor(n * 0.012));
  for (let i = seatAt; i < n; i++) pulse[i] += 0.3 * Math.exp(-(i - seatAt) / 3);

  // Start on the attack, not in the middle of the tail, so tiling is continuous.
  const rolled = new Float64Array(n);
  for (let i = 0; i < n; i++) rolled[i] = pulse[(i + seatAt) % n];
  return removeDc(rolled);
}

/** `exp(-22t) * sin(4*pi*t)`. */
function mulExpSin(t: Float64Array): Float64Array {
  const out = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) {
    out[i] = Math.exp(-22 * t[i]) * Math.sin(2 * Math.PI * 2 * t[i]);
  }
  return out;
}

/**
 * Pipe/cavity resonance as a zero-phase magnitude response.
 *
 * An engine's timbre is mostly the resonances of the exhaust pipe and the
 * cylinder head. Sampled directly at the signal's bins so the response stays
 * analytic and the circular filter can apply it.
 */
export function exhaustMag(rpm: number, n: number, q = 5, cylinders = CYLINDERS): Float64Array {
  const f = rfftfreq(n, SAMPLE_RATE);
  const fFire = firingRate(rpm, cylinders);

  // Fundamental resonator plus weaker chambers an octave-and-a-fifth and so on up.
  const mag = new Float64Array(f.length);
  for (const [centre, weight] of [
    [fFire, 1],
    [fFire * 3.02, 0.45],
    [fFire * 5.4, 0.2],
  ] as const) {
    for (let i = 0; i < f.length; i++) {
      const d = (f[i] - centre) / (centre / q);
      mag[i] += weight / (1 + d * d);
    }
  }

  let peak = 0;
  for (const v of mag) if (v > peak) peak = v;
  const norm = peak + 1e-12;
  for (let i = 0; i < mag.length; i++) mag[i] /= norm;
  return mag;
}

/** Induction roar: band-limited noise, amplitude-following the firing pulse. */
export function intakeBed(rpm: number, cycles: number, seed = 11, cylinders = CYLINDERS): Float64Array {
  const per = samplesPerCycle(rpm, SAMPLE_RATE, cylinders);
  const n = per * cycles;

  const f = rfftfreq(n, SAMPLE_RATE);
  const fFire = firingRate(rpm, cylinders);

  // Broad resonance above the firing rate, rolling off into the top end.
  const mag = new Float64Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const d = (f[i] - fFire * 1.8) / (fFire * 2.6);
    mag[i] = (f[i] / (f[i] + 260)) * Math.exp(-d * d);
  }
  let peak = 0;
  for (const v of mag) if (v > peak) peak = v;
  const norm = peak + 1e-12;
  for (let i = 0; i < mag.length; i++) mag[i] /= norm;

  const bed = scale(circularFilter(new Rng(seed).standardNormal(n), mag), 0.3);

  // Modulate by the firing envelope so the bed breathes with the combustion.
  const env = tile(exp(scale(arange(per), -1 / 14)), cycles);
  let envPeak = 0;
  for (const v of env) if (v > envPeak) envPeak = v;
  const envNorm = envPeak + 1e-12;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = bed[i] * (0.55 + 0.45 * (env[i] / envNorm));
  return out;
}

/** Sub-octave rumble. A stack of harmonics of firing/2 so it stays periodic. */
export function lowBody(rpm: number, cycles: number, cylinders = CYLINDERS): Float64Array {
  const n = samplesPerCycle(rpm, SAMPLE_RATE, cylinders) * cycles;
  const t = arange(n);
  const fFire = firingRate(rpm, cylinders);
  const out = new Float64Array(n);
  for (const [k, amp] of [
    [0.5, 0.3],
    [1, 0.18],
    [1.5, 0.09],
  ] as const) {
    for (let i = 0; i < n; i++) {
      out[i] += amp * Math.sin((2 * Math.PI * fFire * k * i) / SAMPLE_RATE);
    }
  }
  return out;
}

/** Scale to a target RMS level in dBFS. */
export function normaliseRms(x: Float64Array, targetDbfs = -18): Float64Array {
  const level = rms(x) + 1e-12;
  const gain = Math.pow(10, targetDbfs / 20) / level;
  return scale(x, gain);
}

/**
 * Compare the loop-boundary step against the sharpest step inside the loop.
 *
 * A combustion pulse is a discontinuity by design -- the attack is the knock.
 * So the waveform is *supposed* to jump between firing cycles, and a raw
 * "is the seam continuous" test flags the very feature that makes it sound like
 * an engine. The question that actually matters is whether the loop boundary is
 * any worse than the jumps that already occur `cycles` times inside the loop.
 */
export function loopSeamCheck(x: Float64Array): { seam: number; intra: number } {
  let seam = 0;
  for (let i = 1; i < x.length; i++) seam = Math.max(seam, Math.abs(x[i] - x[i - 1]));
  const boundary = Math.abs(x[0] - x[x.length - 1]);
  return { seam: boundary, intra: seam };
}

/** Build the loop. */
export function build(rpm: number, cycles: number, seed = 7, cylinders = CYLINDERS): Float64Array {
  const per = samplesPerCycle(rpm, SAMPLE_RATE, cylinders);

  // Tile the prototype: an integer number of cycles makes this seamless.
  const core = tile(combustionPulse(per), cycles);
  const filtered = circularFilter(core, exhaustMag(rpm, core.length, 5, cylinders));

  const bed = intakeBed(rpm, cycles, seed, cylinders);
  const body = lowBody(rpm, cycles, cylinders);
  const mix = new Float64Array(filtered.length);
  for (let i = 0; i < mix.length; i++) mix[i] = filtered[i] + bed[i] + body[i];

  // Very light timing unevenness between banks: the characteristic V8 lope. A V12 fires
  // evenly and runs much smoother. Implemented as a sub-cycle modulation, so it is still
  // exactly periodic.
  const fFire = firingRate(rpm, cylinders);
  const lope = cylinders >= 12 ? 0.015 : 0.055;
  for (let i = 0; i < mix.length; i++) {
    const t = i / SAMPLE_RATE;
    mix[i] *= 1 + lope * Math.sin(2 * Math.PI * fFire * 0.5 * t);
  }

  return normaliseRms(saturate(removeDc(mix)));
}

export interface EngineLoop {
  path: string;
  seconds: number;
  seam: number;
  sharpestInLoopStep: number;
  rpm: number;
  cycles: number;
  cylinders: number;
}

/**
 * Build the engine loop, check its seam and write it.
 *
 * The loop boundary must not be sharper than the sharpest transition already
 * present inside the loop, or it would click where the interior does not.
 */
export function writeLoop(
  outDir: string,
  rpm = 3375,
  cycles = 100,
  name = "engine_loop",
  seed = 7,
  cylinders = CYLINDERS,
): EngineLoop {
  mkdirSync(outDir, { recursive: true });
  const sig = build(rpm, cycles, seed, cylinders);

  const { seam, intra } = loopSeamCheck(sig);
  if (seam > intra) {
    throw new Error(
      `loop seam step ${seam.toFixed(4)} exceeds the sharpest in-loop step ${intra.toFixed(4)}; ` +
        "the boundary would click where the interior does not",
    );
  }

  let peak = 0;
  for (const v of sig) peak = Math.max(peak, Math.abs(v));
  if (peak > 1) {
    throw new Error(`peak ${peak.toFixed(3)} exceeds full scale after normalisation`);
  }

  const path = join(outDir, `${name}.wav`);
  const audio: Audio = { channels: [sig], sampleRate: SAMPLE_RATE };
  writeAudio(path, audio);

  const duration = sig.length / SAMPLE_RATE;
  return {
    path,
    seconds: Math.round(duration * 1000) / 1000,
    seam: Math.round(seam * 1e5) / 1e5,
    sharpestInLoopStep: Math.round(intra * 1e5) / 1e5,
    rpm,
    cycles,
    cylinders,
  };
}
