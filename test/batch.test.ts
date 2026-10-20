import { describe, expect, it } from "vitest";

import { validate, type Manifest } from "../src/audio-batch.js";

const licences = ["Apache-2.0", "MIT", "StabilityAI-Community"];

function manifest(...assets: Manifest["assets"]): Manifest {
  return { shippable_licences: licences, assets };
}

describe("manifest validation", () => {
  it("accepts a shippable model with its licence", () => {
    expect(() =>
      validate(
        manifest(
          { name: "a", model: "stable", prompt: "x", licence: "StabilityAI-Community" },
          { name: "b", model: "music", prompt: "x", licence: "Apache-2.0" },
          { name: "c", model: "speech", prompt: "x", licence: "MIT" },
        ),
      ),
    ).not.toThrow();
  });

  it("refuses a prototype-only model, whatever licence it claims", () => {
    expect(() => validate(manifest({ name: "a", model: "mmaudio", prompt: "x", licence: "MIT" }))).toThrow(
      /prototype-only/,
    );
  });

  it("refuses a licence that is not the model's", () => {
    expect(() => validate(manifest({ name: "a", model: "music", prompt: "x", licence: "MIT" }))).toThrow(
      /not recognised as shippable/,
    );
  });

  it("refuses a licence the manifest does not list as shippable", () => {
    const m: Manifest = {
      shippable_licences: ["MIT"],
      assets: [{ name: "a", model: "music", prompt: "x", licence: "Apache-2.0" }],
    };
    expect(() => validate(m)).toThrow(/not recognised as shippable/);
  });

  it("refuses an unknown model and a manifest without assets", () => {
    expect(() => validate(manifest({ name: "a", model: "nope", prompt: "x", licence: "MIT" }))).toThrow(/unknown model/);
    expect(() => validate({} as Manifest)).toThrow(/no `assets` list/);
  });

  it("reports every problem at once", () => {
    try {
      validate(
        manifest(
          { name: "a", model: "mmaudio", prompt: "x", licence: "MIT" },
          { name: "b", model: "nope", prompt: "x", licence: "MIT" },
        ),
      );
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("a:");
      expect(String(error)).toContain("b:");
    }
  });
});
