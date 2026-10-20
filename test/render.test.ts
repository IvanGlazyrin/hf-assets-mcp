import { describe, expect, it } from "vitest";

import { newestFirst } from "../src/render.js";

describe("newestFirst", () => {
  it("compares versions as numbers, not as text", () => {
    expect(newestFirst(["Blender 4.9", "Blender 4.10", "Blender 3.6", "Blender 4.2"])).toEqual([
      "Blender 4.10",
      "Blender 4.9",
      "Blender 4.2",
      "Blender 3.6",
    ]);
  });

  it("does not change its input", () => {
    const names = ["Blender 4.1", "Blender 4.2"];
    newestFirst(names);
    expect(names).toEqual(["Blender 4.1", "Blender 4.2"]);
  });
});
