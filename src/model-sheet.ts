/**
 * Format a 4-in-1 model sheet prompt (front, rear, side, 3/4) for image generation.
 *
 * The model sheet is the fastest way to get a consistent set of views of one
 * object: one prompt, one board, four angles of the same thing. It is also the
 * best input for image-to-3D models — a clean 3/4 view on a plain background
 * gives a usable shape.
 *
 * Two presets ship: `object` describes any prop, building, character or machine
 * in neutral terms, `vehicle` adds the wording that keeps a car or a bike in
 * factory trim. The document is scanned for a few fields (name, type, reference,
 * finish) in frontmatter or in `**Field:** value` lines. Anything that is not
 * found falls back to a generic description, so an arbitrary note still
 * produces a prompt.
 */

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

export type Preset = "object" | "vehicle";

export const PRESETS: Preset[] = ["object", "vehicle"];

export const TEMPLATES: Record<Preset, string> = {
  object: `Model sheet and turnaround presentation of {name}, {subject}. Clean studio presentation board displaying four distinct angles of the exact same object on a single image:
1) Straight front orthographic view: {front}.
2) Straight rear orthographic view: {rear}.
3) Side profile orthographic view: {side}.
4) Dynamic 3/4 front perspective view: {perspective}.
Design reference: {reference}.
Finish: {finish}, neutral light gray studio cyclorama, crisp technical studio lighting, 8k turnaround sheet, no logos, no emblems, no text, no watermark.`,
  vehicle: `Design model sheet and blueprint turnaround presentation of {name}, {subject}, pristine factory stock condition. Clean studio presentation board displaying four distinct angles of the exact same vehicle on a single image:
1) Straight front orthographic view: {front}.
2) Straight rear orthographic view: {rear}.
3) Side profile orthographic view: {side}.
4) Dynamic 3/4 front perspective view: {perspective}.
Design reference: {reference}.
Finish: {finish}, neutral light gray studio cyclorama, crisp technical studio lighting, 8k turnaround sheet, a plain unbadged body with no logos, no badges, no emblems or crests, fictional design.`,
};

/** The view descriptions each preset falls back to. */
export const VIEW_DEFAULTS: Record<Preset, Record<"front" | "rear" | "side" | "perspective", string>> = {
  object: {
    front: "the main face of the object, symmetrical and fully readable, with its key features and proportions",
    rear: "the back of the object, with its construction details and any openings or attachments",
    side: "the full silhouette in profile, showing depth, proportions and how the parts fit together",
    perspective: "showing the sculptural 3D volume, the materials and the overall stance",
  },
  vehicle: {
    front: "low aerodynamic nose, sculpted intake, slim modern lamps and a lower splitter",
    rear: "integrated spoiler, a horizontal lamp signature and clean exhaust outlets",
    side: "low-slung silhouette, sculpted side ducts, factory ride height and alloy wheels",
    perspective: "showing the sculptural 3D body volume and the factory stance",
  },
};

/** What the subject is called when the note does not say. */
export const SUBJECT_DEFAULTS: Record<Preset, string> = {
  object: "a game-ready asset",
  vehicle: "a performance vehicle",
};

export const DEFAULTS = {
  preset: "object" as Preset,
  name: "unnamed object",
  subject: "",
  reference: "clean, readable, production-friendly design",
  finish: "matte neutral",
};

/** Field name -> patterns over the note text. The first match wins. */
const FIELD_PATTERNS: Record<string, RegExp[]> = {
  name: [/^name:\s*(.+)$/m, /^title:\s*(.+)$/m, /\*\*\s*Name:\*\*\s*(.+)/m],
  subject: [/^(?:type|subject):\s*(.+)$/m, /\*\*\s*(?:Type|Subject):\*\*\s*(.+)/m],
  reference: [
    /^(?:reference|benchmark|inspiration):\s*(.+)$/m,
    /\*\*\s*(?:Reference|Benchmark|Inspiration):\*\*\s*(.+)/m,
  ],
  finish: [
    /^(?:finish|color|colour):\s*(.+)$/m,
    /\*\*\s*(?:Finish|Color|Colour):\*\*\s*(.+)/m,
  ],
  preset: [/^preset:\s*(\w+)$/m],
  front: [/^front:\s*(.+)$/m, /\*\*\s*Front:\*\*\s*(.+)/m],
  rear: [/^rear:\s*(.+)$/m, /\*\*\s*Rear:\*\*\s*(.+)/m],
  side: [/^side:\s*(.+)$/m, /\*\*\s*Side:\*\*\s*(.+)/m],
  perspective: [/^perspective:\s*(.+)$/m, /\*\*\s*Perspective:\*\*\s*(.+)/m],
};

export type ViewName = "front" | "rear" | "side" | "perspective";

export interface SheetInfo {
  preset: Preset;
  name: string;
  subject: string;
  reference: string;
  finish: string;
  /** View descriptions from a note; each falls back to the preset's default. */
  front?: string;
  rear?: string;
  side?: string;
  perspective?: string;
}

/** Pulls the known fields out of a note; missing ones keep the defaults. */
export function extractInfo(notePath: string): SheetInfo {
  const content = readFileSync(notePath, "utf8");
  const info: Record<string, string> = { ...DEFAULTS };

  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const pattern of patterns) {
      const match = pattern.exec(content);
      if (match) {
        info[field] = match[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    }
  }

  if (!PRESETS.includes(info.preset as Preset)) info.preset = DEFAULTS.preset;
  if (info.name === DEFAULTS.name) {
    info.name = basename(notePath, extname(notePath)).replace(/[_-]/g, " ");
  }
  return info as unknown as SheetInfo;
}

/** The fully formatted prompt. */
export function buildPrompt(info: SheetInfo, views: Partial<Record<ViewName, string>> = {}): string {
  const defaults = VIEW_DEFAULTS[info.preset];
  // The template ends each view with a full stop, so one in the text would double up.
  const view = (name: ViewName) => (views[name] ?? info[name] ?? defaults[name]).replace(/\.\s*$/, "");
  const lookup: Record<string, string> = {
    name: info.name,
    subject: info.subject || SUBJECT_DEFAULTS[info.preset],
    reference: info.reference,
    finish: info.finish,
    front: view("front"),
    rear: view("rear"),
    side: view("side"),
    perspective: view("perspective"),
  };
  return TEMPLATES[info.preset].replace(/\{(\w+)\}/g, (_, key: string) => lookup[key] ?? "");
}
