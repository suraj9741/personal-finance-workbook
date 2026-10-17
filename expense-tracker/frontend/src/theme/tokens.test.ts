import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Paths are relative to the frontend folder, where vitest runs.
// Raw colours live only in tokens.css, so a re-theme is a one-file change.
const styles = readFileSync(resolve("src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync(resolve("src/theme/tokens.css"), "utf8");

describe("design tokens", () => {
  it("keeps raw colours out of styles.css", () => {
    expect(styles.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? []).toEqual([]);
  });

  it("defines every token styles.css uses", () => {
    const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...styles.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
