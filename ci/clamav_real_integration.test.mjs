import test from "node:test";
import assert from "node:assert/strict";
import { createConnection, createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalClamAvScanner } from "../lib/local-clamav-evidence-scanner.ts";

// This file is a separately required CI gate. NEVER silently skip when clamd is
// absent: missing engine, signature database, or positive detection is failure.
if (process.env.BIDMASON_REAL_CLAMAV_CI !== "1") {
  throw new Error("Real ClamAV integration must be explicitly enabled by CI");
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}" +
  "$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
assert.equal(Buffer.byteLength(EICAR), 68);
const CLEAN = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const DETECT = Buffer.concat([CLEAN, Buffer.from("\n" + EICAR + "\n")]);

async function unusedLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise(resolve => server.close(resolve));
  return address.port;
}

function ping(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => socket.destroy(new Error("PING timeout")), 1200);
    const chunks = [];
    socket.once("connect", () => socket.write("zPING\0"));
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => {
      clearTimeout(timeout);
      const reply = Buffer.concat(chunks).toString("ascii");
      if (reply === "PONG\0") resolve();
      else reject(new Error("Unexpected real clamd PING response"));
    });
    socket.on("error", err => { clearTimeout(timeout); reject(err); });
  });
}

async function waitForDaemon(port, proc, lastLog) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error("Real clamd terminated during startup: " + lastLog());
    }
    try {
      await ping(port);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error("Real clamd did not become healthy: " + lastLog());
}

test("real ClamAV engine scans evidence through the actual trusted TCP adapter", { timeout: 65000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "bidmason-clamav-ci-"));
  let proc;
  try {
    const db = join(directory, "signatures");
    await mkdir(db, { mode: 0o700 });
    // Only a temporary CI signature: proves a REAL ClamAV engine evaluated the
    // 68-byte standard EICAR test string, without vendor database/network use.
    const line = "BidMason.EICAR.Integration:0:*:" +
      Buffer.from(EICAR).toString("hex") + "\n";
    await writeFile(join(db, "bidmason-ci.ndb"), line, { mode: 0o600 });
    const port = await unusedLoopbackPort();
    const config = [
      "Foreground yes", "TCPSocket " + port, "TCPAddr 127.0.0.1",
      "DatabaseDirectory " + db, "StreamMaxLength 20M",
      "MaxFileSize 20M", "MaxScanSize 40M",
      "LogVerbose yes", "ReadTimeout 30",
    ].join("\n") + "\n";
    const configPath = join(directory, "clamd.conf");
    await writeFile(configPath, config, { mode: 0o600 });
    let logs = "";
    proc = spawn("clamd", ["--config-file=" + configPath], {
      stdio: ["ignore", "pipe", "pipe"], env: process.env,
    });
    for (const channel of [proc.stdout, proc.stderr]) {
      channel.on("data", chunk => {
        logs = (logs + chunk.toString("utf8")).slice(-3500);
      });
    }
    proc.on("error", err => { logs += " startup error: " + err.message; });
    await waitForDaemon(port, proc, () => logs);
    const scan = createLocalClamAvScanner({ port });
    assert.equal(await scan(CLEAN, "application/pdf"), "clean",
      "real daemon must recognize a clean PDF as clean");
    assert.equal(await scan(DETECT, "application/pdf"), "unsafe",
      "real daemon must detect the test signature inside an evidence PDF");
    // After killing the daemon, a cached/faked successful scan is forbidden.
    proc.kill("SIGTERM");
    await new Promise(resolve => proc.once("close", resolve));
    await assert.rejects(scan(CLEAN, "application/pdf"), /antivirus|scan/i);
  } finally {
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
      await new Promise(resolve => proc.once("close", resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
