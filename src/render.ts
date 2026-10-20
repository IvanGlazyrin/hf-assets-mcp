/**
 * Studio renders of a raw mesh, in Blender.
 *
 * Blender is Python, so this shells out to the helper script that ships in
 * `blender/`. The script is the one thing in this repository that is not
 * TypeScript.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PACKAGE_ROOT } from "./paths.js";

/** Install folder names, newest version first: "Blender 4.10" comes before "Blender 4.9". */
export function newestFirst(names: string[]): string[] {
  const version = (name: string) => (name.match(/\d+/g) ?? []).map(Number);
  return [...names].sort((a, b) => {
    const [x, y] = [version(a), version(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (y[i] ?? 0) - (x[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/** Locate the Blender executable: env var, PATH, then the usual install paths. */
export function findBlender(): string | null {
  const fromEnv = process.env.HF_ASSETS_BLENDER;
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    throw new Error(`HF_ASSETS_BLENDER points at ${fromEnv}, which is not a file`);
  }
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["blender"], {
    encoding: "utf8",
  });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.split(/\r?\n/)[0].trim();

  if (process.platform === "darwin") {
    const mac = "/Applications/Blender.app/Contents/MacOS/Blender";
    if (existsSync(mac)) return mac;
  }
  if (process.platform === "win32") {
    // "Blender Foundation\Blender 5.2\blender.exe" and friends, newest first.
    const base = "C:\\Program Files\\Blender Foundation";
    if (existsSync(base)) {
      const found = newestFirst(readdirSync(base))
        .map((dir) => join(base, dir, "blender.exe"))
        .filter((exe) => existsSync(exe));
      if (found.length) return found[0];
    }
  }
  for (const candidate of ["/usr/bin/blender", "/snap/bin/blender", "/usr/local/bin/blender"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RenderResult {
  files: string[];
  log: string;
}

/** Render a mesh from six studio angles. */
export function renderMesh(
  glb: string,
  outDir: string,
  prefix = "render",
  length = 2,
  samples = 64,
  resolution: [number, number] = [1280, 720],
): RenderResult {
  const blender = findBlender();
  if (!blender) {
    throw new Error(
      "Blender was not found. Install it, or point HF_ASSETS_BLENDER at the executable.",
    );
  }
  mkdirSync(outDir, { recursive: true });
  const script = join(PACKAGE_ROOT, "blender", "render_raw.py");
  if (!existsSync(script)) {
    throw new Error(`the Blender helper is missing at ${script}`);
  }

  const proc = spawnSync(
    blender,
    [
      "--background",
      "--factory-startup",
      "--python",
      script,
      "--",
      glb,
      outDir,
      prefix,
      String(length),
      String(samples),
      String(resolution[0]),
      String(resolution[1]),
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (proc.status !== 0) {
    throw new Error(
      `Blender failed with exit code ${proc.status}:\n${(proc.stderr ?? "").slice(-2000)}`,
    );
  }
  const files = readdirSync(outDir)
    .filter((f) => new RegExp(`^${escapeRegExp(prefix)}_[a-f]\\.png$`).test(f))
    .sort()
    .map((f) => join(outDir, f));
  return { files, log: (proc.stdout ?? "").trim().slice(-2000) };
}
