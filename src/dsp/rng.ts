/**
 * A seeded random generator.
 *
 * The reference implementation uses numpy's PCG64 and its ziggurat normal; this
 * uses splitmix64 for the stream and Box-Muller for the normal distribution. The
 * noise is different in detail but statistically the same, which is what the
 * synthesised textures need — the properties the pipeline guarantees (loop
 * seam, loudness, spectrum) do not depend on the exact realisation.
 */

export class Rng {
  private state: bigint;

  constructor(seed: number) {
    this.state = BigInt.asUintN(64, BigInt(Math.trunc(seed)));
  }

  /** The next 64 random bits. */
  private nextU64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    z = z ^ (z >> 31n);
    return z & 0xffffffffffffffffn;
  }

  /** A uniform double in [0, 1). */
  random(): number {
    return Number(this.nextU64() >> 11n) / 2 ** 53;
  }

  /** `np.random.uniform(low, high)`. */
  uniform(low: number, high: number): number {
    return low + (high - low) * this.random();
  }

  /** A standard normal sample, Box-Muller. */
  normal(): number {
    let u = 0;
    while (u === 0) u = this.random();
    const v = this.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** `n` standard normal samples. */
  standardNormal(n: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.normal();
    return out;
  }

  /** `n` uniform samples in [low, high). */
  uniformArray(n: number, low: number, high: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.uniform(low, high);
    return out;
  }
}
