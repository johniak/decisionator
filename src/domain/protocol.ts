import { z } from "zod";
import { idSchema, type Attachment, type DecisionDocument, type DecisionGroup, type Thread } from "./decision";
import { attachmentTypes, maxAttachmentsPerField, type AttachmentType } from "./images";

/** Answer fields that can carry images, named like the result fields they belong to. */
export const answerAttachmentFields = ["text", "otherText", "comment"] as const;
export type AnswerAttachmentField = (typeof answerAttachmentFields)[number];

const attachmentReferenceShape = {
  id: z.string().regex(/^[0-9a-f]{64}$/, "Attachment IDs are SHA-256 hashes of uploaded images."),
  type: z.enum(attachmentTypes),
  name: z.string().trim().min(1).max(200).refine((value) => !/[\r\n]/.test(value), {
    message: "Attachment names must fit on one line.",
  }),
};

/** An image uploaded from the browser, referenced by its content hash. */
export const attachmentReferenceSchema = z.strictObject(attachmentReferenceShape);
const attachmentListSchema = z.array(attachmentReferenceSchema).max(maxAttachmentsPerField).default([]);

export const discussionRequestSchema = z.strictObject({
  items: z.array(z.strictObject({
    groupId: idSchema,
    message: z.string().trim().min(1).max(8_000),
    attachments: attachmentListSchema,
  })).min(1).max(30),
}).superRefine((request, context) => {
  const ids = request.items.map(({ groupId }) => groupId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Send at most one message per group at a time." });
  }
  for (const item of request.items) {
    if (hasDuplicates(item.attachments)) {
      context.addIssue({ code: "custom", message: `The same image is attached twice to the message in group ${item.groupId}.` });
    }
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
  attachments: z.array(z.strictObject({ field: z.enum(answerAttachmentFields), ...attachmentReferenceShape }))
    .max(answerAttachmentFields.length * maxAttachmentsPerField)
    .default([]),
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
  globalAttachments: attachmentListSchema,
});

export type DiscussionRequest = z.input<typeof discussionRequestSchema>;
export type GroupDecision = z.input<typeof groupDecisionSchema>;
export type ConfirmRequest = z.input<typeof confirmRequestSchema>;
export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;

/** Maps an uploaded image to the absolute path of the file the agent receives. */
export type AttachmentLocator = (reference: { id: string; type: AttachmentType }) => string;

export type AnswerAttachment = Attachment & { field: AnswerAttachmentField };

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
  attachments: AnswerAttachment[];
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
  globalAttachments: Attachment[];
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
  locate: AttachmentLocator,
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
    return buildGroupAnswer(group, decision, locate);
  });
  if (hasDuplicates(request.globalAttachments)) {
    throw new InvalidDecisionError("The same image is attached twice to the final comment.");
  }

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
      globalAttachments: request.globalAttachments.map((reference) => toAttachment(reference, locate)),
    },
  };
}

export function toAttachment(reference: AttachmentReference, locate: AttachmentLocator): Attachment {
  return { path: locate(reference), type: reference.type, name: reference.name };
}

function hasDuplicates(references: { id: string }[]): boolean {
  return new Set(references.map(({ id }) => id)).size !== references.length;
}

function buildGroupAnswer(
  group: DecisionGroup,
  decision: z.output<typeof groupDecisionSchema>,
  locate: AttachmentLocator,
): GroupAnswer {
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
  const imagesIn = (field: AnswerAttachmentField) => decision.attachments.filter((attachment) => attachment.field === field);
  for (const field of answerAttachmentFields) {
    const images = imagesIn(field);
    if (images.length > maxAttachmentsPerField) {
      throw new InvalidDecisionError(`Group ${group.id} has more than ${maxAttachmentsPerField} images in one answer field.`);
    }
    if (hasDuplicates(images)) throw new InvalidDecisionError(`Group ${group.id} has the same image twice in one answer field.`);
  }
  if (imagesIn("otherText").length > 0 && !group.allowOther) {
    throw new InvalidDecisionError(`Group ${group.id} does not accept an "Other" answer.`);
  }
  if (imagesIn("text").length > 0 && group.mode !== "text") {
    throw new InvalidDecisionError(`Group ${group.id} is not a text question.`);
  }
  const hasText = Boolean(decision.text) || imagesIn("text").length > 0;
  const hasOther = Boolean(decision.otherText) || imagesIn("otherText").length > 0;

  const thread: Thread = decision.dismissalReason
    ? { ...group.thread, dismissed: true, dismissalReason: decision.dismissalReason }
    : group.thread;
  const base = {
    groupId: group.id,
    title: group.title,
    mode: group.mode,
    comment: decision.comment || null,
    attachments: decision.attachments.map(({ field, ...reference }) => ({ field, ...toAttachment(reference, locate) })),
    thread,
  };

  if (decision.skipped) {
    if (selected.length > 0 || hasOther || hasText) {
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

  if (group.mode === "text" && !hasText) {
    throw new InvalidDecisionError(`Write an answer for group ${group.id} or skip it.`);
  }
  if (group.mode === "single") {
    const answers = selected.length + (hasOther ? 1 : 0);
    if (answers !== 1) {
      throw new InvalidDecisionError(`Choose exactly one answer for group ${group.id} or skip it.`);
    }
  }
  if (group.mode === "multi" && selected.length === 0 && !hasOther) {
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
