import { describe, expect, it } from "vitest";

import { collectFiles, describeParams, firstFileWithExtension } from "../src/gradio.js";

describe("collectFiles", () => {
  it("finds the current FileData shape inside a gallery", () => {
    const result = {
      type: "data",
      data: [
        [
          {
            image: {
              path: "/tmp/gradio/abc/image.png",
              url: "https://example.hf.space/gradio_api/file=/tmp/gradio/abc/image.png?__sign=x",
              orig_name: "image.png",
            },
            caption: null,
          },
        ],
        "seed: 1",
      ],
    };
    expect(collectFiles(result)).toEqual([
      { url: "https://example.hf.space/gradio_api/file=/tmp/gradio/abc/image.png?__sign=x", name: "image.png" },
    ]);
  });

  it("names a file after its path when there is no original name", () => {
    const files = collectFiles([{ path: "/tmp/gradio/x/model.glb", url: "https://example.hf.space/file=model.glb" }]);
    expect(files[0].name).toBe("model.glb");
  });

  it("still understands the older name/data shape", () => {
    const files = collectFiles({ name: "clip.wav", data: "https://example.hf.space/file=clip.wav" });
    expect(files).toEqual([{ url: "https://example.hf.space/file=clip.wav", name: "clip.wav" }]);
  });

  it("ignores plain strings and local paths", () => {
    expect(collectFiles(["https://example.com/a.png", { path: "/tmp/a.png" }])).toEqual([]);
  });
});

describe("firstFileWithExtension", () => {
  const file = (name: string) => ({ path: `/tmp/${name}`, url: `https://example.hf.space/file=${name}`, orig_name: name });

  it("picks the file with a wanted extension", () => {
    const result = [file("log.json"), file("take.WAV")];
    expect(firstFileWithExtension(result, [".wav"])?.name).toBe("take.WAV");
  });

  it("never returns a file of another type", () => {
    expect(firstFileWithExtension([file("log.json"), file("clip.mp4")], [".png"])).toBeNull();
  });

  it("falls back to a file with no extension at all", () => {
    expect(firstFileWithExtension([file("log.json"), file("blob")], [".png"])?.name).toBe("blob");
  });
});

describe("describeParams", () => {
  it("replaces uploads with the file name, whatever shape they have", () => {
    const upload = {
      type: "command",
      command: "upload_file",
      meta: { path: "C:/work/refs/hero.png", name: "C:/work/refs/hero.png" },
    };
    const fileData = {
      path: "/tmp/gradio/abc/blob",
      orig_name: "voice.wav",
      url: "https://example.hf.space/file=blob?__sign=x",
      meta: { _type: "gradio.FileData" },
    };
    expect(describeParams({ prompt: "p", image: upload, views: [{ image: upload }], voice: fileData, seed: 1 })).toEqual({
      prompt: "p",
      image: { file: "hero.png" },
      views: [{ image: { file: "hero.png" } }],
      voice: { file: "voice.wav" },
      seed: 1,
    });
  });
});
