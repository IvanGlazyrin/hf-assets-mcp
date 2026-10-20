// Starts the built server over stdio and checks that it advertises its tools.
// Run it after `npm run build`:  node scripts/smoke.mjs

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });

const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
  }
});

const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const request = (id, method, params) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    send({ id, method, params });
  });

try {
  await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  send({ method: "notifications/initialized" });
  const { result } = await request(2, "tools/list", {});
  const names = result.tools.map((tool) => tool.name);
  console.log("tools:", names.join(", "));
  for (const wanted of ["generate_image", "generate_mesh", "generate_audio", "synth_sound", "model_sheet"]) {
    if (!names.includes(wanted)) throw new Error(`the server did not advertise ${wanted}`);
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  child.kill();
}
