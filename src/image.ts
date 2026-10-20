/** Text-to-image generation through free Hugging Face Spaces. */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { handle_file } from "@gradio/client";

import { spaceOf } from "./catalogue.js";
import { describeParams, saveTake, space } from "./gradio.js";
import type { AssetFile } from "./types.js";

/** Z-Image takes one of these exact strings; the size picks by aspect or by size. */
export const ZIMAGE_SIZES = [
  "1024x1024 ( 1:1 )",
  "1152x896 ( 9:7 )",
  "896x1152 ( 7:9 )",
  "1152x864 ( 4:3 )",
  "864x1152 ( 3:4 )",
  "1248x832 ( 3:2 )",
  "832x1248 ( 2:3 )",
  "1280x720 ( 16:9 )",
  "720x1280 ( 9:16 )",
  "1344x576 ( 21:9 )",
  "576x1344 ( 9:21 )",
  "1280x1280 ( 1:1 )",
  "1536x1024 ( 3:2 )",
  "1536x864 ( 16:9 )",
  "1536x1536 ( 1:1 )",
  "2048x1152 ( 16:9 )",
];

export const ASPECTS: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
  "4:3": [1152, 864],
  "3:4": [864, 1152],
  "3:2": [1248, 832],
  "2:3": [832, 1248],
  "21:9": [1344, 576],
};

const QWEN_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

/** The pixel size a size argument asks for: an aspect ('16:9') or an exact size ('1280x720'). */
export function sizeWh(size: string): [number, number] {
  if (ASPECTS[size]) return ASPECTS[size];
  const [w, h] = size.toLowerCase().split("x");
  return [parseInt(w, 10), parseInt(h, 10)];
}

export interface ImageOptions {
  model: "zimage" | "klein" | "qwen";
  prompt: string;
  outDir: string;
  size?: string;
  seed?: number;
  count?: number;
  name?: string;
  referenceImages?: string[];
  enhancePrompt?: boolean;
}

/**
 * Generate images and write each one next to its provenance sidecar.
 *
 * The sidecar holds the prompt, the parameters, the seed and the raw Space
 * response, so any take can be reproduced.
 */
export async function generateImage(options: ImageOptions): Promise<AssetFile[]> {
  const { model, prompt, outDir } = options;
  const size = options.size ?? "1:1";
  const seed = options.seed ?? 1234;
  const count = options.count ?? 1;
  const name = options.name ?? model;
  const referenceImages = options.referenceImages ?? [];

  mkdirSync(outDir, { recursive: true });
  const written: AssetFile[] = [];

  for (let s = seed; s < seed + count; s++) {
    const started = Date.now();
    const { spaceId, endpoint, params } = await buildRequest(model, prompt, size, s, referenceImages, options.enhancePrompt ?? false);
    const app = await space(spaceId);
    const result = await app.predict(endpoint, params);

    const shown = describeParams(params) as Record<string, unknown>;
    const take = await saveTake({
      result,
      extensions: [".png", ".webp", ".jpg", ".jpeg"],
      what: "image",
      base: join(outDir, `${name}_${s}`),
      started,
      meta: { model, prompt, params: shown },
    });
    written.push({ path: take.path, sidecar: take.sidecar, model, seed: s, params: shown, seconds: take.seconds });
  }
  return written;
}

/** The Space, the endpoint and the parameters for one model. */
async function buildRequest(
  model: "zimage" | "klein" | "qwen",
  prompt: string,
  size: string,
  seed: number,
  referenceImages: string[],
  enhancePrompt: boolean,
): Promise<{ spaceId: string; endpoint: string; params: Record<string, unknown> }> {
  if (model === "zimage") {
    const [w, h] = sizeWh(size);
    const match = ZIMAGE_SIZES.find((s) => s.startsWith(`${w}x${h} `));
    if (!match) {
      throw new Error(
        `zimage has no ${w}x${h}; use one of: ${ZIMAGE_SIZES.map((s) => s.split(" ")[0]).join(", ")}`,
      );
    }
    return {
      spaceId: spaceOf("zimage"),
      endpoint: "/generate",
      params: {
        prompt,
        gallery_images: [],
        resolution: match,
        seed,
        steps: 8,
        shift: 3.0,
        random_seed: false,
      },
    };
  }

  if (model === "klein") {
    const [w0, h0] = sizeWh(size);
    const k = Math.min(1, 1024 / Math.max(w0, h0)); // the Space caps each side at 1024
    const w = Math.floor((w0 * k) / 16) * 16;
    const h = Math.floor((h0 * k) / 16) * 16;
    return {
      spaceId: spaceOf("klein"),
      endpoint: "/infer",
      params: {
        prompt,
        input_images: referenceImages.map((p) => ({ image: handle_file(p), caption: null })),
        mode_choice: "Distilled (4 steps)",
        seed,
        randomize_seed: false,
        width: w,
        height: h,
        num_inference_steps: 4,
        guidance_scale: 1.0,
        prompt_upsampling: false,
      },
    };
  }

  if (!QWEN_ASPECTS.includes(size)) {
    throw new Error(`qwen takes an aspect only: ${QWEN_ASPECTS.join(" ")}`);
  }
  return {
    spaceId: spaceOf("qwen"),
    endpoint: "/infer",
    params: {
      prompt,
      seed,
      randomize_seed: false,
      aspect_ratio: size,
      guidance_scale: 1.0,
      num_inference_steps: 8,
      prompt_enhance: enhancePrompt,
    },
  };
}
