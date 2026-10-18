import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createLocalClamAvScanner } from "../lib/local-clamav-evidence-scanner.ts";

const PDF = Buffer.from("%PDF-1.7\nsynthetic scan document\n");
const MIME = "application/pdf";

async function daemon(reply, action) {
  const sockets = new Set();
  const requests = [];
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let data = Buffer.alloc(0);
    let header = false;
    let total = Buffer.alloc(0);
    socket.on("data", chunk => {
      data = Buffer.concat([data, chunk]);
      if (!header) {
        if (data.length < 10) return;
        assert.equal(data.subarray(0, 10).toString("ascii"), "zINSTREAM\0");
        data = data.subarray(10);
        header = true;
      }
      while (data.length >= 4) {
        const n = data.readUInt32BE(0);
        if (n > 65536 || data.length < 4 + n) return;
        data = data.subarray(4);
        if (n === 0) {
          requests.push(total);
          if (reply === "close") socket.end();
          else if (reply === "hold") return; // Simulate a scanner waiting indefinitely.
          else socket.end(Buffer.from(reply, "utf8"));
          return;
        }
        total = Buffer.concat([total, data.subarray(0, n)]);
        data = data.subarray(n);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = server.address().port;
    await action(createLocalClamAvScanner({ port }), requests);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

test("real TCP socket protocol sends exact chunk lengths, bytes, terminator and accepts exact clean reply", async () => {
  await daemon("stream: OK\0", async (scan, requests) => {
    assert.equal(await scan(PDF, MIME), "clean");
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], PDF);
  });
});

test("real TCP transport sends multiple bounded frames for multi-chunk document", async () => {
  const big = Buffer.concat([PDF, Buffer.alloc(140000, 42)]);
  await daemon("stream: OK\0", async (scan, requests) => {
    assert.equal(await scan(big, MIME), "clean");
    assert.deepEqual(requests, [big]);
  });
});

test("positive virus detection blocks ingestion and is not mislabeled clean", async () => {
  await daemon("stream: Eicar-Test-Signature FOUND\0", async scan => {
    assert.equal(await scan(PDF, MIME), "unsafe");
  });
});

test("ambiguous or malicious daemon replies all fail closed", async () => {
  for (const response of [
    "stream: ERROR\0", "stream: OK\n", "stream: OK", "stream: OK\0evil",
    "stream: OK\0\0", "INSTREAM size limit exceeded\0", "stream: FOUND\0",
    "stream: OK : modified\0", "close", "x".repeat(270) + "\0",
  ]) {
    await daemon(response, async scan => {
      await assert.rejects(scan(PDF, MIME), /Antivirus|antivirus/i);
    });
  }
});

test("scanner cannot reach non-local host, requires a valid port and rejects invalid input before TCP", async () => {
  for (const port of [-1, 0, 65536, NaN, 1.5, "1", undefined]) {
    assert.throws(() => createLocalClamAvScanner({ port }), /port/);
  }
  let opened = 0;
  await daemon("stream: OK\0", async scan => {
    for (const [bytes, type] of [
      [Buffer.alloc(0), MIME], [Buffer.alloc(15*1024*1024+1), MIME],
      [PDF, "text/html"], ["raw text", MIME], [null, MIME],
    ]) {
      await assert.rejects(scan(bytes, type), /Invalid evidence/);
    }
    opened++;
  });
  assert.equal(opened, 1);
});

test("unavailable TCP scanner causes fail-closed rejection", async () => {
  const scanner = createLocalClamAvScanner({ port: 1 });
  await assert.rejects(scanner(PDF, MIME), /antivirus unavailable|Unable to stream/i);
});

test("abort during an in-flight scan closes the scanner connection promptly", async () => {
  await daemon("hold", async scan => {
    const controller = new AbortController();
    const running = scan(PDF, MIME, controller.signal);
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(running, /scan cancelled/i);
  });
});

test("already-aborted scan refuses to create a scanner request", async () => {
  const controller = new AbortController();
  controller.abort();
  await daemon("stream: OK\\0", async (scan, requests) => {
    await assert.rejects(scan(PDF, MIME, controller.signal), /scan cancelled/i);
    assert.deepEqual(requests, []);
  });
});
