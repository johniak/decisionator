import { z } from "zod";
import { idSchema, type DecisionDocument, type DecisionGroup, type Thread } from "./decision";

export const discussionRequestSchema = z.strictObject({
  items: z.array(z.strictObject({
    groupId: idSchema,
    message: z.string().trim().min(1).max(8_000),
  })).min(1).max(30),
}).superRefine((request, context) => {
  const ids = request.items.map(({ groupId }) => groupId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Send at most one message per group at a time." });
  }
});

export const groupDecisionSchema = z.strictObject({
  groupId: idSchema,
  selectedOptionIds: z.array(idSchema).max(4).default([]),
  otherText: z.string().trim().max(4_000).default(""),
  text: z.string().trim().max(20_000).default(""),
  comment: z.string().trim().max(8_000).default(""),
  skipped: z.boolean().default(false),
  dismissalReason: z.string().trim().max(4_000).default(""),
});

export const assumptionDecisionSchema = z.strictObject({
  id: idSchema,
  accepted: z.boolean(),
  objection: z.string().trim().max(4_000).default(""),
});

export const confirmRequestSchema = z.strictObject({
  confirmed: z.literal(true),
  documentVersion: z.int().positive(),
  groups: z.array(groupDecisionSchema).max(30),
  assumptions: z.array(assumptionDecisionSchema).max(30).default([]),
  globalComment: z.string().trim().max(20_000).default(""),
});

export type DiscussionRequest = z.infer<typeof discussionRequestSchema>;
export type GroupDecision = z.input<typeof groupDecisionSchema>;
export type ConfirmRequest = z.input<typeof confirmRequestSchema>;

export type GroupAnswer = {
  groupId: string;
  title: string;
  mode: DecisionGroup["mode"];
  status: "answered" | "skipped";
  selectedOptionIds: string[];
  selectedOptionLabels: string[];
  otherText: string | null;
  text: string | null;
  comment: string | null;
  skippedUsingRecommendation: boolean;
  thread: Thread;
};

export type AssumptionAnswer = {
  id: string;
  text: string;
  accepted: boolean;
  objection: string | null;
};

export type Answers = {
  groups: GroupAnswer[];
  assumptions: AssumptionAnswer[];
  globalComment: string | null;
};

export type ConfirmedResult = {
  status: "confirmed";
  sessionId: string;
  documentVersion: number;
  answers: Answers;
};

export type CancelledResult = { status: "cancelled"; sessionId: string };

export class InvalidDecisionError extends Error {}
export class StaleDocumentError extends Error {}

/**
 * Builds the exact result returned to the agent. The browser uses the same function
 * for the confirmation preview, so the preview cannot drift from the payload.
 */
export function buildConfirmedResult(
  document: DecisionDocument,
  currentVersion: number,
  input: ConfirmRequest,
): ConfirmedResult {
  const parsed = confirmRequestSchema.safeParse(input);
  if (!parsed.success) throw new InvalidDecisionError(z.prettifyError(parsed.error));
  const request = parsed.data;
  if (request.documentVersion !== currentVersion) {
    throw new StaleDocumentError(
      `The AI agent revised this screen (version ${currentVersion}). Review the latest version before confirming.`,
    );
  }

  const decisions = new Map<string, typeof request.groups[number]>();
  for (const decision of request.groups) {
    if (decisions.has(decision.groupId)) throw new InvalidDecisionError(`Duplicate answer for group ${decision.groupId}.`);
    decisions.set(decision.groupId, decision);
  }
  const knownGroups = new Set(document.groups.map(({ id }) => id));
  const unknownGroups = [...decisions.keys()].filter((id) => !knownGroups.has(id));
  if (unknownGroups.length > 0) throw new InvalidDecisionError(`Unknown groups: ${unknownGroups.join(", ")}`);

  const groups = document.groups.map((group) => {
    const decision = decisions.get(group.id);
    if (!decision) throw new InvalidDecisionError(`Group ${group.id} has no answer. Answer it or skip it explicitly.`);
    return buildGroupAnswer(group, decision);
  });

  const assumptionDecisions = new Map(request.assumptions.map((decision) => [decision.id, decision]));
  if (assumptionDecisions.size !== request.assumptions.length) {
    throw new InvalidDecisionError("Each assumption can be answered only once.");
  }
  const unknownAssumptions = [...assumptionDecisions.keys()]
    .filter((id) => !document.assumptions.some((assumption) => assumption.id === id));
  if (unknownAssumptions.length > 0) {
    throw new InvalidDecisionError(`Unknown assumptions: ${unknownAssumptions.join(", ")}`);
  }
  const assumptions = document.assumptions.map((assumption) => {
    const decision = assumptionDecisions.get(assumption.id) ?? { accepted: true, objection: "" };
    if (!decision.accepted && !decision.objection) {
      throw new InvalidDecisionError(`Explain your objection to assumption ${assumption.id}.`);
    }
    if (decision.accepted && decision.objection) {
      throw new InvalidDecisionError(`Assumption ${assumption.id} cannot be accepted with an objection.`);
    }
    return {
      id: assumption.id,
      text: assumption.text,
      accepted: decision.accepted,
      objection: decision.accepted ? null : decision.objection,
    };
  });

  return {
    status: "confirmed",
    sessionId: document.sessionId,
    documentVersion: currentVersion,
    answers: {
      groups,
      assumptions,
      globalComment: request.globalComment || null,
    },
  };
}

function buildGroupAnswer(group: DecisionGroup, decision: z.output<typeof groupDecisionSchema>): GroupAnswer {
  const selected = [...new Set(decision.selectedOptionIds)];
  if (selected.length !== decision.selectedOptionIds.length) {
    throw new InvalidDecisionError(`Group ${group.id} selects the same option twice.`);
  }
  const optionsById = new Map(group.options.map((option) => [option.id, option]));
  const unknown = selected.filter((id) => !optionsById.has(id));
  if (unknown.length > 0) throw new InvalidDecisionError(`Group ${group.id} has unknown options: ${unknown.join(", ")}`);
  if (decision.otherText && !group.allowOther) {
    throw new InvalidDecisionError(`Group ${group.id} does not accept an "Other" answer.`);
  }
  if (decision.text && group.mode !== "text") {
    throw new InvalidDecisionError(`Group ${group.id} is not a text question.`);
  }
  if (decision.dismissalReason && group.thread.messages.length === 0) {
    throw new InvalidDecisionError(`Group ${group.id} has no discussion to dismiss.`);
  }

  const thread: Thread = decision.dismissalReason
    ? { ...group.thread, dismissed: true, dismissalReason: decision.dismissalReason }
    : group.thread;
  const base = {
    groupId: group.id,
    title: group.title,
    mode: group.mode,
    comment: decision.comment || null,
    thread,
  };

  if (decision.skipped) {
    if (selected.length > 0 || decision.otherText || decision.text) {
      throw new InvalidDecisionError(`Skipped group ${group.id} cannot also contain an answer.`);
    }
    const recommended = group.recommendation?.optionIds ?? [];
    return {
      ...base,
      status: "skipped",
      selectedOptionIds: recommended,
      selectedOptionLabels: recommended.map((id) => optionsById.get(id)!.label),
      otherText: null,
      text: null,
      skippedUsingRecommendation: recommended.length > 0,
    };
  }

  if (group.mode === "text" && !decision.text) {
    throw new InvalidDecisionError(`Write an answer for group ${group.id} or skip it.`);
  }
  if (group.mode === "single") {
    const answers = selected.length + (decision.otherText ? 1 : 0);
    if (answers !== 1) {
      throw new InvalidDecisionError(`Choose exactly one answer for group ${group.id} or skip it.`);
    }
  }
  if (group.mode === "multi" && selected.length === 0 && !decision.otherText) {
    throw new InvalidDecisionError(`Choose at least one answer for group ${group.id} or skip it.`);
  }
  return {
    ...base,
    status: "answered",
    selectedOptionIds: group.options.filter((option) => selected.includes(option.id)).map(({ id }) => id),
    selectedOptionLabels: group.options.filter((option) => selected.includes(option.id)).map(({ label }) => label),
    otherText: decision.otherText || null,
    text: decision.text || null,
    skippedUsingRecommendation: false,
  };
}
