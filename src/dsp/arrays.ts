/**
 * The numpy-shaped array helpers the synthesisers need.
 *
 * Everything works on Float64Array; the maths is the same as the numpy
 * reference, so the numbers come out the same to within float rounding.
 */

/** `np.linspace(start, stop, num, endpoint=False)`. */
export function linspace(start: number, stop: number, num: number, endpoint = false): Float64Array {
  const out = new Float64Array(num);
  const div = endpoint ? num - 1 : num;
  if (div === 0) return out;
  const step = (stop - start) / div;
  for (let i = 0; i < num; i++) out[i] = start + step * i;
  return out;
}

/** `np.exp(x)`, elementwise. */
export function exp(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.exp(x[i]);
  return out;
}

/** `np.sin(x)`, elementwise. */
export function sin(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.sin(x[i]);
  return out;
}

/** `np.arange(n)`. */
export function arange(n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

/** `np.hanning(n)` — a symmetric Hann window. */
export function hanning(n: number): Float64Array {
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = 1;
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return out;
}

/** `np.roll(x, k)` — shift with wraparound. */
export function roll(x: Float64Array, k: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  const shift = ((k % n) + n) % n;
  for (let i = 0; i < n; i++) out[i] = x[(i - shift + n) % n];
  return out;
}

/** `np.cumsum(x)`. */
export function cumsum(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i];
    out[i] = acc;
  }
  return out;
}

/** `np.convolve(a, v, mode='same')` — the centred part of the linear convolution. */
export function convolveSame(a: Float64Array, v: Float64Array): Float64Array {
  const n = a.length;
  const m = v.length;
  const out = new Float64Array(n);
  const half = (m - 1) >> 1;
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < m; k++) {
      const j = i + k - half;
      if (j >= 0 && j < n) acc += a[j] * v[k];
    }
    out[i] = acc;
  }
  return out;
}

/** `np.tile(x, count)`. */
export function tile(x: Float64Array, count: number): Float64Array {
  const out = new Float64Array(x.length * count);
  for (let c = 0; c < count; c++) out.set(x, c * x.length);
  return out;
}

/** `np.max(np.abs(x))`. */
export function maxAbs(x: Float64Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > m) m = v;
  }
  return m;
}

/** `np.sqrt(np.mean(x**2))`. */
export function rms(x: Float64Array): number {
  if (x.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < x.length; i++) acc += x[i] * x[i];
  return Math.sqrt(acc / x.length);
}

/** `np.mean(x)`. */
export function mean(x: Float64Array): number {
  if (x.length === 0) return 0;
  let acc = 0;
  for (let i = 0; i < x.length; i++) acc += x[i];
  return acc / x.length;
}

/** `x - x.mean()`. */
export function removeDc(x: Float64Array): Float64Array {
  const m = mean(x);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - m;
  return out;
}

/** `np.tanh(x * drive) / np.tanh(drive)`. */
export function saturate(x: Float64Array, drive = 1.5): Float64Array {
  const norm = Math.tanh(drive);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i] * drive) / norm;
  return out;
}

/** Elementwise product. */
export function mul(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * b[i];
  return out;
}

/** Elementwise sum of two arrays of the same length. */
export function add(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

/** Scale every sample. */
export function scale(x: Float64Array, k: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * k;
  return out;
}

/** Add a constant to every sample. */
export function offset(x: Float64Array, k: number): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + k;
  return out;
}

/** `np.maximum(0, x)`. */
export function maxZero(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] > 0 ? x[i] : 0;
  return out;
}

/**
 * Interleave two channels into one buffer, the way a stereo WAV stores them.
 */
export function interleave(channels: Float64Array[]): Float64Array {
  const n = channels[0].length;
  const out = new Float64Array(n * channels.length);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels.length; c++) out[i * channels.length + c] = channels[c][i];
  }
  return out;
}
