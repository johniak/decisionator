import { describe, expect, it } from "vitest";
import {
  collapseContext,
  diffRows,
  highlightLines,
  pairRows,
  resolveLanguage,
  splitLines,
} from "../../web/mockups/highlight";

describe("code highlighting", () => {
  it("resolves languages from names, aliases, and file extensions", () => {
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage("TSX")).toBe("tsx");
    expect(resolveLanguage("bash")).toBe("shellscript");
    expect(resolveLanguage(undefined, "config.yml")).toBe("yaml");
    expect(resolveLanguage("brainfuck")).toBeNull();
    expect(resolveLanguage(undefined, "README")).toBeNull();
  });

  it("highlights code with tokens and leaves unknown languages plain", async () => {
    const lines = await highlightLines("const answer = 42;\nexport { answer };", "ts");

    expect(lines).toHaveLength(2);
    expect(lines![0]!.map(({ content }) => content).join("")).toBe("const answer = 42;");
    expect(new Set(lines![0]!.map(({ color }) => color)).size).toBeGreaterThan(1);
    await expect(highlightLines("+++", "brainfuck")).resolves.toBeNull();
  });

  it("splits lines without inventing a trailing empty line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\n\nb")).toEqual(["a", "", "b"]);
    expect(splitLines("")).toEqual([""]);
  });
});

describe("diff model", () => {
  it("numbers context, removed, and added lines", () => {
    expect(diffRows("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { type: "context", oldNumber: 1, newNumber: 1, text: "a" },
      { type: "removed", oldNumber: 2, text: "b" },
      { type: "added", newNumber: 2, text: "B" },
      { type: "context", oldNumber: 3, newNumber: 3, text: "c" },
      { type: "added", newNumber: 4, text: "d" },
    ]);
  });

  it("collapses long unchanged runs and keeps context around changes", () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const segments = collapseContext(diffRows(before, after));

    expect(segments.map((segment) => [segment.type, segment.rows.length])).toEqual([
      ["collapsed", 6],
      ["rows", 3],
      ["rows", 2],
      ["rows", 3],
      ["collapsed", 7],
    ]);
    expect(collapseContext(diffRows("a\nb\n", "a\nc\n")).every((segment) => segment.type === "rows")).toBe(true);
  });

  it("pairs removed and added lines side by side", () => {
    const paired = pairRows(diffRows("a\nb\nc\n", "a\nB\nC\nD\n"));

    expect(paired.map(({ left, right }) => [left?.text ?? null, right?.text ?? null])).toEqual([
      ["a", "a"],
      ["b", "B"],
      ["c", "C"],
      [null, "D"],
    ]);
  });
});
