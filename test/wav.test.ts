import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { findFfmpeg, readAudio, writeAudio } from "../src/dsp/wav.js";

const dir = mkdtempSync(join(tmpdir(), "hf-assets-wav-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tone = {
  sampleRate: 44100,
  channels: [Float64Array.from({ length: 44100 }, (_, i) => 0.3 * Math.sin(i / 20))],
};

describe("wav", () => {
  it("round-trips a WAV natively", () => {
    const path = join(dir, "tone.wav");
    writeAudio(path, tone);
    const back = readAudio(path);
    expect(back.sampleRate).toBe(44100);
    expect(back.channels[0].length).toBe(44100);
  });

  it.skipIf(!findFfmpeg())("writes and reads an OGG through ffmpeg", () => {
    const path = join(dir, "tone.ogg");
    writeAudio(path, tone);
    expect(statSync(path).size).toBeGreaterThan(0);
    expect(readAudio(path).channels[0].length).toBeGreaterThan(40000);
  });
});
