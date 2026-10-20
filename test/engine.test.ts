import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { build, combustionPulse, loopSeamCheck, samplesPerCycle, writeLoop } from "../src/dsp/engine.js";
import golden from "./fixtures/golden.json" with { type: "json" };

const engine = golden.engine as unknown as {
  pulse: number[];
  mag: number[];
  filteredIndices: number[];
  filtered: number[];
  loopLength: number;
  loopIndices: number[];
  loop: number[];
};
const meta = golden.meta as unknown as {
  per: number;
  loop_length: number;
  seam: number;
  intra: number;
  rms: number;
  peak: number;
};

describe("engine", () => {
  it("writes a long loop without running out of stack", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-assets-engine-"));
    try {
      const loop = writeLoop(dir, 750, 1000, "long", 7, 12);
      expect(loop.seconds).toBeGreaterThan(10);
      expect(loop.cylinders).toBe(12);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tiles a V12 loop at 3000 RPM", () => {
    expect(samplesPerCycle(3000, 44100, 12)).toBe(147);
    const loop = build(3000, 50, 7, 12);
    expect(loop.length).toBe(147 * 50);
    const { seam, intra } = loopSeamCheck(loop);
    expect(seam).toBeLessThanOrEqual(intra);
  });

  it("rejects an RPM that does not divide into whole firing cycles", () => {
    expect(() => samplesPerCycle(3333)).toThrow(/not an integer/);
    expect(samplesPerCycle(3375)).toBe(196);
    expect(samplesPerCycle(2700)).toBe(245);
    expect(samplesPerCycle(3150)).toBe(210);
  });

  it("produces the same combustion pulse as the reference implementation", () => {
    const pulse = combustionPulse(meta.per);
    expect(pulse.length).toBe(meta.per);
    for (let i = 0; i < pulse.length; i++) {
      expect(Math.abs(pulse[i] - engine.pulse[i])).toBeLessThan(1e-12);
    }
  });

  it("keeps the loop seam softer than the sharpest step inside the loop", () => {
    const loop = build(3375, 100, 11);
    expect(loop.length).toBe(meta.loop_length);

    const { seam, intra } = loopSeamCheck(loop);
    // The guarantee the pipeline makes: the boundary must not click.
    expect(seam).toBeLessThan(intra);

    // And the level must land where the reference implementation landed.
    let acc = 0;
    let peak = 0;
    for (const v of loop) {
      acc += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    expect(Math.sqrt(acc / loop.length)).toBeCloseTo(meta.rms, 3);
    // The peak moves a little with the noise realisation, so it is compared loosely.
    expect(peak).toBeCloseTo(meta.peak, 1);
  });

  it("produces the same shape as the reference loop at every sampled point", () => {
    const loop = build(3375, 100, 11);
    // The noise bed differs realisation by realisation, so the shape is compared
    // with a tolerance rather than exactly.
    let worst = 0;
    for (let i = 0; i < engine.loopIndices.length; i++) {
      worst = Math.max(worst, Math.abs(loop[engine.loopIndices[i]] - engine.loop[i]));
    }
    expect(worst).toBeLessThan(0.05);
  });
});
