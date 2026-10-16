import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("development preview cannot silently masquerade as a live service", () => {
  assert.match(page, /Internal development preview/);
  assert.match(page, /No live lead capture/);
  assert.match(page, /not accepting submissions/);
  assert.doesNotMatch(page, /<form\b/i);
});

test("preview is excluded from search engines", () => {
  assert.match(layout, /index:\s*false/);
  assert.match(layout, /follow:\s*false/);
});

test("preview includes mobile and reduced-motion behavior", () => {
  assert.match(styles, /max-width:700px/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("preview has accessible navigation landmarks", () => {
  assert.match(page, /<main>/);
  assert.match(page, /<nav aria-label/);
  assert.match(page, /<footer/);
});
