import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** The text of a resource, which is a blob when the server sent binary. */
function textOf(content: { text: string } | { blob: string }): string {
  return "text" in content ? content.text : "";
}

const EXPECTED_TOOLS = [
  "list_models",
  "generate_image",
  "generate_mesh",
  "generate_audio",
  "generate_audio_batch",
  "postprocess_audio",
  "synth_sound",
  "model_sheet",
  "render_mesh",
];

describe("mcp server", () => {
  let client: InstanceType<typeof Client>;
  let transport: InstanceType<typeof StdioClientTransport>;
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "hf-assets-test-"));
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(REPO, "dist", "server.js")],
      cwd: REPO,
      env: { ...process.env, HF_ASSETS_ROOT: REPO } as Record<string, string>,
      stderr: "pipe",
    });
    client = new Client({ name: "hf-assets-test", version: "1.0.0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("advertises every tool with a description and a schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} has no input schema`).toBeTruthy();
      expect(tool.outputSchema, `${tool.name} has no output schema`).toBeTruthy();
    }
  });

  it("serves the resources", async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain("hf-assets://prompt-templates");
    expect(uris).toContain("hf-assets://model-catalogue");
    expect(uris).toContain("hf-assets://audio-manifest");

    const templates = await client.readResource({ uri: "hf-assets://prompt-templates" });
    expect(textOf(templates.contents[0]).toLowerCase()).toContain("model sheet");
  });

  it("serves the bundled files whatever the working directory is", async () => {
    const elsewhere = new StdioClientTransport({
      command: process.execPath,
      args: [join(REPO, "dist", "server.js")],
      cwd: outDir,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key, value]) => key !== "HF_ASSETS_ROOT" && value !== undefined),
      ) as Record<string, string>,
      stderr: "pipe",
    });
    const other = new Client({ name: "hf-assets-test", version: "1.0.0" });
    await other.connect(elsewhere);
    try {
      const templates = await other.readResource({ uri: "hf-assets://prompt-templates" });
      expect(textOf(templates.contents[0]).length).toBeGreaterThan(0);
      const manifest = await other.readResource({ uri: "hf-assets://audio-manifest" });
      expect(textOf(manifest.contents[0])).toContain("assets");
    } finally {
      await other.close();
    }
  });

  it("answers list_models", async () => {
    const result = await client.callTool({ name: "list_models", arguments: {} });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { models: Record<string, unknown[]> };
    expect(Object.keys(payload.models).sort()).toEqual(["audio", "image", "mesh"]);
  });

  it("builds a model sheet prompt", async () => {
    const result = await client.callTool({
      name: "model_sheet",
      arguments: { name: "Ember Lantern", subject: "a hand-forged iron street lantern", finish: "dark bronze" },
    });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { prompt: string };
    expect(payload.prompt).toContain("Ember Lantern");
    expect(payload.prompt).toContain("hand-forged iron street lantern");
    expect(payload.prompt).toContain("dark bronze");
    expect(payload.prompt).not.toMatch(/\bcar\b|automotive/i);
  });

  it("synthesises an engine loop without the network or a token", async () => {
    const result = await client.callTool({
      name: "synth_sound",
      arguments: { kind: "engine", out_dir: outDir, cycles: 8 },
    });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { files: { path: string }[]; log: string };
    expect(payload.files[0].path).toContain("engine_loop.wav");
    expect(payload.log).toContain("looping is clean");
  });

  it("refuses a manifest with a prototype-only model", async () => {
    const manifest = join(outDir, "manifest.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      manifest,
      JSON.stringify({
        shippable_licences: ["Apache-2.0", "MIT", "StabilityAI-Community"],
        assets: [{ name: "ambience", model: "mmaudio", prompt: "x", licence: "CC-BY-NC-4.0" }],
      }),
    );
    const result = await client.callTool({
      name: "generate_audio_batch",
      arguments: { manifest, out_dir: outDir },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("prototype-only");
  });

  it("takes the manifest as text too, and insists on one of the two", async () => {
    const inline = await client.callTool({
      name: "generate_audio_batch",
      arguments: {
        manifest_json: JSON.stringify({
          shippable_licences: ["MIT"],
          assets: [{ name: "ambience", model: "mmaudio", prompt: "x", licence: "CC-BY-NC-4.0" }],
        }),
        out_dir: outDir,
      },
    });
    expect(inline.isError).toBe(true);
    expect(JSON.stringify(inline.content)).toContain("prototype-only");

    const neither = await client.callTool({ name: "generate_audio_batch", arguments: { out_dir: outDir } });
    expect(neither.isError).toBe(true);
    expect(JSON.stringify(neither.content)).toContain("manifest_json");
  });

  it("survives a refused call", async () => {
    const result = await client.callTool({
      name: "synth_sound",
      arguments: { kind: "engine", out_dir: outDir, rpm: 3333 },
    });
    expect(result.isError).toBe(true);
    const after = await client.callTool({ name: "list_models", arguments: {} });
    expect(after.isError).toBeFalsy();
  });
});
