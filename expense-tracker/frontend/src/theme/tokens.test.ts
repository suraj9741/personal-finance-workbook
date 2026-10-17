import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("design tokens", () => {
  it("keeps raw colours out of styles.css so a re-theme is a tokens.css edit", () => {
    const styles = read("../styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(styles.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? []).toEqual([]);
  });

  it("defines every token that styles.css uses", () => {
    const tokens = read("./tokens.css");
    const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...read("../styles.css").matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });
});
