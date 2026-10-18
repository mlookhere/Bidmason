import { connect } from "node:net";
import type { EvidenceContentType } from "./evidence.ts";

/**
 * Trusted-server ClamAV INSTREAM scanner. Local TCP ONLY, never a caller URL.
 * This module never claims safety without a real daemon's exact clean reply.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_REPLY = 256;
const TIMEOUT_MS = 45000;
const TYPES: ReadonlySet<EvidenceContentType> = new Set([
  "application/pdf", "image/png", "image/jpeg",
]);
const COMMAND = Buffer.from("zINSTREAM\0", "ascii");
const TERMINATOR = Buffer.alloc(4);

export function createLocalClamAvScanner(config: {
  /** Port of a clamd daemon bound ONLY to 127.0.0.1 on this server. */
  port: number;
}): (bytes: Uint8Array, contentType: EvidenceContentType) => Promise<"clean" | "unsafe"> {
  if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new TypeError("A valid local ClamAV port is required");
  }

  return (bytes, contentType) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1
      || bytes.byteLength > MAX_BYTES || !TYPES.has(contentType)) {
      return Promise.reject(new TypeError("Invalid evidence to scan"));
    }

    return new Promise<"clean" | "unsafe">((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port: config.port });
      let finished = false;
      let sentAll = false;
      let answer = Buffer.alloc(0);
      const timeout = setTimeout(
        () => finish(new Error("Evidence antivirus scan timed out")),
        TIMEOUT_MS,
      );

      function finish(error?: Error, result?: "clean" | "unsafe"): void {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        socket.destroy();
        if (error || !result) reject(error ?? new Error("Invalid antivirus response"));
        else resolve(result);
      }

      function writeAsync(data: Uint8Array): Promise<void> {
        return new Promise((done, failed) => {
          socket.write(data, err => err ? failed(err) : done());
        });
      }

      socket.on("error", () => finish(new Error("Evidence antivirus unavailable")));
      socket.on("end", () => finish(new Error("Antivirus ended without verdict")));
      socket.on("close", () => finish(new Error("Antivirus connection closed")));
      socket.on("data", chunk => {
        if (finished) return;
        answer = Buffer.concat([answer, chunk]);
        if (answer.length > MAX_REPLY) {
          finish(new Error("Oversized antivirus response"));
          return;
        }
        const terminator = answer.indexOf(0);
        if (terminator === -1) return;
        if (!sentAll || terminator !== answer.length - 1) {
          finish(new Error("Invalid antivirus response framing"));
          return;
        }
        const reply = answer.subarray(0, terminator).toString("utf8");
        if (reply === "stream: OK") finish(undefined, "clean");
        else if (/^stream: [^\r\n\0]{1,190} FOUND$/.test(reply)) {
          finish(undefined, "unsafe");
        } else finish(new Error("Antivirus did not return a valid verdict"));
      });

      socket.once("connect", () => {
        (async () => {
          await writeAsync(COMMAND);
          for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
            if (finished) return;
            const part = bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
            const length = Buffer.alloc(4);
            length.writeUInt32BE(part.length);
            await writeAsync(length);
            await writeAsync(part);
          }
          if (finished) return;
          await writeAsync(TERMINATOR);
          sentAll = true;
        })().catch(() => finish(new Error("Unable to stream evidence to antivirus")));
      });
    });
  };
}
