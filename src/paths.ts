import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The directory relative paths are resolved against. */
export const ROOT = resolve(process.env.HF_ASSETS_ROOT || process.cwd());

/** Where the package itself lives: the templates, the manifest and the Blender helper ship there. */
export const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Where generated assets go unless the caller says otherwise. */
export const DEFAULT_OUT = join(ROOT, "out");

/** Resolve a path against the root. Absolute paths are left alone. */
export function resolvePath(p: string): string {
  if (!p) return p;
  return isAbsolute(p) ? p : join(ROOT, p);
}
