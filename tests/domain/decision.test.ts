import { describe, expect, it } from "vitest";
import {
  decisionDocumentSchema,
  imagePaths,
  InvalidDocumentError,
  isOneSentence,
  mockupKinds,
  mockupSchema,
  parseDecisionDocument,
  validateAgentDocument,
} from "../../src/domain/decision";
import { decisionInput } from "../fixtures";

function withGroup(patch: Record<string, unknown>, index = 0) {
  const input = decisionInput();
  input.groups[index] = { ...input.groups[index], ...patch } as never;
  return input;
}

function issues(input: unknown): string {
  const result = decisionDocumentSchema.safeParse(input);
  if (result.success) return "";
  return result.error.issues.map((issue) => issue.message).join("\n");
}

describe("decision document schema", () => {
  it("accepts a complete document and applies defaults", () => {
    const document = parseDecisionDocument(decisionInput());

    expect(document.groups[0]?.thread).toEqual({ messages: [] });
    expect(document.groups[0]?.allowOther).toBe(false);
    expect(document.groups[2]?.options).toEqual([]);
  });

  it("supports every documented mockup kind", () => {
    expect(mockupKinds).toEqual([
      "html", "image", "mermaid", "chart", "table", "stats", "palette", "code", "diff", "split",
    ]);
  });

  it("rejects unknown fields so typos do not disappear silently", () => {
    const input = withGroup({ recomendation: { optionIds: ["steps"], text: "Use steps." } });

    expect(issues(input)).toContain("Unrecognized key");
  });

  it("requires schema version 1 and a valid session id", () => {
    expect(issues({ ...decisionInput(), version: 2 })).not.toBe("");
    expect(issues({ ...decisionInput(), sessionId: "../escape" })).toContain("IDs must start");
  });

  it("requires 2–4 options for choice groups and none for text groups", () => {
    const one = withGroup({ options: decisionInput().groups[0]!.options!.slice(0, 1), recommendation: undefined });
    one.groups[0]!.options![0]!.recommended = undefined;
    expect(issues(one)).toContain("needs 2–4 real options");

    const five = decisionInput();
    five.groups[1]!.options = Array.from({ length: 5 }, (_, index) => ({
      id: `o${index}`,
      label: `Option ${index}`,
      description: "Trade-off",
    }));
    expect(issues(five)).not.toBe("");

    const text = withGroup({ options: [{ id: "a", label: "A", description: "A" }] }, 2);
    expect(issues(text)).toContain("cannot have options");
  });

  it("keeps the recommendation consistent with the recommended flags", () => {
    const unknown = withGroup({ recommendation: { optionIds: ["missing"], text: "Use the missing one." } });
    expect(issues(unknown)).toContain("recommends an unknown option");

    const unflagged = decisionInput();
    unflagged.groups[0]!.options![1]!.recommended = undefined;
    expect(issues(unflagged)).toContain("recommended: true exactly");

    const flaggedWithoutRecommendation = withGroup({ recommendation: undefined });
    expect(issues(flaggedWithoutRecommendation)).toContain("recommended: true exactly");

    const two = withGroup({ recommendation: { optionIds: ["steps", "one-page"], text: "Use both." } });
    two.groups[0]!.options![0]!.recommended = true;
    expect(issues(two)).toContain("can recommend only one option");
  });

  it("limits the recommendation to one sentence", () => {
    expect(isOneSentence("Three steps keep the form short, e.g. Stripe uses them.")).toBe(true);
    expect(isOneSentence("Use steps. They are shorter.")).toBe(false);
    expect(isOneSentence("Use steps\nbecause they are short.")).toBe(false);
    const input = withGroup({ recommendation: { optionIds: ["steps"], text: "Use steps. They are shorter." } });
    expect(issues(input)).toContain("one sentence");
  });

  it("requires unique ids for groups, options, and assumptions", () => {
    const groups = decisionInput();
    groups.groups[1]!.id = "layout";
    expect(issues(groups)).toContain("Duplicate group id");

    const options = decisionInput();
    options.groups[1]!.options![1]!.id = "email";
    expect(issues(options)).toContain("Duplicate option id");

    const assumptions = decisionInput();
    assumptions.assumptions![1]!.id = "currency";
    expect(issues(assumptions)).toContain("Duplicate assumption id");
  });

  it("validates discussion threads", () => {
    const agentFirst = withGroup({ thread: { messages: [{ id: "a1", author: "agent", body: "Hi" }] } });
    expect(issues(agentFirst)).toContain("must start with a user message");

    const twoUsers = withGroup({
      thread: {
        messages: [
          { id: "u1", author: "user", body: "One" },
          { id: "u2", author: "user", body: "Two" },
        ],
      },
    });
    expect(issues(twoUsers)).toContain("must alternate");

    const duplicateIds = withGroup({
      thread: {
        messages: [
          { id: "m1", author: "user", body: "One" },
          { id: "m1", author: "agent", body: "Two" },
        ],
      },
    });
    expect(issues(duplicateIds)).toContain("Duplicate discussion message id");

    const reasonless = withGroup({ thread: { messages: [{ id: "u1", author: "user", body: "x" }], dismissed: true } });
    expect(issues(reasonless)).toContain("requires the user's reason");
  });

  it("lets only the human dismiss a thread or leave a question waiting", () => {
    const dismissed = parseDecisionDocument(withGroup({
      thread: {
        messages: [{ id: "u1", author: "user", body: "Why?" }, { id: "a1", author: "agent", body: "Because." }],
        dismissed: true,
        dismissalReason: "Not needed",
      },
    }));
    expect(() => validateAgentDocument(dismissed)).toThrow("Only the user can dismiss");

    const waiting = parseDecisionDocument(withGroup({ thread: { messages: [{ id: "u1", author: "user", body: "Why?" }] } }));
    expect(() => validateAgentDocument(waiting)).toThrow(InvalidDocumentError);
  });

  it("keeps attachments on the human's messages and refuses them on agent replies", () => {
    const image = { path: "/state/attachments/shot.png", type: "image/png", name: "shot.png" };
    const human = parseDecisionDocument(withGroup({
      thread: {
        messages: [
          { id: "u1", author: "user", body: "See this.", attachments: [image] },
          { id: "a1", author: "agent", body: "I see the overlap." },
        ],
      },
    }));
    expect(human.groups[0]?.thread.messages[0]?.attachments).toEqual([image]);
    expect(human.groups[0]?.thread.messages[1]).not.toHaveProperty("attachments");
    expect(() => validateAgentDocument(human)).not.toThrow();

    const agent = parseDecisionDocument(withGroup({
      thread: {
        messages: [
          { id: "u1", author: "user", body: "Show me." },
          { id: "a1", author: "agent", body: "Here.", attachments: [image] },
        ],
      },
    }));
    expect(() => validateAgentDocument(agent)).toThrow("cannot carry attachments");

    const relative = withGroup({ thread: { messages: [{ id: "u1", author: "user", body: "x", attachments: [{ ...image, path: "shot.png" }] }] } });
    expect(issues(relative)).toContain("Paths must be absolute");
    const svg = withGroup({ thread: { messages: [{ id: "u1", author: "user", body: "x", attachments: [{ ...image, type: "image/svg+xml" }] }] } });
    expect(issues(svg)).not.toBe("");
  });

  it("formats validation errors for the agent", () => {
    expect(() => parseDecisionDocument({ ...decisionInput(), title: "" })).toThrow(/title/);
  });
});

describe("mockups", () => {
  it("requires absolute image paths", () => {
    expect(mockupSchema.safeParse({ kind: "image", path: "shots/home.png", alt: "Home" }).success).toBe(false);
    expect(mockupSchema.safeParse({ kind: "image", path: "/tmp/home.png", alt: "Home" }).success).toBe(true);
  });

  it("validates chart data against the declared series", () => {
    const chart = {
      kind: "chart",
      type: "bar",
      x: "month",
      series: [{ key: "cost", label: "Cost" }],
      data: [{ month: "Jan", cost: 10 }, { month: "Feb", cost: "high" }],
    };
    expect(mockupSchema.safeParse(chart).error?.issues[0]?.message).toContain("must be numeric");
    expect(mockupSchema.safeParse({ ...chart, data: [{ cost: 1 }] }).error?.issues[0]?.message).toContain("missing the x key");
    expect(mockupSchema.safeParse({ ...chart, type: "pie", series: [{ key: "cost" }, { key: "other" }], data: [{ month: "Jan", cost: 1 }] }).success).toBe(false);
    expect(mockupSchema.safeParse({ ...chart, type: "scatter", data: [{ month: "Jan", cost: 1 }] }).success).toBe(false);
    expect(mockupSchema.safeParse({ ...chart, data: [{ month: "Jan", cost: 1 }, { month: "Feb", cost: null }] }).success).toBe(true);
  });

  it("validates table shape", () => {
    const table = { kind: "table", columns: ["Option", "Cost"], rows: [["A", 1], ["B"]] };
    expect(mockupSchema.safeParse(table).error?.issues[0]?.message).toContain("has 1 cells");
    expect(mockupSchema.safeParse({ ...table, rows: [["A", true]], highlightColumn: 3 }).success).toBe(false);
    expect(mockupSchema.safeParse({ ...table, rows: [["A", true], ["B", null]], highlightColumn: 1 }).success).toBe(true);
    expect(mockupSchema.safeParse({ ...table, columns: ["", "Cost"], rows: [["A", 1]] }).success).toBe(true);
    expect(mockupSchema.safeParse({ ...table, columns: ["Two\nlines", "Cost"], rows: [["A", 1]] }).success).toBe(false);
  });

  it("validates palette colors, code, diffs, and stats", () => {
    expect(mockupSchema.safeParse({ kind: "palette", colors: [{ name: "Brand", value: "url(x)" }] }).success).toBe(false);
    expect(mockupSchema.safeParse({ kind: "palette", colors: [{ name: "Brand", value: "#1f6feb" }, { name: "Ink", value: "oklch(0.2 0.02 260)" }] }).success).toBe(true);
    expect(mockupSchema.safeParse({ kind: "diff", before: "a", after: "a" }).success).toBe(false);
    expect(mockupSchema.safeParse({ kind: "diff", before: "a", after: "b", language: "ts" }).success).toBe(true);
    expect(mockupSchema.safeParse({ kind: "code", code: "x", language: "not a language" }).success).toBe(false);
    expect(mockupSchema.safeParse({ kind: "stats", items: [{ label: "Bundle", value: "+12 kB", tone: "negative" }] }).success).toBe(true);
  });

  it("allows one level of split comparison", () => {
    const left = { kind: "html", body: "<p>A</p>" };
    expect(mockupSchema.safeParse({ kind: "split", left, right: left, leftLabel: "Before" }).success).toBe(true);
    expect(mockupSchema.safeParse({ kind: "split", left, right: { kind: "split", left, right: left } }).success).toBe(false);
  });

  it("collects every image path in the document", () => {
    const input = decisionInput();
    input.groups[0]!.mockup = { kind: "image", path: "/tmp/a.png", alt: "A" } as never;
    input.groups[0]!.options![0]!.mockup = {
      kind: "split",
      left: { kind: "image", path: "/tmp/b.png", alt: "B" },
      right: { kind: "image", path: "/tmp/a.png", alt: "A again" },
    } as never;

    input.groups[1]!.thread = {
      messages: [
        { id: "u1", author: "user", body: "See", attachments: [{ path: "/tmp/c.png", type: "image/png", name: "c.png" }] },
        { id: "a1", author: "agent", body: "Seen." },
      ],
    } as never;

    expect(imagePaths(parseDecisionDocument(input))).toEqual(["/tmp/a.png", "/tmp/b.png", "/tmp/c.png"]);
  });
});
