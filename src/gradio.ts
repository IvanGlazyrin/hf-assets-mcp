/**
 * The Hugging Face Space layer.
 *
 * `@gradio/client` is the official JavaScript client, the same project as the
 * Python `gradio_client`, so the wire protocol matches. The one difference is
 * that it hands back file outputs as URLs rather than as local paths, so they
 * are downloaded here.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname } from "node:path";

import { Client } from "@gradio/client";

/** A file the Space produced. */
export interface RemoteFile {
  /** Where to fetch it. */
  url: string;
  /** The name the Space gave it. */
  name: string;
}

const clients = new Map<string, Promise<Awaited<ReturnType<typeof Client.connect>>>>();

/** A cached connection to a Space. A failed connection is dropped, so the next call retries. */
export function space(spaceId: string) {
  const token = process.env.HF_TOKEN || undefined;
  const key = `${spaceId}::${token ?? ""}`;
  const cached = clients.get(key);
  if (cached) return cached;
  const created = Client.connect(spaceId, token ? { token } : {});
  clients.set(key, created);
  created.catch(() => clients.delete(key));
  return created;
}

/**
 * Walk a Space's result and collect the files it produced.
 *
 * The result is whatever the endpoint returned: a string, an array, an object,
 * or any nesting of those. Files show up as `{ path, url, orig_name? }` objects
 * (or, on older Spaces, `{ name, data }` with a URL in `data`).
 */
export function collectFiles(result: unknown): RemoteFile[] {
  const found: RemoteFile[] = [];
  const seen = new Set<unknown>();

  const walk = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (typeof value === "string") return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    const record = value as Record<string, unknown>;
    const data = record.data;
    const name = record.name ?? record.orig_name;
    if (typeof data === "string" && typeof name === "string" && /^https?:\/\//.test(data)) {
      found.push({ url: data, name });
    } else if (typeof record.url === "string" && /^https?:\/\//.test(record.url)) {
      const fromPath = typeof record.path === "string" ? basename(record.path) : undefined;
      const fileName = typeof record.orig_name === "string" ? record.orig_name : fromPath;
      if (fileName) found.push({ url: record.url, name: fileName });
    }
    for (const item of Object.values(record)) walk(item);
  };

  walk(result);
  return found;
}

/**
 * The first produced file whose name ends with one of the extensions.
 *
 * A file with no extension at all is accepted as a fallback, since some
 * endpoints name their output that way. A file with a different extension never
 * is: a stray `.json` must not be saved as a `.png`.
 */
export function firstFileWithExtension(result: unknown, extensions: string[]): RemoteFile | null {
  const files = collectFiles(result);
  const exact = files.find((file) => extensions.includes(extname(file.name).toLowerCase()));
  if (exact) return exact;
  return files.find((file) => extname(file.name) === "") ?? null;
}

/** Fetch a produced file and write it to disk. */
export async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not download ${url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

/** Turn anything a Space returned into something JSON-serialisable. */
export function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return `<buffer ${value.length} bytes>`;
  if (value instanceof ArrayBuffer) return `<buffer ${value.byteLength} bytes>`;
  if (ArrayBuffer.isView(value)) return `<buffer ${value.byteLength} bytes>`;
  if (value instanceof Blob) return `<blob ${value.size} bytes>`;
  if (Array.isArray(value)) return value.map(jsonSafe);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = jsonSafe(item);
  }
  return out;
}

/**
 * The parameters of a run, as they go into a sidecar.
 *
 * Uploads (`handle_file`) are replaced by `{ file: <name> }`: the sidecar records
 * which file was sent, not a local path or the client's internal upload command.
 */
export function describeParams(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== "object") return jsonSafe(value);
  if (Array.isArray(value)) return value.map(describeParams);

  const record = value as Record<string, unknown>;
  const meta = record.meta as Record<string, unknown> | undefined;
  if (record.type === "command" && meta && typeof meta.path === "string") {
    return { file: basename(meta.path) };
  }
  if (meta && meta._type === "gradio.FileData") {
    const source = record.orig_name ?? record.path ?? record.url;
    return { file: typeof source === "string" ? basename(source.split("?")[0]) : "unknown" };
  }
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value) || value instanceof Blob) {
    return jsonSafe(value);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = describeParams(item);
  return out;
}

export interface SavedTake {
  path: string;
  sidecar: string;
  seconds: number;
}

/**
 * Download the file a Space produced and write it next to its sidecar.
 *
 * The sidecar is `meta` plus how long the run took and the raw Space response,
 * so any take can be traced back to the prompt and the parameters that made it.
 * `base` is the path without an extension: the file and the sidecar are
 * `<base>.<ext>` and `<base>.json`.
 */
export async function saveTake(options: {
  result: unknown;
  extensions: string[];
  what: string;
  base: string;
  started: number;
  meta: Record<string, unknown>;
}): Promise<SavedTake> {
  const { result, extensions, what, base, started, meta } = options;

  const file = firstFileWithExtension(result, extensions);
  if (!file) {
    throw new Error(`no ${what} in the result: ${JSON.stringify(jsonSafe(result)).slice(0, 500)}`);
  }
  const ext = extname(file.name).toLowerCase() || extensions[0];
  const path = `${base}${ext}`;
  await download(file.url, path);

  const seconds = Math.round((Date.now() - started) / 1000);
  const sidecar = `${base}.json`;
  const text = JSON.stringify({ ...meta, seconds, space_result: jsonSafe(result) }, null, 1);
  // The Space signs its file URLs; the signature is a temporary credential, not provenance.
  writeFileSync(sidecar, text.replace(/\?__sign=[A-Za-z0-9._-]+/g, ""), "utf8");
  return { path, sidecar, seconds };
}
