import { z } from "zod";
import { attachmentTypes, maxAttachmentsPerField } from "./images";

export const documentVersion = 1;
export const groupModes = ["single", "multi", "text"] as const;
export const chartTypes = ["bar", "line", "area", "pie", "scatter", "radar"] as const;
export const statTones = ["neutral", "positive", "negative", "warning"] as const;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const identifierMessage = "IDs must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens.";

export const idSchema = z.string().trim().min(1).max(80).regex(identifierPattern, identifierMessage);
export const sessionIdSchema = z.string().min(1).max(80).regex(identifierPattern, identifierMessage);

const oneLine = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !/[\r\n]/.test(value),
  { message: "This value must fit on one line." },
);
const markdown = (max: number) => z.string().trim().min(1).max(max);
const caption = oneLine(300).optional();

const languageSchema = oneLine(80);

const sentenceBoundary = /(?<!\b(?:e\.g|i\.e|vs|etc|approx|cf|incl|no|nr|np|tj|tzw|ok))[.!?。！？](?=\s+\p{Lu})/giu;

export function isOneSentence(value: string): boolean {
  return !/[\r\n]/.test(value) && [...value.matchAll(sentenceBoundary)].length === 0;
}

const cssColorPattern = /^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([0-9a-z\s.,%/+-]+\))$/i;

const htmlMockupSchema = z.strictObject({
  kind: z.literal("html"),
  body: z.string().trim().min(1).max(200_000),
  theme: z.enum(["light", "dark"]).optional(),
  caption,
});

const imageMockupSchema = z.strictObject({
  kind: z.literal("image"),
  path: z.string().trim().min(1).max(4_096).refine((path) => path.startsWith("/"), { message: "Image paths must be absolute." }),
  alt: oneLine(300),
  width: z.int().min(80).max(4_000).optional(),
  caption,
});

const mermaidMockupSchema = z.strictObject({
  kind: z.literal("mermaid"),
  code: z.string().trim().min(1).max(20_000),
  caption,
});

const chartValueSchema = z.union([z.string().max(200), z.number(), z.null()]);

const chartMockupSchema = z.strictObject({
  kind: z.literal("chart"),
  type: z.enum(chartTypes),
  data: z.array(z.record(z.string().min(1).max(80), chartValueSchema)).min(1).max(500),
  x: z.string().min(1).max(80),
  series: z.array(z.strictObject({
    key: z.string().min(1).max(80),
    label: oneLine(80).optional(),
  })).min(1).max(8),
  stacked: z.boolean().optional(),
  xLabel: oneLine(80).optional(),
  yLabel: oneLine(80).optional(),
  unit: oneLine(16).optional(),
  caption,
}).superRefine((chart, context) => {
  const seriesKeys = chart.series.map(({ key }) => key);
  if (new Set(seriesKeys).size !== seriesKeys.length) {
    context.addIssue({ code: "custom", message: "Chart series keys must be unique." });
  }
  if (seriesKeys.includes(chart.x)) {
    context.addIssue({ code: "custom", message: "The chart x key cannot also be a series key." });
  }
  if (chart.type === "pie" && chart.series.length !== 1) {
    context.addIssue({ code: "custom", message: "A pie chart needs exactly one series." });
  }
  for (const [index, row] of chart.data.entries()) {
    if (!(chart.x in row)) {
      context.addIssue({ code: "custom", message: `Chart data row ${index + 1} is missing the x key "${chart.x}".` });
    }
    if (chart.type === "scatter" && typeof row[chart.x] !== "number") {
      context.addIssue({ code: "custom", message: `Scatter chart row ${index + 1} needs a numeric x value.` });
    }
    for (const key of seriesKeys) {
      const value = row[key];
      if (value !== undefined && value !== null && typeof value !== "number") {
        context.addIssue({ code: "custom", message: `Chart series "${key}" must be numeric in data row ${index + 1}.` });
      }
    }
  }
});

const tableCellSchema = z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]);

const tableMockupSchema = z.strictObject({
  kind: z.literal("table"),
  columns: z.array(z.string().trim().max(120).refine((value) => !/[\r\n]/.test(value), {
    message: "Column headers must fit on one line.",
  })).min(1).max(12),
  rows: z.array(z.array(tableCellSchema)).min(1).max(100),
  highlightColumn: z.int().min(0).max(11).optional(),
  caption,
}).superRefine((table, context) => {
  for (const [index, row] of table.rows.entries()) {
    if (row.length !== table.columns.length) {
      context.addIssue({
        code: "custom",
        message: `Table row ${index + 1} has ${row.length} cells, but the table has ${table.columns.length} columns.`,
      });
    }
  }
  if (table.highlightColumn !== undefined && table.highlightColumn >= table.columns.length) {
    context.addIssue({ code: "custom", message: "highlightColumn must reference an existing column." });
  }
});

const statsMockupSchema = z.strictObject({
  kind: z.literal("stats"),
  items: z.array(z.strictObject({
    label: oneLine(80),
    value: z.union([oneLine(40), z.number()]),
    detail: oneLine(160).optional(),
    tone: z.enum(statTones).optional(),
  })).min(1).max(8),
  caption,
});

const paletteMockupSchema = z.strictObject({
  kind: z.literal("palette"),
  colors: z.array(z.strictObject({
    name: oneLine(60),
    value: z.string().trim().regex(cssColorPattern, "Use a CSS color such as #1f6feb, rgb(...), hsl(...), or oklch(...)."),
    usage: oneLine(120).optional(),
  })).min(1).max(24),
  caption,
});

const codeLanguageSchema = z.string().trim().min(1).max(40).regex(/^[a-z0-9#+-]+$/i, "Use a short language name such as ts, tsx, json, sql, or bash.");

const codeMockupSchema = z.strictObject({
  kind: z.literal("code"),
  code: z.string().min(1).max(50_000),
  language: codeLanguageSchema.optional(),
  filename: oneLine(160).optional(),
  caption,
});

const diffMockupSchema = z.strictObject({
  kind: z.literal("diff"),
  before: z.string().max(50_000),
  after: z.string().max(50_000),
  language: codeLanguageSchema.optional(),
  filename: oneLine(160).optional(),
  layout: z.enum(["unified", "split"]).optional(),
  caption,
}).refine((diff) => diff.before !== diff.after, { message: "A diff needs different before and after text." });

const leafMockupSchemas = [
  htmlMockupSchema,
  imageMockupSchema,
  mermaidMockupSchema,
  chartMockupSchema,
  tableMockupSchema,
  statsMockupSchema,
  paletteMockupSchema,
  codeMockupSchema,
  diffMockupSchema,
] as const;

const leafMockupSchema = z.discriminatedUnion("kind", leafMockupSchemas);

const splitMockupSchema = z.strictObject({
  kind: z.literal("split"),
  left: leafMockupSchema,
  right: leafMockupSchema,
  leftLabel: oneLine(80).optional(),
  rightLabel: oneLine(80).optional(),
  caption,
});

export const mockupSchema = z.discriminatedUnion("kind", [...leafMockupSchemas, splitMockupSchema]);
export const mockupKinds = mockupSchema.options.map((option) => option.shape.kind.value);

const absolutePathSchema = z.string().trim().min(1).max(4_096)
  .refine((path) => path.startsWith("/"), { message: "Paths must be absolute." });

/** An image the human attached; Decisionator writes the file and fills in the path. */
export const attachmentSchema = z.strictObject({
  path: absolutePathSchema,
  type: z.enum(attachmentTypes),
  name: oneLine(200),
});

export const threadMessageSchema = z.strictObject({
  id: idSchema,
  author: z.enum(["user", "agent"]),
  body: z.string().trim().min(1).max(8_000),
  // Optional, never defaulted: message history is compared exactly between rounds.
  attachments: z.array(attachmentSchema).min(1).max(maxAttachmentsPerField).optional(),
});

export const threadSchema = z.strictObject({
  messages: z.array(threadMessageSchema).max(100).default([]),
  dismissed: z.boolean().optional(),
  dismissalReason: z.string().trim().min(1).max(4_000).optional(),
}).superRefine((thread, context) => {
  if (thread.messages.length > 0 && thread.messages[0]?.author !== "user") {
    context.addIssue({ code: "custom", message: "A discussion must start with a user message." });
  }
  const ids = new Set<string>();
  for (const [index, message] of thread.messages.entries()) {
    if (ids.has(message.id)) {
      context.addIssue({ code: "custom", message: `Duplicate discussion message id: ${message.id}` });
    }
    ids.add(message.id);
    if (index > 0 && message.author === thread.messages[index - 1]?.author) {
      context.addIssue({ code: "custom", message: "User and agent messages must alternate in a discussion." });
    }
  }
  if (Boolean(thread.dismissed) !== Boolean(thread.dismissalReason)) {
    context.addIssue({ code: "custom", message: "A dismissed discussion requires the user's reason." });
  }
});

export const optionSchema = z.strictObject({
  id: idSchema,
  label: oneLine(160),
  description: markdown(20_000),
  recommended: z.boolean().optional(),
  pros: z.array(oneLine(400)).max(10).optional(),
  cons: z.array(oneLine(400)).max(10).optional(),
  mockup: mockupSchema.optional(),
});

export const recommendationSchema = z.strictObject({
  optionIds: z.array(idSchema).min(1).max(4),
  text: z.string().trim().min(1).max(300).refine(isOneSentence, {
    message: "The recommendation must be one sentence on one line.",
  }),
});

export const groupSchema = z.strictObject({
  id: idSchema,
  title: oneLine(200),
  context: markdown(20_000),
  mode: z.enum(groupModes),
  options: z.array(optionSchema).max(4).default([]),
  recommendation: recommendationSchema.optional(),
  allowOther: z.boolean().default(false),
  mockup: mockupSchema.optional(),
  thread: threadSchema.default({ messages: [] }),
}).superRefine((group, context) => {
  if (group.mode === "text") {
    if (group.options.length > 0) {
      context.addIssue({ code: "custom", message: `Text group ${group.id} cannot have options.` });
    }
    if (group.allowOther) {
      context.addIssue({ code: "custom", message: `Text group ${group.id} cannot allow an "Other" answer.` });
    }
    if (group.recommendation) {
      context.addIssue({ code: "custom", message: `Text group ${group.id} cannot recommend an option.` });
    }
    return;
  }
  if (group.options.length < 2) {
    context.addIssue({ code: "custom", message: `Group ${group.id} needs 2–4 real options.` });
  }
  const optionIds = new Set<string>();
  for (const option of group.options) {
    if (optionIds.has(option.id)) {
      context.addIssue({ code: "custom", message: `Duplicate option id in group ${group.id}: ${option.id}` });
    }
    optionIds.add(option.id);
  }
  const recommended = group.recommendation?.optionIds ?? [];
  if (new Set(recommended).size !== recommended.length) {
    context.addIssue({ code: "custom", message: `Group ${group.id} recommends the same option twice.` });
  }
  if (group.mode === "single" && recommended.length > 1) {
    context.addIssue({ code: "custom", message: `Single-choice group ${group.id} can recommend only one option.` });
  }
  for (const id of recommended) {
    if (!optionIds.has(id)) {
      context.addIssue({ code: "custom", message: `Group ${group.id} recommends an unknown option: ${id}` });
    }
  }
  const flagged = group.options.filter((option) => option.recommended).map(({ id }) => id);
  if (flagged.length !== recommended.length || flagged.some((id) => !recommended.includes(id))) {
    context.addIssue({
      code: "custom",
      message: `Group ${group.id}: set recommended: true exactly on the options listed in recommendation.optionIds.`,
    });
  }
});

export const assumptionSchema = z.strictObject({
  id: idSchema,
  text: markdown(1_000),
});

export const versionReferenceSchema = z.strictObject({
  number: z.int().positive(),
  createdAt: z.string(),
  reason: z.enum(["initial", "discussion"]),
  revisedGroupIds: z.array(idSchema),
});

export const decisionDocumentSchema = z.strictObject({
  version: z.literal(documentVersion),
  sessionId: sessionIdSchema,
  language: languageSchema.default("English"),
  title: oneLine(200),
  intro: z.string().trim().max(20_000).default(""),
  groups: z.array(groupSchema).min(1).max(30),
  assumptions: z.array(assumptionSchema).max(30).default([]),
  versions: z.array(versionReferenceSchema).max(200).optional(),
}).superRefine((document, context) => {
  const groupIds = new Set<string>();
  for (const group of document.groups) {
    if (groupIds.has(group.id)) context.addIssue({ code: "custom", message: `Duplicate group id: ${group.id}` });
    groupIds.add(group.id);
  }
  const assumptionIds = new Set<string>();
  for (const assumption of document.assumptions) {
    if (assumptionIds.has(assumption.id)) {
      context.addIssue({ code: "custom", message: `Duplicate assumption id: ${assumption.id}` });
    }
    assumptionIds.add(assumption.id);
  }
});

export type DecisionDocument = z.infer<typeof decisionDocumentSchema>;
export type DecisionGroup = z.infer<typeof groupSchema>;
export type DecisionOption = z.infer<typeof optionSchema>;
export type Mockup = z.infer<typeof mockupSchema>;
export type LeafMockup = z.infer<typeof leafMockupSchema>;
export type MockupKind = Mockup["kind"];
export type Thread = z.infer<typeof threadSchema>;
export type ThreadMessage = z.infer<typeof threadMessageSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type VersionReference = z.infer<typeof versionReferenceSchema>;
export type GroupMode = (typeof groupModes)[number];

export function parseDecisionDocument(input: unknown): DecisionDocument {
  const result = decisionDocumentSchema.safeParse(input);
  if (!result.success) throw new InvalidDocumentError(z.prettifyError(result.error));
  return result.data;
}

export class InvalidDocumentError extends Error {}

/** Rules for documents written by the agent, on top of the schema. */
export function validateAgentDocument(document: DecisionDocument): void {
  for (const group of document.groups) {
    if (group.thread.dismissed) {
      throw new InvalidDocumentError(`Only the user can dismiss the discussion in group ${group.id}.`);
    }
    if (group.thread.messages.some((message) => message.author === "agent" && message.attachments)) {
      throw new InvalidDocumentError(
        `Agent replies in group ${group.id} cannot carry attachments. Show images with an image mockup instead.`,
      );
    }
    if (group.thread.messages.at(-1)?.author === "user") {
      throw new InvalidDocumentError(
        `The discussion in group ${group.id} ends with a user message. Add exactly one agent reply to it.`,
      );
    }
  }
}

export function imagePaths(document: DecisionDocument): string[] {
  const paths = new Set<string>();
  const visit = (mockup: Mockup | undefined) => {
    if (!mockup) return;
    if (mockup.kind === "image") paths.add(mockup.path);
    if (mockup.kind === "split") {
      visit(mockup.left);
      visit(mockup.right);
    }
  };
  for (const group of document.groups) {
    visit(group.mockup);
    for (const option of group.options) visit(option.mockup);
    for (const message of group.thread.messages) {
      for (const attachment of message.attachments ?? []) paths.add(attachment.path);
    }
  }
  return [...paths];
}
