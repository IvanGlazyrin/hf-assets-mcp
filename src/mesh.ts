/** Image-to-3D generation through free Hugging Face Spaces. */

import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import { handle_file } from "@gradio/client";

import { spaceOf } from "./catalogue.js";
import { describeParams, saveTake, space } from "./gradio.js";
import type { AssetFile } from "./types.js";

export interface MeshOptions {
  model: "hunyuan" | "trellis";
  image: string;
  outDir: string;
  extraViews?: string[];
  seed?: number;
}

/**
 * Turn an image into a raw 3D mesh.
 *
 * `trellis` gives a textured GLB at ~30k faces; `hunyuan` gives an untextured
 * shape at ~450k faces. Writes `<kind>_<seed>.glb` and a `.json` sidecar with the
 * parameters, the inputs and the raw Space response, so a second take does not
 * overwrite the first.
 *
 * Extra views are fused with the main image as multi-image conditioning, which
 * only TRELLIS supports.
 */
export async function generateMesh(options: MeshOptions): Promise<AssetFile[]> {
  const { model, image, outDir } = options;
  const extraViews = options.extraViews ?? [];
  const seed = options.seed ?? 1234;

  if (model === "hunyuan" && extraViews.length) {
    throw new Error("hunyuan takes a single image; extra views work with trellis only");
  }

  mkdirSync(outDir, { recursive: true });
  const started = Date.now();

  let endpoint: string;
  let params: Record<string, unknown>;
  let kind: string;

  if (model === "hunyuan") {
    endpoint = "/shape_generation";
    kind = "hunyuan";
    params = {
      caption: null,
      image: handle_file(image),
      mv_image_front: null,
      mv_image_back: null,
      mv_image_left: null,
      mv_image_right: null,
      steps: 30,
      guidance_scale: 5.0,
      seed,
      octree_resolution: 256,
      check_box_rembg: true,
      num_chunks: 8000,
      randomize_seed: false,
    };
  } else {
    endpoint = "/generate_and_extract_glb";
    kind = extraViews.length ? "trellis_mv" : "trellis";
    // The main image is one of the views that get fused.
    const views = extraViews.length ? [image, ...extraViews] : [];
    params = {
      image: handle_file(image),
      multiimages: views.map((p) => ({ image: handle_file(p) })),
      seed,
      ss_guidance_strength: 7.5,
      ss_sampling_steps: 12,
      slat_guidance_strength: 3.0,
      slat_sampling_steps: 12,
      multiimage_algo: "stochastic",
      mesh_simplify: 0.95,
      texture_size: 1024,
    };
  }

  const app = await space(spaceOf(model));
  if (model === "trellis") {
    // The Space opens a session before it takes work. A failure here is not
    // fatal: the endpoint also works without one.
    try {
      await app.predict("/start_session", {});
    } catch {
      /* the session is optional */
    }
  }
  const result = await app.predict(endpoint, params);

  const shown = describeParams(params) as Record<string, unknown>;
  const take = await saveTake({
    result,
    extensions: [".glb"],
    what: "GLB",
    base: join(outDir, `${kind}_${seed}`),
    started,
    meta: { kind, inputs: [image, ...extraViews].map((p) => basename(p)), params: shown },
  });

  return [{ path: take.path, sidecar: take.sidecar, model, kind, seed, params: shown, seconds: take.seconds }];
}
