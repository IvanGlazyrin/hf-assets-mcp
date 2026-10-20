/** Batch audio generation from a manifest. */

import { audioEntry } from "./catalogue.js";
import { generateAudio, type AudioModel } from "./audio.js";
import type { AssetFile } from "./types.js";

export interface ManifestEntry {
  name: string;
  model: string;
  prompt: string;
  params?: Record<string, unknown>;
  licence: string;
  seamless_loop?: boolean;
  target_dbfs?: number;
  track?: string;
  state?: string;
}

export interface Manifest {
  version?: number;
  shippable_licences?: string[];
  assets: ManifestEntry[];
}

/**
 * Fail loudly on anything that must not reach a build.
 *
 * What may ship is read off the catalogue: a model must be marked shippable
 * there, and the manifest must declare that model's licence and list it among
 * its `shippable_licences`. `mmaudio` is CC-BY-NC-4.0 and is always refused.
 */
export function validate(manifest: Manifest): void {
  if (!manifest || !Array.isArray(manifest.assets)) {
    throw new Error("manifest rejected:\n  it has no `assets` list");
  }
  const shippable = new Set(manifest.shippable_licences ?? []);
  const errors: string[] = [];
  for (const entry of manifest.assets) {
    const known = audioEntry(entry.model);
    if (!known) {
      errors.push(`${entry.name}: unknown model ${JSON.stringify(entry.model)}`);
      continue;
    }
    if (!known.shippable) {
      errors.push(`${entry.name}: model ${JSON.stringify(entry.model)} is prototype-only and must not ship`);
      continue;
    }
    if (!shippable.has(entry.licence) || entry.licence !== known.licence) {
      errors.push(
        `${entry.name}: licence ${JSON.stringify(entry.licence)} not recognised as shippable for ${entry.model}`,
      );
    }
  }
  if (errors.length) {
    throw new Error(`manifest rejected:\n  ${errors.join("\n  ")}`);
  }
}

export interface BatchOptions {
  manifest: Manifest;
  outDir: string;
  only?: string[];
  count?: number;
}

/** Validate a manifest and generate every asset in it. */
export async function runManifest(options: BatchOptions): Promise<AssetFile[]> {
  const { manifest, outDir } = options;
  const count = options.count ?? 2;

  validate(manifest);

  let assets = manifest.assets;
  if (options.only?.length) {
    const wanted = new Set(options.only);
    const unknown = [...wanted].filter((n) => !assets.some((a) => a.name === n));
    if (unknown.length) {
      throw new Error(`no such asset(s): ${unknown.sort().join(", ")}`);
    }
    assets = assets.filter((a) => wanted.has(a.name));
  }

  const written: AssetFile[] = [];
  for (const entry of assets) {
    const params = entry.params ?? {};
    const takes = await generateAudio({
      model: entry.model as AudioModel,
      prompt: entry.prompt,
      outDir,
      name: entry.name,
      count,
      seed: (params.seed as number) ?? 1234,
      seconds: params.seconds as number | undefined,
      negativePrompt: params.negative as string | undefined,
      lyrics: params.lyrics as string | undefined,
      language: params.lang as string | undefined,
      voiceReference: (params.ref as string) || undefined,
      exaggeration: params.exaggeration as number | undefined,
      extraMeta: {
        licence: entry.licence,
        track: entry.track ?? null,
        state: entry.state ?? null,
        seamless_loop: entry.seamless_loop ?? false,
        target_dbfs: entry.target_dbfs ?? null,
      },
    });
    for (const take of takes) written.push({ ...take, licence: entry.licence });
  }
  return written;
}
