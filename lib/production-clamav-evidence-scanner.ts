import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { connect } from "node:net";
import { isAbsolute, join, normalize } from "node:path";
import { promisify } from "node:util";
import type { EvidenceContentType } from "./evidence.ts";
import { createLocalClamAvScanner } from "./local-clamav-evidence-scanner.ts";

const exec = promisify(execFile);
const MAX_SIGNATURE_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const VERSION_REPLY_MAX = 256;
const VERSION_TIMEOUT_MS = 2_500;

/** Pure parser for the *verified, officially signed* sigtool daily.cvd/cld output. */
export function parseSignedDailyInfo(info: string, nowMs: number): number {
  if (!Number.isFinite(nowMs) || typeof info !== "string" || info.length > 8192
    || !/^Verification OK\.\s*$/m.test(info)) {
    throw new Error("ClamAV official signature verification unavailable");
  }
  const build = /^Build time: (.+)$/m.exec(info);
  const version = /^Version: ([1-9][0-9]{0,9})\s*$/m.exec(info);
  const signatures = /^Signatures: ([1-9][0-9]{0,9})\s*$/m.exec(info);
  if (!build || !version || !signatures || Number(signatures[1]) < 1_000) {
    throw new Error("ClamAV official daily signatures unavailable");
  }
  const builtAt = Date.parse(build[1].trim());
  if (!Number.isFinite(builtAt)
    || nowMs - builtAt > MAX_SIGNATURE_AGE_MS
    || builtAt - nowMs > MAX_FUTURE_SKEW_MS) {
    throw new Error("ClamAV daily signature database stale or future-dated");
  }
  return Number(version[1]);
}

/** Pure parser for the actual loaded clamd VERSION protocol reply. */
export function parseLoadedDatabaseVersion(reply: string): number {
  if (typeof reply !== "string" || reply.length > VERSION_REPLY_MAX) {
    throw new Error("ClamAV daemon database version unavailable");
  }
  // The null-terminated zVERSION response includes engine, loaded signature
  // version and database date. It must not be COMMAND UNAVAILABLE or partial.
  const match = /^ClamAV [0-9][a-zA-Z0-9.+_-]{0,40}\/([1-9][0-9]{0,9})\/[^\r\n\0]{1,100}\0$/.exec(reply);
  if (!match) throw new Error("ClamAV daemon database version unavailable");
  return Number(match[1]);
}

async function loadedVersion(port: number, signal?: AbortSignal): Promise<number> {
  if (signal?.aborted) throw new Error("ClamAV production check cancelled");
  return new Promise<number>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let done = false;
    let data = Buffer.alloc(0);
    const finish = (err?: Error, version?: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      socket.destroy();
      if (err || version === undefined) reject(err ?? new Error("ClamAV readiness failed"));
      else resolve(version);
    };
    const onAbort = () => finish(new Error("ClamAV production check cancelled"));
    const timer = setTimeout(
      () => finish(new Error("ClamAV VERSION request timed out")), VERSION_TIMEOUT_MS,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    socket.on("connect", () => socket.write("zVERSION\0"));
    socket.on("data", chunk => {
      if (done) return;
      data = Buffer.concat([data, chunk]);
      if (data.length > VERSION_REPLY_MAX) {
        finish(new Error("ClamAV daemon VERSION reply oversized"));
        return;
      }
      if (data.includes(0)) {
        try { finish(undefined, parseLoadedDatabaseVersion(data.toString("utf8"))); }
        catch { finish(new Error("ClamAV daemon VERSION invalid")); }
      }
    });
    socket.on("error", () => finish(new Error("ClamAV local daemon unavailable")));
    socket.on("end", () => finish(new Error("ClamAV VERSION ended without verdict")));
    socket.on("close", () => finish(new Error("ClamAV VERSION connection closed")));
  });
}

export type ProductionClamAvConfig = {
  port: number;
  /** Absolute, server-controlled directory populated by trusted freshclam. */
  signatureDirectory: string;
};

/**
 * Production scanner requires SIGNED + CURRENT official daily signatures,
 * and verifies clamd actually loaded the same signature version before EVERY
 * scan. The isolated EICAR-only CI daemon MUST fail this gate.
 *
 * No user-supplied paths, URLs, remote hosts or unsigned .ndb-only databases.
 */
export function createProductionClamAvScanner(config: ProductionClamAvConfig):
  (bytes: Uint8Array, type: EvidenceContentType, signal?: AbortSignal) => Promise<"clean" | "unsafe"> {
  if (!config || !isAbsolute(config.signatureDirectory ?? "")
      || normalize(config.signatureDirectory).includes("\0")) {
    throw new TypeError("Trusted absolute ClamAV signature directory required");
  }
  const scan = createLocalClamAvScanner({ port: config.port });
  return async (bytes, type, signal) => {
    if (signal?.aborted) throw new Error("ClamAV production check cancelled");
    // Prefer freshclam's daily.cld; use signed daily.cvd if no .cld exists.
    let database: string | undefined;
    for (const name of ["daily.cld", "daily.cvd"]) {
      const candidate = join(config.signatureDirectory, name);
      try {
        const st = await lstat(candidate);
        if (st.isFile() && !st.isSymbolicLink()) { database = candidate; break; }
      } catch { /* try the other official daily format */ }
    }
    if (!database || signal?.aborted) throw new Error("Signed ClamAV daily database unavailable");
    let info: string;
    try {
      const result = await exec("sigtool", ["--info", database], {
        timeout: 3_000,
        maxBuffer: 8_192,
        signal,
        windowsHide: true,
      });
      info = result.stdout;
    } catch {
      throw new Error("ClamAV official signature verification unavailable");
    }
    const expected = parseSignedDailyInfo(info, Date.now());
    const loaded = await loadedVersion(config.port, signal);
    if (loaded !== expected || signal?.aborted) {
      throw new Error("ClamAV loaded signature version differs from verified daily database");
    }
    // Exact clean/unsafe verdict from a live local daemon is still required.
    return scan(bytes, type, signal);
  };
}
