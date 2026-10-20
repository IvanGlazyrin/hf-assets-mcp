import { describe, expect, it } from "vitest";

import { validate, type Manifest } from "../src/audio-batch.js";
import { equalPowerLoopCrossfade, normaliseRms } from "../src/dsp/postprocess.js";
import { rms } from "../src/dsp/arrays.js";

const SR = 44100;

function tone(): Float64Array {
  const audio = new Float64Array(SR);
  for (let i = 0; i < SR; i++) audio[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR);
  return audio;
}

describe("manifest validation", () => {
  it("rejects a prototype-only model", () => {
    const manifest: Manifest = {
      shippable_licences: ["Apache-2.0"],
      assets: [{ name: "bad_asset", model: "mmaudio", licence: "CC-BY-NC-4.0", prompt: "test" }],
    };
    expect(() => validate(manifest)).toThrow(/rejected/);
    expect(() => validate(manifest)).toThrow(/prototype-only/);
  });

  it("rejects a licence that does not match the model", () => {
    const manifest: Manifest = {
      shippable_licences: ["MIT"],
      assets: [{ name: "bad_licence_asset", model: "music", licence: "MIT", prompt: "test" }],
    };
    expect(() => validate(manifest)).toThrow(/rejected/);
  });

  it("accepts a manifest that may ship", () => {
    const manifest: Manifest = {
      shippable_licences: ["Apache-2.0", "MIT", "StabilityAI-Community"],
      assets: [
        { name: "engine_loop", model: "stable", licence: "StabilityAI-Community", prompt: "x" },
        { name: "theme", model: "music", licence: "Apache-2.0", prompt: "x" },
        { name: "line", model: "speech", licence: "MIT", prompt: "x" },
      ],
    };
    expect(() => validate(manifest)).not.toThrow();
  });
});

describe("audio post-processing", () => {
  it("crossfades the ends so the seam is continuous", () => {
    const audio = tone();
    // Apply a seam discontinuity.
    for (let i = SR - 100; i < SR; i++) audio[i] = 0;

    const crossfaded = equalPowerLoopCrossfade({ channels: [audio], sampleRate: SR }, 1000);
    expect(crossfaded.channels[0].length).toBe(SR - 1000);
    const seamStep = Math.abs(crossfaded.channels[0][0] - crossfaded.channels[0][SR - 1000 - 1]);
    expect(seamStep).toBeLessThan(0.05);
  });

  it("normalises the loudness to the target", () => {
    const audio = new Float64Array(SR);
    let seed = 12345;
    for (let i = 0; i < SR; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      audio[i] = (seed / 0x7fffffff - 0.5) * 0.2;
    }
    const targetDbfs = -19;
    const normalised = normaliseRms({ channels: [audio], sampleRate: SR }, targetDbfs);
    const measured = 20 * Math.log10(Math.max(rms(normalised.channels[0]), 1e-9));
    expect(measured).toBeCloseTo(targetDbfs, 1);
  });
});
