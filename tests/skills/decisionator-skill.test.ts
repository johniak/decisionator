import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mockupKinds, mockupSchema, parseDecisionDocument } from "../../src/domain/decision";

const skillFile = "skills/decisionator/SKILL.md";
const schemaFile = "skills/decisionator/references/decision-schema.md";
const mockupsFile = "skills/decisionator/references/mockups.md";

function jsonBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]!);
}

describe("Decisionator skill", () => {
  it("can be discovered and invoked by both Claude Code and Codex", async () => {
    const skill = await readFile(skillFile, "utf8");
    const codex = await readFile("skills/decisionator/agents/openai.yaml", "utf8");

    expect(skill).toMatch(/^---\nname: decisionator\ndescription: .+\n---\n/);
    expect(skill).toContain("Claude Code or Codex");
    expect(skill).toContain("/decisionator or $decisionator");
    expect(codex).toContain("display_name: \"Decisionator\"");
    expect(codex).toContain("$decisionator");
  });

  it("carries exactly one language configuration line for the installer", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill.match(/^Decision language configuration: .*$/gm)).toEqual([
      "Decision language configuration: write every decision screen and every agent reply in English.",
    ]);
    expect(skill).toContain("Copy that language name literally into `language`");
  });

  it("teaches when a decision screen is worth opening", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill).toContain("Two or more related decisions block your next step");
    expect(skill).toContain("easier to show than to describe");
    expect(skill).toContain("design round or reviewing screenshots");
    expect(skill).toContain("Do not open one for a single yes/no question");
  });

  it("requires real options, an honest one-sentence recommendation, visuals, and assumptions", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill).toContain("2–4 real options");
    expect(skill).toContain("Never add a strawman");
    expect(skill).toContain("one sentence in `recommendation.text`");
    expect(skill).toContain("Never pre-select anything");
    expect(skill).toContain("Show instead of tell");
    expect(skill).toContain("phone and desktop widths");
    expect(skill).toContain("built with the `dn-*` classes");
    expect(skill).toContain("Finish with `assumptions`");
  });

  it("follows the live wait and respond protocol", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill).toContain("decisionator <SESSION_ID> --file <JSON_PATH> --live");
    expect(skill).toContain("persistent background process");
    expect(skill).toContain("Run `decisionator wait <SESSION_ID>` in the foreground");
    expect(skill).toContain("it returns the same unanswered request");
    expect(skill).toContain("decisionator respond <SESSION_ID> --file <JSON_PATH>");
    expect(skill).toContain("then immediately run `decisionator wait <SESSION_ID>` again");
    expect(skill).toContain("in one short line what is on screen");
    expect(skill).toContain("answer here in the terminal");
  });

  it("answers discussions directly without dropping messages or dismissing threads", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill).toContain("use the returned `document` as the base");
    expect(skill).toContain("Answer first");
    expect(skill).toContain("Do not reply with a change log");
    expect(skill).toContain("Append exactly one `agent` message");
    expect(skill).toContain("Never drop, edit, or reorder a user message");
    expect(skill).toContain("only the human may dismiss a discussion");
    expect(skill).toContain("revise that group's `options`, `mockup`, `recommendation`, or `context`");
    expect(skill).toContain("When that message has `attachments`, open every image at its `path`");
    expect(skill).toContain("never add `attachments` to your own messages");
  });

  it("records confirmed answers verbatim and stops on cancellation", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill).toContain("record the answers in your working notes");
    expect(skill).toContain("\"adopted the recommendation by skipping\"");
    expect(skill).toContain("\"no decision, ask again\"");
    expect(skill).toContain("Copy every `comment`, every assumption objection, the `globalComment`");
    expect(skill).toContain("Open every image listed in a group's `attachments`");
    expect(skill).toContain("`globalAttachments`");
    expect(skill).toContain("`cancelled`: no decisions were made");
    expect(skill).toContain("Never decide on the human's behalf");
  });

  it("asks for Codex sandbox escalation only where it applies", async () => {
    const skill = await readFile(skillFile, "utf8");

    expect(skill.match(/Only in Codex on macOS, never in Claude Code/g)).toHaveLength(1);
    expect(skill).toContain("binding its loopback server, writing its session state, or opening the browser");
    expect(skill).toContain("This approval does not answer any question");
  });
});

describe("decision contract reference", () => {
  it("documents a complete example that passes validation", async () => {
    const [example] = jsonBlocks(await readFile(schemaFile, "utf8"));
    const document = parseDecisionDocument(JSON.parse(example!));

    const kinds = new Set<string>();
    const visit = (mockup?: { kind: string; left?: { kind: string }; right?: { kind: string } }) => {
      if (!mockup) return;
      kinds.add(mockup.kind);
      if (mockup.left) kinds.add(mockup.left.kind);
      if (mockup.right) kinds.add(mockup.right.kind);
    };
    for (const group of document.groups) {
      visit(group.mockup);
      for (const option of group.options) visit(option.mockup);
    }
    expect([...kinds].sort()).toEqual([...mockupKinds].sort());
    expect(document.groups.some((group) => group.thread.messages.length >= 2)).toBe(true);
    expect(document.groups.some((group) => group.mode === "text")).toBe(true);
    expect(document.groups.some((group) => group.allowOther)).toBe(true);
    expect(document.assumptions.length).toBeGreaterThan(0);
  });

  it("documents the confirmed result returned to the agent", async () => {
    const blocks = jsonBlocks(await readFile(schemaFile, "utf8"));
    const result = JSON.parse(blocks[1]!);

    expect(result.status).toBe("confirmed");
    expect(Object.keys(result.answers.groups[0])).toEqual(expect.arrayContaining([
      "selectedOptionIds", "otherText", "comment", "skippedUsingRecommendation", "attachments", "thread",
    ]));
    expect(result.answers.groups[0].attachments[0]).toEqual({
      field: "comment",
      path: expect.stringMatching(/^\/.+\/attachments\/[0-9a-f]{64}\.png$/),
      type: "image/png",
      name: expect.any(String),
    });
    expect(Object.keys(result.answers.assumptions[0])).toEqual(expect.arrayContaining(["accepted", "objection"]));
    expect(result.answers).toHaveProperty("globalComment");
    expect(result.answers).toHaveProperty("globalAttachments");
  });

  it("documents every mockup kind with an example that passes validation", async () => {
    const markdown = await readFile(mockupsFile, "utf8");
    const examples = jsonBlocks(markdown).map((block) => mockupSchema.parse(JSON.parse(block)));

    expect(new Set(examples.map(({ kind }) => kind))).toEqual(new Set(mockupKinds));
    for (const kind of mockupKinds) expect(markdown).toContain(`## ${kind === "code" || kind === "diff" ? "code and diff" : kind}`);
    for (const helper of ["dn-browser", "dn-phone", "dn-card", "dn-btn-primary", "dn-placeholder", "--dn-accent"]) {
      expect(markdown).toContain(helper);
    }
  });

  it("lists the rules respond enforces", async () => {
    const reference = await readFile(schemaFile, "utf8");

    expect(reference).toContain("edits, removes, or reorders an existing message");
    expect(reference).toContain("does not add exactly one `agent` message to each group listed in `groupIds`");
    expect(reference).toContain("sets `dismissed` or `dismissalReason`");
    expect(reference).toContain("adds `attachments` to an agent message, or changes the `attachments` of a user message");
    expect(reference).toContain("returns the unanswered request again");
  });
});
