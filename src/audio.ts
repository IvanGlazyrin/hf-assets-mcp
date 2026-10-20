/** Text-to-sound, music and speech through free Hugging Face Spaces. */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { handle_file } from "@gradio/client";

import { spaceOf } from "./catalogue.js";
import { describeParams, saveTake, space } from "./gradio.js";
import { resolvePath } from "./paths.js";
import type { AssetFile } from "./types.js";

export type AudioModel = "stable" | "mmaudio" | "music" | "speech";

export interface AudioOptions {
  model: AudioModel;
  prompt: string;
  outDir: string;
  seconds?: number;
  seed?: number;
  count?: number;
  name?: string;
  negativePrompt?: string;
  lyrics?: string;
  language?: string;
  voiceReference?: string;
  exaggeration?: number;
  /** Extra fields for the sidecar, such as the licence a manifest declares. */
  extraMeta?: Record<string, unknown>;
}

/**
 * Generate sound, music or speech and write each take next to its sidecar.
 *
 * `mmaudio` is CC-BY-NC-4.0: prototype only, it must never reach a build.
 * `stable` takes no seed, so its takes are numbered but cannot be repeated.
 */
export async function generateAudio(options: AudioOptions): Promise<AssetFile[]> {
  const { model, prompt, outDir } = options;
  const seed = options.seed ?? 1234;
  const count = options.count ?? 1;
  const name = options.name ?? model;
  const takesSeed = model !== "stable";

  mkdirSync(outDir, { recursive: true });
  const written: AssetFile[] = [];

  for (let s = seed; s < seed + count; s++) {
    const started = Date.now();
    const { spaceId, endpoint, params } = await buildRequest(model, prompt, s, options);
    const app = await space(spaceId);
    const result = await app.predict(endpoint, params);

    const shown = describeParams(params) as Record<string, unknown>;
    const take = await saveTake({
      result,
      extensions: [".wav", ".mp3", ".flac", ".ogg"],
      what: "audio",
      base: join(outDir, `${name}_${s}`),
      started,
      meta: {
        model,
        prompt,
        ...options.extraMeta,
        ...(takesSeed ? {} : { note: "the Space takes no seed: the number only numbers the take" }),
        params: shown,
      },
    });
    written.push({
      path: take.path,
      sidecar: take.sidecar,
      model,
      ...(takesSeed ? { seed: s } : {}),
      params: shown,
      seconds: take.seconds,
    });
  }
  return written;
}

/** The lyrics, read from a file if the argument names one. */
function readLyrics(lyrics: string): string {
  try {
    const path = resolvePath(lyrics);
    if (existsSync(path) && statSync(path).isFile()) return readFileSync(path, "utf8");
  } catch {
    /* not a path: it is the lyrics themselves */
  }
  return lyrics;
}

/**
 * The language's sample voice, which the Space offers for free.
 *
 * The Space's own default voice is a path on its server, which the client
 * cannot send back; asking for the language's sample takes no GPU and no quota.
 */
async function sampleVoice(language: string): Promise<string> {
  const app = await space(spaceOf("speech"));
  const sample = await app.predict("/on_language_change", {
    lang: language,
    current_ref: null,
    current_text: "",
  });
  const first = Array.isArray(sample) ? sample[0] : sample;
  const voice = typeof first === "string" ? first : ((first as { data?: string })?.data ?? "");
  if (!voice) {
    throw new Error("the Space did not offer a sample voice; pass a voice clip instead");
  }
  return voice;
}

async function buildRequest(
  model: AudioModel,
  prompt: string,
  seed: number,
  options: AudioOptions,
): Promise<{ spaceId: string; endpoint: string; params: Record<string, unknown> }> {
  const spaceId = spaceOf(model);

  if (model === "stable") {
    return {
      spaceId,
      endpoint: "/generate",
      params: { prompt, seconds_total: options.seconds ?? 10, steps: 100, cfg_scale: 7 },
    };
  }

  if (model === "mmaudio") {
    return {
      spaceId,
      endpoint: "/text_to_audio",
      params: {
        prompt,
        negative_prompt: options.negativePrompt ?? "music",
        seed,
        num_steps: 25,
        cfg_strength: 4.5,
        duration: options.seconds ?? 8,
      },
    };
  }

  if (model === "music") {
    return {
      spaceId,
      endpoint: "/__call__",
      params: {
        prompt,
        lyrics: readLyrics(options.lyrics ?? "[instrumental]"),
        audio_duration: options.seconds ?? 60,
        infer_step: 60,
        guidance_scale: 15.0,
        scheduler_type: "euler",
        cfg_type: "apg",
        omega_scale: 10.0,
        manual_seeds: String(seed),
        guidance_interval: 0.5,
        guidance_interval_decay: 0.0,
        min_guidance_scale: 3.0,
        use_erg_tag: true,
        use_erg_lyric: false,
        use_erg_diffusion: true,
        oss_steps: null,
        guidance_scale_text: 0.0,
        guidance_scale_lyric: 0.0,
        audio2audio_enable: false,
        ref_audio_strength: 0.5,
        ref_audio_input: null,
        lora_name_or_path: "none",
      },
    };
  }

  const language = options.language ?? "en";
  const voice = options.voiceReference ? resolvePath(options.voiceReference) : await sampleVoice(language);
  return {
    spaceId,
    endpoint: "/generate_tts_audio",
    params: {
      text_input: prompt,
      audio_prompt_path_input: handle_file(voice),
      language_id: language,
      exaggeration_input: options.exaggeration ?? 0.5,
      temperature_input: 0.8,
      seed_num_input: seed,
      cfgw_input: 0.5,
    },
  };
}
