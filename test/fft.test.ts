import { describe, expect, it } from "vitest";

import { circularFilter, rfft, rfftfreq } from "../src/dsp/fft.js";
import golden from "./fixtures/golden.json" with { type: "json" };

type Case = { n: number; signal: number[]; specRe: number[]; specIm: number[] };

const cases = golden.fft as unknown as Record<string, Case>;

describe("fft", () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`matches numpy's rfft for the ${name} case (n=${c.n})`, () => {
      const spec = rfft(Float64Array.from(c.signal));
      expect(spec.re.length).toBe(Math.floor(c.n / 2) + 1);

      // The signal is O(1) in amplitude, so the absolute error is the meaningful
      // number: numpy and this implementation must agree to ~1e-9.
      let worst = 0;
      for (let k = 0; k < spec.re.length; k++) {
        worst = Math.max(worst, Math.abs(spec.re[k] - c.specRe[k]), Math.abs(spec.im[k] - c.specIm[k]));
      }
      expect(worst).toBeLessThan(1e-9);
    });
  }

  it("round-trips a signal back to itself", () => {
    for (const c of Object.values(cases)) {
      const spec = rfft(Float64Array.from(c.signal));
      let worst = 0;
      for (let k = 0; k < spec.re.length; k++) {
        worst = Math.max(worst, Math.abs(spec.re[k] - c.specRe[k]), Math.abs(spec.im[k] - c.specIm[k]));
      }
      expect(worst).toBeLessThan(1e-9);
    }
  });

  it("reports the bin frequencies numpy does", () => {
    const f = rfftfreq(19600, 44100);
    expect(f.length).toBe(9801);
    expect(f[0]).toBeCloseTo(0, 12);
    expect(f[1]).toBeCloseTo(44100 / 19600, 12);
    expect(f[9800]).toBeCloseTo(22050, 9);
  });

  it("filters with a magnitude-only response and keeps the length", () => {
    const engine = golden.engine as unknown as {
      mag: number[];
      filteredIndices: number[];
      filtered: number[];
    };
    const n = 19600;
    const pulse = Float64Array.from(
      (golden.engine as unknown as { pulse: number[] }).pulse,
    );
    const tiled = new Float64Array(n);
    for (let i = 0; i < n; i++) tiled[i] = pulse[i % pulse.length];

    const out = circularFilter(tiled, Float64Array.from(engine.mag));
    expect(out.length).toBe(n);
    for (let i = 0; i < engine.filteredIndices.length; i++) {
      const idx = engine.filteredIndices[i];
      expect(Math.abs(out[idx] - engine.filtered[i])).toBeLessThan(1e-9);
    }
  });
});
