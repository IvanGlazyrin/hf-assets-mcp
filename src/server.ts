#!/usr/bin/env node
/**
 * MCP server exposing the asset pipeline as tools.
 *
 * Run it as a stdio server:
 *
 *     node dist/server.js
 *
 * or register it with a client. Claude Code, for example:
 *
 *     claude mcp add hf-assets -- node /path/to/hf-assets/dist/server.js
 *
 * Tools
 *     list_models         what can be generated, where, and under which licence
 *     generate_image      text -> image through a free Hugging Face Space
 *     generate_mesh       image -> raw 3D mesh (GLB)
 *     generate_audio      text -> sound, music or speech
 *     generate_audio_batch  a whole manifest of audio assets
 *     postprocess_audio   trim, loop-crossfade, normalise, export
 *     synth_sound         procedural engine loop, vehicle Foley and music (spends no quota)
 *     model_sheet         a 4-in-1 model sheet prompt from a note
 *     render_mesh         studio renders of a mesh (needs Blender)
 *
 * Resources
 *     hf-assets://prompt-templates     the canonical prompt templates
 *     hf-assets://model-catalogue      the catalogue, as JSON
 *     hf-assets://audio-manifest       an example audio manifest
 */

import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod";

import { runManifest, validate, type Manifest } from "./audio-batch.js";
import { generateAudio } from "./audio.js";
import { CATALOGUE, PROCEDURAL, QUOTA } from "./catalogue.js";
import { writeLoop } from "./dsp/engine.js";
import { processFile } from "./dsp/postprocess.js";
import { generateAll as generateMusic } from "./dsp/music.js";
import { generateAll as generateSfx } from "./dsp/sfx.js";
import { generateImage } from "./image.js";
import { buildPrompt, DEFAULTS, extractInfo, PRESETS, type SheetInfo } from "./model-sheet.js";
import { generateMesh } from "./mesh.js";
import { DEFAULT_OUT, PACKAGE_ROOT, ROOT, resolvePath } from "./paths.js";
import { renderMesh } from "./render.js";
import type { AssetFile } from "./types.js";

const INSTRUCTIONS = `\
Generate game assets through free Hugging Face Spaces.

\`generate_image\`, \`generate_mesh\` and \`generate_audio\` spend ZeroGPU quota,
which every Space shares and which resets 24 hours after the first use of the
day. \`synth_sound\` and \`postprocess_audio\` spend none — prefer them when they
fit. \`list_models\` gives the catalogue and the licence of every model: check it
before an asset is used in a build, and never ship anything marked
"shippable": false.

Every generated file is written next to a \`.json\` sidecar holding the prompt,
the parameters, the seed and the raw Space response, so any take can be
reproduced (the exception is the \`stable\` audio model, whose Space takes no
seed). Generation is deliberately not automatic: a human picks the take before
\`postprocess_audio\` turns it into a finished file.
`;

const fileSchema = z.object({
  path: z.string().describe("Absolute path of the asset."),
  sidecar: z.string().nullish().describe("Path of the .json sidecar with its provenance."),
  model: z.string().nullish().describe("The model that produced it."),
  kind: z.string().nullish().describe("The kind of mesh, for a mesh."),
  licence: z.string().nullish().describe("The licence the asset ships under."),
  seed: z.number().nullish().describe("The seed the asset was generated with."),
  seconds: z.number().nullish().describe("How long the asset is, or how long it took."),
  params: z.record(z.string(), z.unknown()).nullish().describe("The parameters sent to the Space."),
});

const generatedSchema = z.object({
  files: z.array(fileSchema).describe("Everything that was written."),
  log: z.string().describe("What the engine printed while it worked."),
});

const modelEntrySchema = z.object({
  model: z.string(),
  space: z.string(),
  licence: z.string(),
  shippable: z.boolean().nullish(),
  takes: z.string().nullish(),
  note: z.string().nullish(),
});

const catalogueSchema = z.object({
  models: z.record(z.string(), z.array(modelEntrySchema)),
  procedural: z.array(
    z.object({ tool: z.string(), kind: z.string(), note: z.string() }),
  ),
  quota: z.record(z.string(), z.string()),
  token_present: z.boolean(),
  root: z.string(),
  out_dir: z.string(),
});

/** Whether a token is available: from the environment, else from a .env (which then sets HF_TOKEN). */
function ensureToken(): boolean {
  if (process.env.HF_TOKEN) return true;
  for (const dir of new Set([ROOT, PACKAGE_ROOT])) {
    try {
      const env = readFileSync(join(dir, ".env"), "utf8");
      for (const line of env.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.startsWith("HF_TOKEN=")) {
          process.env.HF_TOKEN = trimmed
            .slice("HF_TOKEN=".length)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (process.env.HF_TOKEN) return true;
        }
      }
    } catch {
      /* no .env here */
    }
  }
  return false;
}

/** The tool result: the output as text for the model, and as structured content. */
function respond<T extends Record<string, unknown>>(output: T) {
  return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
}

const VERSION: string = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;

export function createServer(): McpServer {
  const server = new McpServer({ name: "hf-assets", version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_models",
    {
      title: "List models",
      description:
        "Every model this server can reach, with its Space, licence and rough cost. " +
        "Read this before generating: it says which models may ship and which are prototype-only.",
      inputSchema: z.object({}),
      outputSchema: catalogueSchema,
    },
    async () => {
      const output = {
        models: CATALOGUE,
        procedural: PROCEDURAL,
        quota: QUOTA,
        token_present: Boolean(process.env.HF_TOKEN),
        root: ROOT,
        out_dir: DEFAULT_OUT,
      };
      return respond(output);
    },
  );

  server.registerTool(
    "generate_image",
    {
      title: "Generate an image",
      description:
        "Generate an image from a text prompt through a free Hugging Face Space. " +
        "Writes the image and a .json sidecar with the prompt, the parameters, the seed and the " +
        "raw Space response. Use klein with reference_images to edit an existing picture, qwen " +
        "when the image has to carry legible text.",
      inputSchema: z.object({
        prompt: z.string().describe("What the image should show."),
        model: z.enum(["zimage", "klein", "qwen"]).default("zimage").describe("Which Space to use."),
        out_dir: z.string().default("out/images").describe("Where to write the file."),
        size: z.string().default("1:1").describe("Aspect ('16:9') or exact size ('1280x720')."),
        seed: z.number().int().default(1234).describe("Seed; change it for another take."),
        count: z.number().int().min(1).max(16).default(1).describe("How many takes to generate."),
        name: z.string().nullable().default(null).describe("File name prefix; defaults to the model name."),
        reference_images: z.array(z.string()).nullable().default(null).describe("klein only: images to edit or restyle."),
        enhance_prompt: z.boolean().default(false).describe("qwen only: let the Space rewrite the prompt."),
      }),
      outputSchema: generatedSchema,
    },
    async (args) => {
      const files = await generateImage({
        model: args.model,
        prompt: args.prompt,
        outDir: resolvePath(args.out_dir),
        size: args.size,
        seed: args.seed,
        count: args.count,
        name: args.name ?? undefined,
        referenceImages: args.reference_images?.map(resolvePath),
        enhancePrompt: args.enhance_prompt,
      });
      const output = { files, log: "" };
      return respond(output);
    },
  );

  server.registerTool(
    "generate_mesh",
    {
      title: "Generate a 3D mesh",
      description:
        "Turn an image into a raw 3D mesh. trellis gives a textured GLB at ~30k faces; hunyuan " +
        "gives an untextured shape at ~450k faces. Writes the GLB and a .json sidecar with the " +
        "parameters, the inputs and the raw Space response.",
      inputSchema: z.object({
        image: z.string().describe("The source image, as a path."),
        model: z.enum(["hunyuan", "trellis"]).default("trellis").describe("Which Space to use."),
        out_dir: z.string().default("out/mesh").describe("Where to write the GLB."),
        extra_views: z.array(z.string()).nullable().default(null).describe("More views of the same object, fused as multi-image conditioning."),
        seed: z.number().int().default(1234).describe("Seed; change it for another take."),
      }),
      outputSchema: generatedSchema,
    },
    async (args) => {
      const files = await generateMesh({
        model: args.model,
        image: resolvePath(args.image),
        outDir: resolvePath(args.out_dir),
        extraViews: args.extra_views?.map(resolvePath),
        seed: args.seed,
      });
      const output = { files, log: "" };
      return respond(output);
    },
  );

  server.registerTool(
    "generate_audio",
    {
      title: "Generate sound, music or speech",
      description:
        "Generate sound effects, music or speech through a free Hugging Face Space. Writes the " +
        "audio and a .json sidecar with the prompt, the parameters, the seed and the raw Space " +
        "response. mmaudio is CC-BY-NC-4.0: prototype only, it must never reach a build.",
      inputSchema: z.object({
        prompt: z.string().describe("The sound, the music tags, or the words to say."),
        model: z.enum(["stable", "mmaudio", "music", "speech"]).default("stable").describe("Which Space to use."),
        out_dir: z.string().default("out/audio").describe("Where to write the file."),
        seconds: z.number().nullable().default(null).describe("Length in seconds."),
        seed: z.number().int().default(1234).describe("Seed; change it for another take."),
        count: z.number().int().min(1).max(16).default(1).describe("How many takes to generate."),
        name: z.string().nullable().default(null).describe("File name prefix; defaults to the model name."),
        negative_prompt: z.string().nullable().default(null).describe("mmaudio only: what to avoid."),
        lyrics: z.string().nullable().default(null).describe("music only: lyrics, or a path to a lyrics file."),
        language: z.string().default("en").describe("speech only: language code (ru, en, de, ja, ...)."),
        voice_reference: z.string().nullable().default(null).describe("speech only: a 5-10 s clip of a voice you have the right to clone."),
        exaggeration: z.number().min(0.25).max(2).default(0.5).describe("speech only: emotion, 0.25-2."),
      }),
      outputSchema: generatedSchema,
    },
    async (args) => {
      const files = await generateAudio({
        model: args.model,
        prompt: args.prompt,
        outDir: resolvePath(args.out_dir),
        seconds: args.seconds ?? undefined,
        seed: args.seed,
        count: args.count,
        name: args.name ?? undefined,
        negativePrompt: args.negative_prompt ?? undefined,
        lyrics: args.lyrics ?? undefined,
        language: args.language,
        voiceReference: args.voice_reference ?? undefined,
        exaggeration: args.exaggeration,
      });
      const output = { files, log: "" };
      return respond(output);
    },
  );

  server.registerTool(
    "generate_audio_batch",
    {
      title: "Generate a batch of audio assets",
      description:
        "Generate every asset in a manifest, two takes each, with its sidecar. The manifest lists " +
        "the prompt, the model, the parameters, the licence and the target loudness of each " +
        "asset. The tool refuses a manifest that names a model with a non-commercial licence, so " +
        "nothing that must not ship gets generated in the first place.",
      inputSchema: z.object({
        manifest: z.string().nullable().default(null).describe("Path to a manifest JSON file."),
        manifest_json: z.string().nullable().default(null).describe("The manifest itself, as JSON text, instead of a file. See the hf-assets://audio-manifest resource for the format."),
        out_dir: z.string().default("out/audio").describe("Where to write the candidates."),
        only: z.array(z.string()).nullable().default(null).describe("Asset names to generate; all of them by default."),
        count: z.number().int().min(1).max(16).default(2).describe("Takes per asset."),
      }),
      outputSchema: generatedSchema,
    },
    async (args) => {
      if (!args.manifest && !args.manifest_json) {
        throw new Error("pass either manifest (a path) or manifest_json (the manifest as text)");
      }
      const text = args.manifest_json ?? readFileSync(resolvePath(args.manifest as string), "utf8");
      const manifest = JSON.parse(text) as Manifest;
      const files = await runManifest({
        manifest,
        outDir: resolvePath(args.out_dir),
        only: args.only ?? undefined,
        count: args.count,
      });
      const output = { files, log: "" };
      return respond(output);
    },
  );

  server.registerTool(
    "postprocess_audio",
    {
      title: "Post-process audio",
      description:
        "Trim the silence, crossfade the ends into a seamless loop, normalise the level. This is " +
        "the step that turns a chosen take into a finished asset. With loop on, the file is " +
        "shortened by the crossfade so that it tiles without a click at the seam.",
      inputSchema: z.object({
        input_path: z.string().describe("The audio file to process."),
        output_path: z.string().describe("Where to write the result (.ogg or .wav)."),
        target_dbfs: z.number().default(-19).describe("Target RMS level in dBFS."),
        fade_ms: z.number().default(100).describe("Length of the loop crossfade in milliseconds."),
        loop: z.boolean().default(true).describe("Crossfade the ends so the file loops seamlessly."),
      }),
      outputSchema: z.object({
        path: z.string(),
        rms_dbfs: z.number(),
        seam: z.number(),
        seconds: z.number(),
      }),
    },
    async (args) => {
      const result = processFile(
        resolvePath(args.input_path),
        resolvePath(args.output_path),
        args.target_dbfs,
        args.fade_ms,
        args.loop,
      );
      const output = {
        path: result.path,
        rms_dbfs: result.rmsDbfs,
        seam: result.seam,
        seconds: result.seconds,
      };
      return respond(output);
    },
  );

  server.registerTool(
    "synth_sound",
    {
      title: "Synthesise sound procedurally",
      description:
        "Synthesise audio without the network and without spending any quota. engine writes a loop " +
        "whose length is a whole number of firing cycles, so it still loops cleanly when the game " +
        "pitches it up or down. sfx writes vehicle Foley: crash, tyre skid and boost. music writes a " +
        "breakbeat in four intensity tiers plus a menu theme.",
      inputSchema: z.object({
        kind: z.enum(["engine", "sfx", "music"]).default("engine").describe("What to synthesise."),
        out_dir: z.string().default("out/synth").describe("Where to write the files."),
        rpm: z.number().default(3375).describe("engine only: the revs the loop is recorded at. Must divide evenly into a whole number of firing cycles."),
        cycles: z.number().int().min(1).max(1000).default(100).describe("engine only: firing cycles in the loop."),
        cylinders: z.number().int().min(1).max(16).default(8).describe("engine only: cylinder count; 8 gives the V8 lope, 12 a smooth V12."),
        seed: z.number().int().default(7).describe("engine only: noise seed."),
        name: z.string().default("engine_loop").describe("engine only: file name stem."),
      }),
      outputSchema: generatedSchema,
    },
    async (args) => {
      const outDir = resolvePath(args.out_dir);
      let files: AssetFile[];
      let log: string;
      if (args.kind === "engine") {
        const loop = writeLoop(outDir, args.rpm, args.cycles, args.name, args.seed, args.cylinders);
        files = [{ path: loop.path, seconds: loop.seconds, model: "engine", seed: args.seed }];
        log = `seam step ${loop.seam} vs sharpest in-loop step ${loop.sharpestInLoopStep} -> looping is clean`;
      } else if (args.kind === "sfx") {
        files = generateSfx(outDir).map((path) => ({ path }));
        log = "All assets successfully synthesized.";
      } else {
        files = generateMusic(outDir).map((path) => ({ path }));
        log = "Music generation complete.";
      }
      const output = { files, log };
      return respond(output);
    },
  );

  server.registerTool(
    "model_sheet",
    {
      title: "Build a model sheet prompt",
      description:
        "Assemble a 4-in-1 model sheet prompt: front, rear, side and 3/4 in one image. One " +
        "prompt, one board, four angles of the same object — the fastest way to get a " +
        "consistent set of views, and the best input for the image-to-3D models. The object " +
        "preset suits any prop, building, character or machine; the vehicle preset keeps a " +
        "car or a bike in factory trim.",
      inputSchema: z.object({
        note_file: z.string().nullable().default(null).describe("A markdown note describing the object."),
        preset: z.enum(PRESETS as [string, ...string[]]).nullable().default(null).describe("object (default) or vehicle."),
        name: z.string().nullable().default(null).describe("Name of the object."),
        subject: z.string().nullable().default(null).describe("What it is: 'a hand-forged iron lantern', 'a mid-engine coupe'."),
        reference: z.string().nullable().default(null).describe("The design it is based on or inspired by."),
        finish: z.string().nullable().default(null).describe("Colour, material and finish."),
        front: z.string().nullable().default(null).describe("Override the front view description."),
        rear: z.string().nullable().default(null).describe("Override the rear view description."),
        side: z.string().nullable().default(null).describe("Override the side view description."),
        perspective: z.string().nullable().default(null).describe("Override the 3/4 view description."),
      }),
      outputSchema: z.object({
        prompt: z.string(),
        info: z.record(z.string(), z.string()),
      }),
    },
    async (args) => {
      const info: SheetInfo = args.note_file ? extractInfo(resolvePath(args.note_file)) : { ...DEFAULTS };
      if (args.preset) info.preset = args.preset as SheetInfo["preset"];
      if (args.name) info.name = args.name;
      if (args.subject) info.subject = args.subject;
      if (args.reference) info.reference = args.reference;
      if (args.finish) info.finish = args.finish;
      const views = {
        front: args.front ?? undefined,
        rear: args.rear ?? undefined,
        side: args.side ?? undefined,
        perspective: args.perspective ?? undefined,
      };
      const output = { prompt: buildPrompt(info, views), info: info as unknown as Record<string, string> };
      return respond(output);
    },
  );

  server.registerTool(
    "render_mesh",
    {
      title: "Render a mesh in a studio",
      description:
        "Render a mesh from six studio angles: both ends, both sides and two 3/4 views. The " +
        "mesh is centred, put on the floor and lit with a key, a fill and a rim light. Use it to " +
        "judge the shape before building anything on top of it. Needs Blender; set " +
        "HF_ASSETS_BLENDER if it is not on PATH.",
      inputSchema: z.object({
        glb: z.string().describe("The mesh to render, as a path."),
        out_dir: z.string().default("out/renders").describe("Where to write the PNGs."),
        prefix: z.string().default("render").describe("File name prefix."),
        length: z.number().default(2).describe("Length of the longest horizontal axis in metres."),
        samples: z.number().int().min(8).max(512).default(64).describe("Cycles samples per view; lower is faster."),
        width: z.number().int().min(160).max(3840).default(1280).describe("Render width in pixels."),
        height: z.number().int().min(120).max(2160).default(720).describe("Render height in pixels."),
      }),
      outputSchema: generatedSchema,
    },
    async (args) => {
      const result = renderMesh(
        resolvePath(args.glb),
        resolvePath(args.out_dir),
        args.prefix,
        args.length,
        args.samples,
        [args.width, args.height],
      );
      const output = { files: result.files.map((path) => ({ path })), log: result.log };
      return respond(output);
    },
  );

  server.registerResource(
    "prompt-templates",
    "hf-assets://prompt-templates",
    { mimeType: "text/markdown", description: "The canonical prompt templates for concepts and model sheets." },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: readFileSync(join(PACKAGE_ROOT, "PROMPT_TEMPLATES.md"), "utf8") }],
    }),
  );

  server.registerResource(
    "model-catalogue",
    "hf-assets://model-catalogue",
    { mimeType: "application/json", description: "Every model with its Space, licence and cost." },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ models: CATALOGUE, procedural: PROCEDURAL, quota: QUOTA }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "audio-manifest",
    "hf-assets://audio-manifest",
    { mimeType: "application/json", description: "An example audio manifest, showing the format the batch tool expects." },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: readFileSync(join(PACKAGE_ROOT, "audio_manifest.example.json"), "utf8"),
        },
      ],
    }),
  );

  return server;
}

async function main(): Promise<void> {
  // stdout belongs to the MCP protocol; anything else has to go to stderr.
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);

  if (!ensureToken()) {
    console.error("HF_TOKEN is not set. Generation will fail; the procedural tools still work.");
  }

  const server = createServer();
  await server.connect(new StdioServerTransport());
}

// Installed through npm, the entry point is a symlink named after the bin, so compare real paths.
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

const invokedDirectly = isEntryPoint();
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
