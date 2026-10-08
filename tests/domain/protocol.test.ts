import { describe, expect, it } from "vitest";
import { parseDecisionDocument, type DecisionDocument } from "../../src/domain/decision";
import { attachmentFileName } from "../../src/domain/images";
import {
  buildConfirmedResult,
  discussionRequestSchema,
  InvalidDecisionError,
  StaleDocumentError,
  type AttachmentLocator,
  type ConfirmRequest,
} from "../../src/domain/protocol";
import { decisionDocument, decisionInput } from "../fixtures";

const locate: AttachmentLocator = ({ id, type }) => `/state/checkout-redesign/attachments/${attachmentFileName(id, type)}`;
const screenshot = { id: "a".repeat(64), type: "image/png" as const, name: "Screenshot 2026-10-08.png" };
const photo = { id: "b".repeat(64), type: "image/jpeg" as const, name: "phone.jpg" };

function confirmResult(document: DecisionDocument, version: number, input: ConfirmRequest) {
  return buildConfirmedResult(document, version, input, locate);
}

function request(overrides: Partial<ConfirmRequest> = {}): ConfirmRequest {
  return {
    confirmed: true,
    documentVersion: 1,
    groups: [
      { groupId: "layout", selectedOptionIds: ["steps"], comment: "Keep the address step short." },
      { groupId: "notifications", selectedOptionIds: ["email"], otherText: "Slack for B2B" },
      { groupId: "copy", text: "Thanks — your order is on its way" },
    ],
    assumptions: [
      { id: "currency", accepted: true },
      { id: "guest", accepted: false, objection: "Require an account for subscriptions." },
    ],
    globalComment: "Ship behind a flag.",
    ...overrides,
  };
}

describe("confirmed result", () => {
  it("returns every answer, comment, assumption, and the global comment", () => {
    const result = confirmResult(decisionDocument(), 1, request());

    expect(result).toEqual({
      status: "confirmed",
      sessionId: "checkout-redesign",
      documentVersion: 1,
      answers: {
        groups: [
          {
            groupId: "layout",
            title: "Checkout layout",
            mode: "single",
            status: "answered",
            selectedOptionIds: ["steps"],
            selectedOptionLabels: ["Three steps"],
            otherText: null,
            text: null,
            comment: "Keep the address step short.",
            skippedUsingRecommendation: false,
            attachments: [],
            thread: { messages: [] },
          },
          {
            groupId: "notifications",
            title: "Order notifications",
            mode: "multi",
            status: "answered",
            selectedOptionIds: ["email"],
            selectedOptionLabels: ["Email"],
            otherText: "Slack for B2B",
            text: null,
            comment: null,
            skippedUsingRecommendation: false,
            attachments: [],
            thread: { messages: [] },
          },
          {
            groupId: "copy",
            title: "Confirmation headline",
            mode: "text",
            status: "answered",
            selectedOptionIds: [],
            selectedOptionLabels: [],
            otherText: null,
            text: "Thanks — your order is on its way",
            comment: null,
            skippedUsingRecommendation: false,
            attachments: [],
            thread: { messages: [] },
          },
        ],
        assumptions: [
          { id: "currency", text: "Prices stay in EUR for the first release.", accepted: true, objection: null },
          {
            id: "guest",
            text: "Guest checkout remains available.",
            accepted: false,
            objection: "Require an account for subscriptions.",
          },
        ],
        globalComment: "Ship behind a flag.",
        globalAttachments: [],
      },
    });
  });

  it("records a skipped group as adopting its recommendation", () => {
    const result = confirmResult(decisionDocument(), 1, request({
      groups: [
        { groupId: "layout", skipped: true },
        { groupId: "notifications", skipped: true },
        { groupId: "copy", skipped: true },
      ],
    }));

    expect(result.answers.groups.map((group) => [
      group.groupId,
      group.status,
      group.selectedOptionIds,
      group.skippedUsingRecommendation,
    ])).toEqual([
      ["layout", "skipped", ["steps"], true],
      ["notifications", "skipped", [], false],
      ["copy", "skipped", [], false],
    ]);
  });

  it("keeps the option order of the document for multi-select answers", () => {
    const result = confirmResult(decisionDocument(), 1, request({
      groups: [
        { groupId: "layout", selectedOptionIds: ["one-page"] },
        { groupId: "notifications", selectedOptionIds: ["push", "email"] },
        { groupId: "copy", text: "Done" },
      ],
    }));

    expect(result.answers.groups[1]?.selectedOptionIds).toEqual(["email", "push"]);
  });

  it("treats an assumption without an answer as accepted", () => {
    const result = confirmResult(decisionDocument(), 1, request({ assumptions: [] }));

    expect(result.answers.assumptions.every((assumption) => assumption.accepted)).toBe(true);
  });

  it("includes the full thread and the human's dismissal", () => {
    const input = decisionInput();
    input.groups[0] = {
      ...input.groups[0]!,
      thread: {
        messages: [
          { id: "u1", author: "user", body: "Why steps?" },
          { id: "a1", author: "agent", body: "Shorter payment form." },
        ],
      },
    } as never;
    const result = confirmResult(parseDecisionDocument(input), 1, request({
      groups: [
        { groupId: "layout", selectedOptionIds: ["steps"], dismissalReason: "Answered." },
        { groupId: "notifications", selectedOptionIds: ["email"] },
        { groupId: "copy", text: "Done" },
      ],
    }));

    expect(result.answers.groups[0]?.thread).toEqual({
      messages: [
        { id: "u1", author: "user", body: "Why steps?" },
        { id: "a1", author: "agent", body: "Shorter payment form." },
      ],
      dismissed: true,
      dismissalReason: "Answered.",
    });
  });

  it.each([
    ["an unanswered group", { groups: request().groups!.slice(0, 2) }, "has no answer"],
    ["two answers to a single-choice group", {
      groups: [{ groupId: "layout", selectedOptionIds: ["steps", "one-page"] }, ...request().groups!.slice(1)],
    }, "exactly one answer"],
    ["an empty single-choice group", {
      groups: [{ groupId: "layout" }, ...request().groups!.slice(1)],
    }, "exactly one answer"],
    ["an empty multi-choice group", {
      groups: [request().groups![0]!, { groupId: "notifications" }, request().groups![2]!],
    }, "at least one answer"],
    ["an empty text group", {
      groups: [...request().groups!.slice(0, 2), { groupId: "copy" }],
    }, "Write an answer"],
    ["an Other answer where it is not allowed", {
      groups: [{ groupId: "layout", otherText: "Wizard" }, ...request().groups!.slice(1)],
    }, "does not accept"],
    ["an unknown option", {
      groups: [{ groupId: "layout", selectedOptionIds: ["modal"] }, ...request().groups!.slice(1)],
    }, "unknown options"],
    ["an unknown group", { groups: [...request().groups!, { groupId: "ghost", skipped: true }] }, "Unknown groups"],
    ["a skipped group with an answer", {
      groups: [{ groupId: "layout", skipped: true, selectedOptionIds: ["steps"] }, ...request().groups!.slice(1)],
    }, "cannot also contain"],
    ["an objection without text", { assumptions: [{ id: "guest", accepted: false }] }, "Explain your objection"],
    ["an unknown assumption", { assumptions: [{ id: "ghost", accepted: true }] }, "Unknown assumptions"],
    ["a dismissal without a discussion", {
      groups: [{ groupId: "layout", selectedOptionIds: ["steps"], dismissalReason: "No." }, ...request().groups!.slice(1)],
    }, "no discussion to dismiss"],
  ])("rejects %s", (_name, overrides, message) => {
    expect(() => confirmResult(decisionDocument(), 1, request(overrides as Partial<ConfirmRequest>)))
      .toThrow(new RegExp(message));
  });

  it("requires an explicit confirmation flag", () => {
    expect(() => confirmResult(decisionDocument(), 1, { ...request(), confirmed: false } as never))
      .toThrow(InvalidDecisionError);
  });

  it("rejects a confirmation of an outdated version", () => {
    expect(() => confirmResult(decisionDocument(), 2, request())).toThrow(StaleDocumentError);
  });

  it("returns attached images with their field and the file path the agent receives", () => {
    const result = confirmResult(decisionDocument(), 1, request({
      groups: [
        { groupId: "layout", selectedOptionIds: ["steps"], comment: "See the overlap.", attachments: [{ field: "comment", ...screenshot }] },
        { groupId: "notifications", selectedOptionIds: ["email"], attachments: [{ field: "otherText", ...photo }] },
        { groupId: "copy", attachments: [{ field: "text", ...screenshot }, { field: "text", ...photo }] },
      ],
      globalAttachments: [photo],
    }));

    const [layout, notifications, copy] = result.answers.groups;
    expect(layout?.attachments).toEqual([{
      field: "comment",
      path: `/state/checkout-redesign/attachments/${"a".repeat(64)}.png`,
      type: "image/png",
      name: "Screenshot 2026-10-08.png",
    }]);
    expect(notifications).toMatchObject({ status: "answered", otherText: null, attachments: [{ field: "otherText", type: "image/jpeg" }] });
    expect(copy).toMatchObject({ status: "answered", text: null });
    expect(copy?.attachments.map(({ path }) => path)).toEqual([
      `/state/checkout-redesign/attachments/${"a".repeat(64)}.png`,
      `/state/checkout-redesign/attachments/${"b".repeat(64)}.jpg`,
    ]);
    expect(result.answers.globalAttachments).toEqual([
      { path: `/state/checkout-redesign/attachments/${"b".repeat(64)}.jpg`, type: "image/jpeg", name: "phone.jpg" },
    ]);
  });

  it("keeps comment images on a skipped group", () => {
    const result = confirmResult(decisionDocument(), 1, request({
      groups: [
        { groupId: "layout", skipped: true, attachments: [{ field: "comment", ...screenshot }] },
        ...request().groups!.slice(1),
      ],
    }));

    expect(result.answers.groups[0]).toMatchObject({ status: "skipped", attachments: [{ field: "comment" }] });
  });

  const elevenImages = Array.from({ length: 11 }, (_, index) => ({
    field: "comment" as const,
    id: index.toString(16).padStart(64, "0"),
    type: "image/png" as const,
    name: `shot-${index}.png`,
  }));

  it.each([
    ["an answer image on a choice group", {
      groups: [{ groupId: "layout", selectedOptionIds: ["steps"], attachments: [{ field: "text", ...screenshot }] }, ...request().groups!.slice(1)],
    }, "not a text question"],
    ["an Other image where Other is not allowed", {
      groups: [{ groupId: "layout", selectedOptionIds: ["steps"], attachments: [{ field: "otherText", ...screenshot }] }, ...request().groups!.slice(1)],
    }, "does not accept"],
    ["an answer image on a skipped group", {
      groups: [...request().groups!.slice(0, 2), { groupId: "copy", skipped: true, attachments: [{ field: "text", ...screenshot }] }],
    }, "cannot also contain"],
    ["more than ten images in one field", {
      groups: [{ groupId: "layout", selectedOptionIds: ["steps"], attachments: elevenImages }, ...request().groups!.slice(1)],
    }, "more than 10 images"],
    ["the same image twice in one field", {
      groups: [{
        groupId: "layout",
        selectedOptionIds: ["steps"],
        attachments: [{ field: "comment", ...screenshot }, { field: "comment", ...screenshot }],
      }, ...request().groups!.slice(1)],
    }, "same image twice"],
    ["the same image twice in the final comment", { globalAttachments: [photo, photo] }, "attached twice"],
    ["an attachment ID that is not a hash", { globalAttachments: [{ ...photo, id: "../../etc/passwd" }] }, "SHA-256"],
    ["an SVG attachment", { globalAttachments: [{ ...photo, type: "image/svg+xml" }] }, "globalAttachments"],
    ["an attachment name with a line break", { globalAttachments: [{ ...photo, name: "a\nb" }] }, "one line"],
  ])("rejects %s", (_name, overrides, message) => {
    expect(() => confirmResult(decisionDocument(), 1, request(overrides as Partial<ConfirmRequest>)))
      .toThrow(new RegExp(message));
  });
});

describe("discussion request", () => {
  it("accepts images with a message and defaults to none", () => {
    expect(discussionRequestSchema.parse({ items: [{ groupId: "layout", message: "See this." }] }).items[0]?.attachments).toEqual([]);
    expect(discussionRequestSchema.parse({ items: [{ groupId: "layout", message: "See this.", attachments: [screenshot] }] }).items[0]?.attachments)
      .toEqual([screenshot]);
  });

  it("rejects the same image twice in one message", () => {
    expect(discussionRequestSchema.safeParse({ items: [{ groupId: "layout", message: "Two", attachments: [screenshot, screenshot] }] }).success)
      .toBe(false);
  });
});
