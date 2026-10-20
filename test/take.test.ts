import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { saveTake } from "../src/gradio.js";

let server: Server;
let origin: string;
const dir = mkdtempSync(join(tmpdir(), "hf-assets-take-"));

beforeAll(async () => {
  server = createServer((_, response) => response.end(Buffer.from("RIFFdata")));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("saveTake", () => {
  it("writes the file and a sidecar with the provenance", async () => {
    const result = [{ path: "/tmp/x/take.WAV", url: `${origin}/file=take.WAV?__sign=abc.def`, orig_name: "take.WAV" }];
    const saved = await saveTake({
      result,
      extensions: [".wav", ".mp3"],
      what: "audio",
      base: join(dir, "clip_7"),
      started: Date.now(),
      meta: { model: "stable", prompt: "a hum", params: { seed: 7 } },
    });

    expect(saved.path).toBe(join(dir, "clip_7.wav"));
    expect(readFileSync(saved.path, "utf8")).toBe("RIFFdata");

    const sidecar = JSON.parse(readFileSync(saved.sidecar, "utf8"));
    expect(sidecar).toMatchObject({ model: "stable", prompt: "a hum", params: { seed: 7 } });
    expect(typeof sidecar.seconds).toBe("number");
    expect(JSON.stringify(sidecar.space_result)).toContain("take.WAV");
    expect(JSON.stringify(sidecar)).not.toContain("__sign");
  });

  it("refuses a result with no file of the wanted kind and writes nothing", async () => {
    const result = [{ path: "/tmp/x/log.json", url: `${origin}/file=log.json`, orig_name: "log.json" }];
    await expect(
      saveTake({
        result,
        extensions: [".png"],
        what: "image",
        base: join(dir, "nothing_1"),
        started: Date.now(),
        meta: {},
      }),
    ).rejects.toThrow(/no image in the result/);
    expect(existsSync(join(dir, "nothing_1.json"))).toBe(false);
  });
});
