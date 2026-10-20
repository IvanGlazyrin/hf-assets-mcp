import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { buildPrompt, DEFAULTS, extractInfo } from "../src/model-sheet.js";

const dir = mkdtempSync(join(tmpdir(), "hf-assets-sheet-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("model sheet", () => {
  it("builds a neutral prompt from the defaults", () => {
    const prompt = buildPrompt({ ...DEFAULTS });
    expect(prompt).toContain("exact same object");
    expect(prompt).not.toMatch(/\{\w+\}/);
    expect(prompt).not.toMatch(/\bcar\b|automotive|vehicle/i);
  });

  it("reads frontmatter and **Field:** lines from a note", () => {
    const note = join(dir, "iron-lantern.md");
    writeFileSync(
      note,
      ["---", "name: Ember Lantern", "type: a street lantern", "---", "**Reference:** gas lamps", "**Finish:** bronze"].join("\n"),
    );
    const info = extractInfo(note);
    expect(info).toMatchObject({
      preset: "object",
      name: "Ember Lantern",
      subject: "a street lantern",
      reference: "gas lamps",
      finish: "bronze",
    });
  });

  it("falls back to the file name and the defaults", () => {
    const note = join(dir, "rusty_crate.md");
    writeFileSync(note, "just some prose");
    const info = extractInfo(note);
    expect(info.name).toBe("rusty crate");
    expect(buildPrompt(info)).toContain("a game-ready asset");
  });

  it("switches wording with the vehicle preset and honours view overrides", () => {
    const prompt = buildPrompt({ ...DEFAULTS, preset: "vehicle" }, { front: "a split grille" });
    expect(prompt).toContain("factory stock");
    expect(prompt).toContain("a performance vehicle");
    expect(prompt).toContain("a split grille");
  });

  it("takes the views from a note", () => {
    const note = join(dir, "views.md");
    writeFileSync(note, ["name: Test Piece", "front: a round door.", "side: a long flat roof"].join("\n"));
    const prompt = buildPrompt(extractInfo(note));
    expect(prompt).toContain("Straight front orthographic view: a round door.\n");
    expect(prompt).toContain("Side profile orthographic view: a long flat roof.\n");
  });
});
