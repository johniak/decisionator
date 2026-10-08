import { describe, expect, it } from "vitest";
import { parseDecisionDocument } from "../../src/domain/decision";
import { buildConfirmedResult } from "../../src/domain/protocol";
import {
  chooseOption,
  chooseOther,
  clearDraft,
  draftStorageKey,
  emptyDraft,
  emptyGroupDraft,
  addAttachment,
  hasAnswer,
  groupDraft,
  initialDraft,
  loadDraft,
  preparedDiscussions,
  reconcileDraft,
  saveDraft,
  skipGroup,
  toConfirmRequest,
  unansweredGroups,
  type Draft,
} from "../../web/draft";
import { groupStatus, hasUnreadReply, progressSummary } from "../../web/status";
import { decisionDocument, decisionInput } from "../fixtures";
import type { DraftAttachment } from "../../web/attachments";

function draftWith(groups: Draft["groups"], extra: Partial<Draft> = {}): Draft {
  return { ...emptyDraft, groups, ...extra };
}

describe("draft persistence", () => {
  it("saves, restores, and clears a draft per session", () => {
    const draft = draftWith({ layout: { ...emptyGroupDraft, selectedOptionIds: ["steps"] } }, { globalComment: "Ship it" });
    saveDraft(window.localStorage, "s1", draft);

    expect(loadDraft(window.localStorage, "s1")).toEqual(draft);
    expect(loadDraft(window.localStorage, "s2")).toEqual(emptyDraft);
    clearDraft(window.localStorage, "s1");
    expect(window.localStorage.getItem(draftStorageKey("s1"))).toBeNull();
  });

  it("survives corrupt data and unavailable storage", () => {
    window.localStorage.setItem(draftStorageKey("broken"), "{not json");
    expect(loadDraft(window.localStorage, "broken")).toEqual(emptyDraft);

    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
      removeItem: () => { throw new Error("blocked"); },
    } as unknown as Storage;
    expect(loadDraft(blocked, "s1")).toEqual(emptyDraft);
    expect(() => saveDraft(blocked, "s1", emptyDraft)).not.toThrow();
    expect(() => clearDraft(blocked, "s1")).not.toThrow();
  });

  it("treats agent replies in the first document as already read", () => {
    const input = decisionInput();
    input.groups[0]!.thread = { messages: [{ id: "u1", author: "user", body: "Q" }, { id: "a1", author: "agent", body: "A" }] };
    const document = parseDecisionDocument(input);

    expect(initialDraft(document).seenMessageIds).toEqual(["a1"]);
    expect(loadDraft(window.localStorage, "fresh", document).seenMessageIds).toEqual(["a1"]);
  });
});

describe("draft editing", () => {
  const document = decisionDocument();
  const [layout, notifications, copy] = document.groups;

  it("selects one option in single mode and toggles in multi mode", () => {
    let single = chooseOption(layout!, emptyGroupDraft, "one-page");
    single = chooseOption(layout!, single, "steps");
    expect(single.selectedOptionIds).toEqual(["steps"]);

    let multi = chooseOption(notifications!, emptyGroupDraft, "email");
    multi = chooseOption(notifications!, multi, "sms");
    multi = chooseOption(notifications!, multi, "email");
    expect(multi.selectedOptionIds).toEqual(["sms"]);
  });

  it("makes Other exclusive in single mode and additive in multi mode", () => {
    const singleOther = chooseOther(layout!, { ...emptyGroupDraft, selectedOptionIds: ["steps"] });
    expect(singleOther).toMatchObject({ selectedOptionIds: [], otherSelected: true });

    const multiOther = chooseOther(notifications!, { ...emptyGroupDraft, selectedOptionIds: ["email"] });
    expect(multiOther).toMatchObject({ selectedOptionIds: ["email"], otherSelected: true });
  });

  it("clears answers when skipping and un-skips when choosing again", () => {
    const skipped = skipGroup({ ...emptyGroupDraft, selectedOptionIds: ["steps"], comment: "keep" });
    expect(skipped).toMatchObject({ skipped: true, selectedOptionIds: [], comment: "keep" });
    expect(chooseOption(layout!, skipped, "steps").skipped).toBe(false);
  });

  it("lists unanswered groups and prepared discussions", () => {
    const draft = draftWith({
      layout: { ...emptyGroupDraft, selectedOptionIds: ["steps"], message: "  Why?  " },
      notifications: { ...emptyGroupDraft, skipped: true, message: "   " },
      copy: { ...emptyGroupDraft, message: "Ideas", dismissing: true },
    });

    expect(unansweredGroups(document, draft).map(({ id }) => id)).toEqual(["copy"]);
    expect(preparedDiscussions(document, draft)).toEqual([{ groupId: "layout", message: "Why?", attachments: [] }]);
    expect(groupDraft(draft, "missing")).toEqual(emptyGroupDraft);
    expect(copy!.mode).toBe("text");
  });

  it("builds a confirmation request that the shared result builder accepts", () => {
    const draft = draftWith({
      layout: { ...emptyGroupDraft, otherSelected: true, otherText: "ignored without allowOther", selectedOptionIds: ["steps"], comment: " Short " },
      notifications: { ...emptyGroupDraft, selectedOptionIds: ["email"], otherSelected: true, otherText: " Slack " },
      copy: { ...emptyGroupDraft, text: " Thanks " },
    }, { assumptions: { guest: { objecting: true, objection: " No guests " } }, globalComment: " Done " });

    const request = toConfirmRequest(document, 1, draft);
    expect(request).toEqual({
      confirmed: true,
      documentVersion: 1,
      groups: [
        { groupId: "layout", selectedOptionIds: ["steps"], otherText: "", comment: "Short", dismissalReason: "" },
        { groupId: "notifications", selectedOptionIds: ["email"], otherText: "Slack", comment: "", dismissalReason: "" },
        { groupId: "copy", text: "Thanks", comment: "", dismissalReason: "" },
      ],
      assumptions: [{ id: "currency", accepted: true }, { id: "guest", accepted: false, objection: "No guests" }],
      globalComment: "Done",
    });
    expect(buildConfirmedResult(document, 1, request, () => "/unused").answers.groups.map(({ status }) => status))
      .toEqual(["answered", "answered", "answered"]);
  });

  it("keeps valid choices after a revision and reports removed ones by label", () => {
    const revised = parseDecisionDocument({
      ...decisionInput(),
      groups: decisionInput().groups.map((group) => group.id === "layout"
        ? { ...group, options: group.options!.filter(({ id }) => id !== "one-page").concat({ id: "wizard", label: "Wizard", description: "New" }) }
        : group.id === "notifications" ? { ...group, allowOther: false } : group),
    });
    const draft = draftWith({
      layout: { ...emptyGroupDraft, selectedOptionIds: ["one-page"], comment: "kept" },
      notifications: { ...emptyGroupDraft, selectedOptionIds: ["email"], otherSelected: true, otherText: "Slack" },
      gone: { ...emptyGroupDraft, selectedOptionIds: ["x"] },
    }, { assumptions: { guest: { objecting: true, objection: "x" }, removed: { objecting: true, objection: "y" } } });

    const { draft: reconciled, removed } = reconcileDraft(draft, revised, { layout: { "one-page": "One page" } });

    expect(removed).toEqual([{ groupId: "layout", label: "One page" }]);
    expect(reconciled.groups.layout).toMatchObject({ selectedOptionIds: [], comment: "kept" });
    expect(reconciled.groups.notifications).toMatchObject({ selectedOptionIds: ["email"], otherSelected: false, otherText: "" });
    expect(reconciled.groups.gone).toBeUndefined();
    expect(Object.keys(reconciled.assumptions)).toEqual(["guest"]);
  });
});

describe("group status", () => {
  const input = decisionInput();
  input.groups[0]!.thread = { messages: [{ id: "u1", author: "user", body: "Q" }, { id: "a1", author: "agent", body: "A" }] };
  input.groups[1]!.thread = { messages: [{ id: "u2", author: "user", body: "Q" }] };
  const document = parseDecisionDocument({ ...input, groups: input.groups });

  it("derives pending, answered, skipped, waiting, and replied states", () => {
    const unread = draftWith({});
    expect(groupStatus(document.groups[0]!, unread)).toBe("agent_replied");
    expect(groupStatus(document.groups[1]!, unread)).toBe("waiting_for_agent");
    expect(groupStatus(document.groups[2]!, unread)).toBe("pending");

    const answered = draftWith({
      layout: { ...emptyGroupDraft, selectedOptionIds: ["steps"] },
      copy: { ...emptyGroupDraft, skipped: true },
    });
    expect(groupStatus(document.groups[0]!, answered)).toBe("answered");
    expect(hasUnreadReply(document.groups[0]!, answered)).toBe(true);
    expect(groupStatus(document.groups[2]!, answered)).toBe("skipped");
    expect(hasUnreadReply(document.groups[0]!, { ...answered, seenMessageIds: ["a1"] })).toBe(false);
  });

  it("summarizes progress for the sidebar", () => {
    const draft = draftWith({
      layout: { ...emptyGroupDraft, selectedOptionIds: ["steps"] },
      copy: { ...emptyGroupDraft, skipped: true },
    });

    expect(progressSummary(document, draft)).toBe("1 of 3 answered, 1 waiting for agent, 1 new reply, 1 skipped");
    expect(progressSummary(decisionDocument(), emptyDraft)).toBe("0 of 3 answered");
  });
});

describe("draft images", () => {
  const shot = (seed: string, name = `${seed}.png`): DraftAttachment => ({ id: seed.repeat(64), type: "image/png", name, size: 13 });

  it("counts an image alone as the answer to a text question or an Other answer", () => {
    const document = decisionDocument();
    const [, notifications, copy] = document.groups;

    expect(hasAnswer(copy!, { ...emptyGroupDraft, attachments: { text: [shot("a")] } })).toBe(true);
    expect(hasAnswer(copy!, { ...emptyGroupDraft, attachments: { comment: [shot("a")] } })).toBe(false);
    expect(hasAnswer(notifications!, { ...emptyGroupDraft, otherSelected: true, attachments: { otherText: [shot("a")] } })).toBe(true);
    expect(hasAnswer(notifications!, { ...emptyGroupDraft, otherSelected: false, attachments: { otherText: [shot("a")] } })).toBe(false);
  });

  it("sends answer images only for the answer that applies, and comment images always", () => {
    const document = decisionDocument();
    const draft = draftWith({
      layout: { ...emptyGroupDraft, skipped: true, attachments: { comment: [shot("a")], text: [shot("b")] } },
      notifications: { ...emptyGroupDraft, selectedOptionIds: ["email"], otherSelected: false, attachments: { otherText: [shot("c")] } },
      copy: { ...emptyGroupDraft, attachments: { text: [shot("d", "copy.png")] } },
    }, { globalAttachments: [shot("e")] });

    const request = toConfirmRequest(document, 1, draft);
    expect(request.groups!.map((group) => group.attachments)).toEqual([
      [{ field: "comment", id: "a".repeat(64), type: "image/png", name: "a.png" }],
      undefined,
      [{ field: "text", id: "d".repeat(64), type: "image/png", name: "copy.png" }],
    ]);
    expect(request.globalAttachments).toEqual([{ id: "e".repeat(64), type: "image/png", name: "e.png" }]);
    expect(buildConfirmedResult(document, 1, request, ({ id }) => `/state/${id}.png`).answers.groups[2])
      .toMatchObject({ status: "answered", text: null, attachments: [{ field: "text", path: `/state/${"d".repeat(64)}.png` }] });
  });

  it("drops answer images when skipping or when the question no longer takes them", () => {
    const current = { ...emptyGroupDraft, text: "x", attachments: { text: [shot("a")], comment: [shot("b")] } };
    expect(skipGroup(current).attachments).toEqual({ text: [], otherText: [], comment: [shot("b")] });

    const revised = parseDecisionDocument({
      ...decisionInput(),
      groups: decisionInput().groups.map((group) => group.id === "notifications" ? { ...group, allowOther: false } : group),
    });
    const draft = draftWith({ notifications: { ...emptyGroupDraft, otherSelected: true, attachments: { otherText: [shot("c")], comment: [shot("d")] } } });
    expect(reconcileDraft(draft, revised).draft.groups.notifications?.attachments).toMatchObject({ otherText: [], comment: [shot("d")] });
  });

  it("ignores a duplicate image and anything beyond ten per field", () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ ...shot("f"), id: index.toString(16).padStart(64, "0") }));
    expect(addAttachment([shot("a")], shot("a"))).toEqual([shot("a")]);
    expect(addAttachment(ten, shot("b"))).toBe(ten);
  });

  it("restores an older draft without images", () => {
    window.localStorage.setItem("decisionator:draft:old", JSON.stringify({ groups: { layout: { selectedOptionIds: ["steps"] } } }));
    const draft = loadDraft(window.localStorage, "old");
    expect(draft.globalAttachments).toEqual([]);
    expect(draft.groups.layout?.attachments).toEqual({});
  });
});
