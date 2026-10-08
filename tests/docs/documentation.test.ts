import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screenshots = [
  "docs/assets/decisionator-overview.png",
  "docs/assets/html-mockups.png",
  "docs/assets/structured-visuals.png",
  "docs/assets/diagrams.png",
  "docs/assets/live-discussion.png",
  "docs/assets/confirm-dialog.png",
];

describe("project documentation", () => {
  it("links the README screenshot and feature guide", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain('src="docs/assets/decisionator-overview.png"');
    expect(readme).toContain("[feature guide](docs/features.md)");
    expect(readme).toContain("Claude Code and Codex");
  });

  it("documents installation, usage, and uninstallation", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("./scripts/install.sh");
    expect(readme).toContain("./scripts/install.sh --local");
    expect(readme).toContain("--targets claude,codex");
    expect(readme).toContain("--language Polish");
    expect(readme).toContain("./scripts/uninstall.sh");
    expect(readme).toContain("/decisionator Before you plan");
    expect(readme).toContain("$decisionator Before you plan");
    expect(readme).toContain("bun run check");
    expect(readme).toContain("bun run demo");
  });

  it("documents the live wait and respond workflow", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("decisionator <SESSION_ID> --file <JSON_PATH> --live");
    expect(readme).toContain("decisionator wait my-session");
    expect(readme).toContain("decisionator respond my-session --file path/to/updated-decisions.json");
    expect(readme).toContain("Nothing reaches the agent until you press **Send to AI**");
  });

  it("walks through the main features with screenshots", () => {
    const guide = readFileSync("docs/features.md", "utf8");

    for (const screenshot of screenshots.slice(0, 6)) {
      expect(guide).toContain(screenshot.replace("docs/", ""));
    }
    expect(guide).toContain("Only that question's discussion is sent");
    expect(guide).toContain("AI working");
    expect(guide).toContain("Revised in version 2");
    expect(guide).toContain("Only you can dismiss a discussion");
    expect(guide).toContain("**Exact JSON**");
    expect(guide).toContain("**History**");
    expect(guide).toContain("Nothing is pre-selected");
  });

  it("keeps the original task prompt and the decisions made after it", () => {
    const prompt = readFileSync("AGENT_TASK_PROMPT.md", "utf8");

    expect(prompt.startsWith("# Agent benchmark task: build Decisionator\n")).toBe(true);
    expect(prompt).toContain("## Decisions made after this prompt");
    expect(prompt).toContain("decision language chosen at install time");
  });

  it("describes the security model", () => {
    const security = readFileSync("SECURITY.md", "utf8");

    expect(security).toContain("127.0.0.1");
    expect(security).toContain("sandbox=\"allow-same-origin\"");
    expect(security).toContain("no external requests");
    expect(security).toContain("never serves a file path");
  });

  it.each(screenshots)("ships a substantial 1920×1080 PNG at %s", (asset) => {
    const image = readFileSync(asset);

    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(image.readUInt32BE(16)).toBe(1920);
    expect(image.readUInt32BE(20)).toBe(1080);
    expect(image.length).toBeGreaterThan(20_000);
  });
});
