/** The models this server can reach, with their Space, licence and cost. */

export interface ModelEntry {
  model: string;
  space: string;
  licence: string;
  shippable?: boolean;
  takes?: string;
  note?: string;
}

export interface ProceduralEntry {
  tool: string;
  kind: string;
  note: string;
}

export const CATALOGUE: Record<string, ModelEntry[]> = {
  image: [
    {
      model: "zimage",
      space: "Tongyi-MAI/Z-Image-Turbo",
      licence: "Apache-2.0",
      takes: "~15 s",
      note: "the default: photoreal, 8 steps",
    },
    {
      model: "klein",
      space: "black-forest-labs/FLUX.2-klein-4B",
      licence: "Apache-2.0",
      takes: "~10-20 s",
      note: "edits from reference images: 'same scene, but at night'",
    },
    {
      model: "qwen",
      space: "multimodalart/Qwen-Image-Fast",
      licence: "Apache-2.0",
      takes: "~15 s",
      note: "best at legible text in frame: signs, labels, logos",
    },
  ],
  mesh: [
    {
      model: "hunyuan",
      space: "tencent/Hunyuan3D-2",
      licence: "Tencent Hunyuan Community (territorial restrictions)",
      takes: "~20 s",
      note: "untextured shape, ~450k faces",
    },
    {
      model: "trellis",
      space: "trellis-community/TRELLIS",
      licence: "MIT",
      takes: "~40-60 s",
      note: "textured GLB, ~30k faces",
    },
  ],
  audio: [
    {
      model: "stable",
      space: "manoskary/stable-audio-open-1.0-music",
      licence: "StabilityAI-Community",
      shippable: true,
      note: "sound effects and loops up to 47 s; takes no seed, so a run cannot be repeated",
    },
    {
      model: "mmaudio",
      space: "hkchengrex/MMAudio",
      licence: "CC-BY-NC-4.0",
      shippable: false,
      note: "prototype only — must never reach a build",
    },
    {
      model: "music",
      space: "ACE-Step/ACE-Step",
      licence: "Apache-2.0",
      shippable: true,
      note: "music from genre and mood tags",
    },
    {
      model: "speech",
      space: "ResembleAI/Chatterbox-Multilingual-TTS",
      licence: "MIT",
      shippable: true,
      note: "23 languages; voice_reference clones a voice you have the right to use",
    },
  ],
};

export const PROCEDURAL: ProceduralEntry[] = [
  { tool: "synth_sound", kind: "engine", note: "engine loop that survives a pitch shift; spends no quota" },
  { tool: "synth_sound", kind: "sfx", note: "vehicle Foley: crash, tyre skid, boost; spends no quota" },
  { tool: "synth_sound", kind: "music", note: "breakbeat in four intensity tiers plus a menu theme; spends no quota" },
];

export const QUOTA: Record<string, string> = {
  no_token: "~2-3 min/day, about 3 runs in total",
  free_token: "5 min/day",
  pro: "40 min/day, above the limit is charged",
  note:
    "the quota is shared between images, meshes and sound, and resets 24 hours " +
    "after the first use of the day, not at midnight",
};

/** The Space that serves a model. */
export function spaceOf(model: string): string {
  for (const entries of Object.values(CATALOGUE)) {
    const entry = entries.find((e) => e.model === model);
    if (entry) return entry.space;
  }
  throw new Error(`unknown model ${JSON.stringify(model)}`);
}

/** The audio entry for a model, or undefined if there is no such model. */
export function audioEntry(model: string): ModelEntry | undefined {
  return CATALOGUE.audio.find((e) => e.model === model);
}
