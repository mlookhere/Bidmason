/** Headless HTTP smoke test of the production Next server. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = 3317;
const address = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", chunk => { stderr += chunk; });

async function responseOnceReady() {
  for (let attempt = 0; attempt < 70 && child.exitCode === null; attempt++) {
    try {
      return await fetch(address, { signal: AbortSignal.timeout(1800) });
    } catch {
      await pause(200);
    }
  }
  throw new Error(`Production HTTP server failed to respond: ${stderr.slice(-2000)}`);
}

try {
  const response = await responseOnceReady();
  assert.equal(response.status, 200, "homepage must render successfully");
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const html = await response.text();
  for (const phrase of ["BidMason", "Internal development preview", "No live lead capture", "not accepting submissions"]) {
    assert.ok(html.includes(phrase), `Missing required preview disclaimer: ${phrase}`);
  }
  assert.doesNotMatch(html, /<form[\s>]/i, "No fake lead-submission UI may ship");
  assert.match(html, /noindex/i, "Preview must not be indexed");
  console.log("PASS: production HTTP preview renders, discloses limits and has no forms");
} finally {
  child.kill();
}
