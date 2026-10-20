/**
 * A complex FFT for any length.
 *
 * Radix-2 Cooley-Tukey needs a power of two, but the engine loop is 19600
 * samples long, which is not. Bluestein's algorithm turns a length-N transform
 * into a convolution of length M >= 2N-1, where M is a power of two, so any N
 * works with the same code.
 *
 * The port is checked against numpy's rfft/irfft in test/fft.test.ts.
 */

export interface Spectrum {
  re: Float64Array;
  im: Float64Array;
}

/** In-place forward DFT of a power-of-two sequence, unnormalised. */
function fftPow2(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    // Twiddles are computed per level rather than by recurrence: the recurrence
    // drifts over 65536 points, and there is only one table to build per level.
    const twRe = new Float64Array(half);
    const twIm = new Float64Array(half);
    for (let j = 0; j < half; j++) {
      const ang = (-2 * Math.PI * j) / len;
      twRe[j] = Math.cos(ang);
      twIm[j] = Math.sin(ang);
    }
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const k = i + j;
        const m = k + half;
        const vr = re[m] * twRe[j] - im[m] * twIm[j];
        const vi = re[m] * twIm[j] + im[m] * twRe[j];
        re[m] = re[k] - vr;
        im[m] = im[k] - vi;
        re[k] += vr;
        im[k] += vi;
      }
    }
  }
}

/** In-place inverse DFT of a power-of-two sequence, normalised by 1/n. */
function ifftPow2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftPow2(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

/**
 * In-place forward DFT of any length.
 *
 * Bluestein: -2*pi*j*k/N = -pi*j^2/N - pi*k^2/N + pi*(j-k)^2/N, so the transform
 * is a convolution of x[j]*exp(-i*pi*j^2/N) with the symmetric kernel
 * exp(+i*pi*m^2/N).
 */
function dft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) === 0) {
    fftPow2(re, im);
    return;
  }

  let m = 1;
  while (m < 2 * n - 1) m <<= 1;

  const aRe = new Float64Array(m);
  const aIm = new Float64Array(m);
  const bRe = new Float64Array(m);
  const bIm = new Float64Array(m);

  // exp(-i*pi*j^2/N) is periodic in j^2 with period 2N, which keeps the angle
  // small enough to stay exact in double precision.
  // The chirp multiplies the signal; the convolution kernel is its conjugate,
  // exp(+i*pi*m^2/N).
  const twoN = 2 * n;
  for (let j = 0; j < n; j++) {
    const ang = (Math.PI * ((j * j) % twoN)) / n;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    aRe[j] = re[j] * c + im[j] * s;
    aIm[j] = im[j] * c - re[j] * s;
    bRe[j] = c;
    bIm[j] = s;
    if (j > 0) {
      bRe[m - j] = c;
      bIm[m - j] = s;
    }
  }

  fftPow2(aRe, aIm);
  fftPow2(bRe, bIm);
  for (let i = 0; i < m; i++) {
    const vr = aRe[i] * bRe[i] - aIm[i] * bIm[i];
    const vi = aRe[i] * bIm[i] + aIm[i] * bRe[i];
    aRe[i] = vr;
    aIm[i] = vi;
  }
  ifftPow2(aRe, aIm); // the inverse transform already carries the 1/m

  for (let k = 0; k < n; k++) {
    const ang = (Math.PI * ((k * k) % twoN)) / n;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const convRe = aRe[k];
    const convIm = aIm[k];
    re[k] = convRe * c + convIm * s;
    im[k] = convIm * c - convRe * s;
  }
}

/** In-place inverse DFT of any length, normalised by 1/n. */
function idft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  dft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

/** Real FFT: the first floor(n/2)+1 bins of the DFT of a real signal. */
export function rfft(x: Float64Array): Spectrum {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i];
  dft(re, im);
  const half = Math.floor(n / 2);
  const outRe = new Float64Array(half + 1);
  const outIm = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    outRe[k] = re[k];
    outIm[k] = im[k];
  }
  return { re: outRe, im: outIm };
}

/** Inverse real FFT: rebuild a signal of n samples from its half spectrum. */
export function irfft(spec: Spectrum, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const half = Math.floor(n / 2);
  for (let k = 0; k <= half; k++) {
    re[k] = spec.re[k];
    im[k] = spec.im[k];
  }
  for (let k = 1; k < n - half; k++) {
    re[n - k] = spec.re[k];
    im[n - k] = -spec.im[k];
  }
  idft(re, im);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i];
  return out;
}

/** The FFT bin frequencies of a signal of n samples at the given rate. */
export function rfftfreq(n: number, sampleRate: number): Float64Array {
  const half = Math.floor(n / 2);
  const out = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) out[k] = (k * sampleRate) / n;
  return out;
}

/**
 * Zero-phase filtering via circular convolution.
 *
 * `mag` is a magnitude-only response sampled at this signal's own FFT bins, so
 * no phase is introduced. That matters: a minimum-phase filter would ring past
 * the end of the loop and break the seam, whereas zero-phase cannot.
 */
export function circularFilter(x: Float64Array, mag: Float64Array): Float64Array {
  const n = x.length;
  if (mag.length !== Math.floor(n / 2) + 1) {
    throw new Error(`magnitude response has ${mag.length} bins, expected ${Math.floor(n / 2) + 1} for n=${n}`);
  }
  const spec = rfft(x);
  for (let k = 0; k < spec.re.length; k++) {
    spec.re[k] *= mag[k];
    spec.im[k] *= mag[k];
  }
  return irfft(spec, n);
}
