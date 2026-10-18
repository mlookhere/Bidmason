import test from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceBodyInterrupted,
  readExactEvidenceBytes,
} from "../lib/bounded-evidence-stream.ts";

const PDF = Buffer.from("%PDF-1.7\nsynthetic evidence\n");
const idle = () => new ReadableStream({ pull() { return new Promise(() => {}); } });
const stream = (chunks, onCancel = () => {}) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
  },
  cancel: onCancel,
});
const active = () => new AbortController().signal;

test("exact size and chunk snapshots produce complete immutable bytes", async () => {
  const a = PDF.subarray(0, 5), b = PDF.subarray(5);
  const result = await readExactEvidenceBytes(stream([a, b]), PDF.length, active());
  assert.deepEqual(Buffer.from(result), PDF);
});

test("declared lengths above, below, absent, or invalid never pass", async () => {
  assert.equal(await readExactEvidenceBytes(stream([PDF]), PDF.length - 1, active()), null);
  assert.equal(await readExactEvidenceBytes(stream([PDF]), PDF.length + 1, active()), null);
  assert.equal(await readExactEvidenceBytes(null, PDF.length, active()), null);
  for (const size of [0, -1, NaN, 15 * 1024 * 1024 + 1, 2 ** 53]) {
    await assert.rejects(readExactEvidenceBytes(stream([PDF]), size, active()), RangeError);
  }
});

test("deadline interrupts a stalled stream instead of holding a worker forever", async () => {
  const started = Date.now();
  await assert.rejects(
    readExactEvidenceBytes(idle(), PDF.length, active(), 25),
    EvidenceBodyInterrupted,
  );
  assert.ok(Date.now() - started < 5000);
});

test("explicit aborted client request interrupts even with pending chunk reads", async () => {
  const signal = new AbortController();
  const pending = readExactEvidenceBytes(idle(), PDF.length, signal.signal, 1000);
  signal.abort();
  await assert.rejects(pending, EvidenceBodyInterrupted);
  await assert.rejects(
    readExactEvidenceBytes(idle(), PDF.length, signal.signal, 1000),
    EvidenceBodyInterrupted,
  );
});

test("a body that provides exactly expected bytes but never ends times out", async () => {
  const body = new ReadableStream({
    start(controller) { controller.enqueue(PDF); },
    pull() { return new Promise(() => {}); },
  });
  await assert.rejects(readExactEvidenceBytes(body, PDF.length, active(), 25),
    EvidenceBodyInterrupted);
});

test("invalid nonbinary and empty chunks fail closed", async () => {
  for (const value of ["unsafe string", new Uint8Array(0)]) {
    await assert.rejects(readExactEvidenceBytes(stream([value]), PDF.length, active()), TypeError);
  }
});

test("deadline override cannot disable or expand the hard 30-second budget", async () => {
  for (const ms of [0, -1, NaN, 30001, Number.POSITIVE_INFINITY]) {
    await assert.rejects(readExactEvidenceBytes(stream([PDF]), PDF.length, active(), ms),
      RangeError);
  }
});
