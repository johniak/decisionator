import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDecisionDocument, type DecisionDocument } from "../../src/domain/decision";
import { StaleDocumentError } from "../../src/domain/protocol";
import { AssetStore } from "../../src/server/assets";
import { AgentBusyError, ClosedSessionError, DecisionSession, InvalidRequestError } from "../../src/server/session";
import { attachmentStore, decisionDocument, pngBytes } from "../fixtures";

const fixedNow = () => new Date("2026-10-08T10:00:00.000Z");

function liveSession(document = decisionDocument()) {
  return new DecisionSession(document, {}, new AssetStore(), attachmentStore(), true, fixedNow);
}

function confirmation(documentVersion = 1) {
  return {
    confirmed: true,
    documentVersion,
    groups: [
      { groupId: "layout", selectedOptionIds: ["steps"] },
      { groupId: "notifications", skipped: true },
      { groupId: "copy", text: "Thanks" },
    ],
  };
}

function reply(document: DecisionDocument, groupId: string, body: string, change?: (document: DecisionDocument) => void) {
  const next = structuredClone(document);
  const group = next.groups.find(({ id }) => id === groupId)!;
  group.thread.messages.push({ id: `a-${group.thread.messages.length}`, author: "agent", body });
  change?.(next);
  return next;
}

describe("decision session", () => {
  it("starts at version 1 without a pending agent request", () => {
    const session = liveSession();

    expect(session.snapshot()).toMatchObject({
      sessionId: "checkout-redesign",
      live: true,
      documentVersion: 1,
      agentPending: false,
      pendingGroupIds: [],
      result: null,
    });
    expect(session.document.versions).toEqual([
      { number: 1, createdAt: "2026-10-08T10:00:00.000Z", reason: "initial", revisedGroupIds: [] },
    ]);
  });

  it("sends only the requested thread messages to the agent", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why not one page?" }] });

    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");
    expect(request.groupIds).toEqual(["layout"]);
    expect(request.messages).toEqual([{ groupId: "layout", messageId: expect.stringMatching(/^u-/), body: "Why not one page?" }]);
    expect(request.document.groups[0]?.thread.messages).toEqual([
      { id: request.messages[0]!.messageId, author: "user", body: "Why not one page?" },
    ]);
    expect(JSON.stringify(request)).not.toContain("selectedOptionIds");
    expect(session.snapshot()).toMatchObject({ agentPending: true, pendingGroupIds: ["layout"] });
  });

  it("writes the images sent with a discussion and shows them in the thread", async () => {
    const session = liveSession();
    const bytes = pngBytes(7);
    const upload = session.uploadAttachment(bytes);
    session.requestDiscussion({
      items: [{ groupId: "layout", message: "See the overlap.", attachments: [{ id: upload.id, type: "image/png", name: "overlap.png" }] }],
    });

    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");
    const attachment = { path: `${session.snapshot().attachmentDirectory}/${upload.id}.png`, type: "image/png", name: "overlap.png" };
    expect(request.messages[0]?.attachments).toEqual([attachment]);
    expect(request.document.groups[0]?.thread.messages[0]?.attachments).toEqual([attachment]);
    expect(new Uint8Array(readFileSync(attachment.path))).toEqual(bytes);
    expect(session.assetIdForPath(1, attachment.path)).toBe(upload.id);

    await expect(session.respond(reply(request.document, "layout", "The total moves above the button.", (next) => {
      delete next.groups[0]!.thread.messages[0]!.attachments;
    }))).rejects.toThrow("cannot edit or drop discussion messages");
    await session.respond(reply(request.document, "layout", "The total moves above the button."));
    expect(session.assetIdForPath(2, attachment.path)).toBe(upload.id);
  });

  it("leaves the attachments key out of a message without images", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });

    expect(session.document.groups[0]?.thread.messages[0]).not.toHaveProperty("attachments");
  });

  it("refuses a discussion that references an image that was never uploaded", () => {
    const session = liveSession();

    expect(() => session.requestDiscussion({
      items: [{ groupId: "layout", message: "See this.", attachments: [{ id: "e".repeat(64), type: "image/png", name: "lost.png" }] }],
    })).toThrow("lost.png was not uploaded");
    expect(session.document.groups[0]?.thread.messages).toEqual([]);
    expect(session.snapshot().agentPending).toBe(false);
  });

  it("returns the same unanswered request when the agent waits again", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Explain." }] });

    const first = await session.waitForAgentRequest();
    const second = await session.waitForAgentRequest();

    expect(second).toEqual(first);
  });

  it("wakes an agent that is already waiting", async () => {
    const session = liveSession();
    const waiting = session.waitForAgentRequest();
    session.requestDiscussion({ items: [{ groupId: "notifications", message: "Is SMS worth it?" }] });

    await expect(waiting).resolves.toMatchObject({ status: "discussion", groupIds: ["notifications"] });
  });

  it("wakes the agent's latest wait even when an earlier wait was abandoned", async () => {
    const session = liveSession();
    const abandoned = session.waitForAgentRequest();
    const latest = session.waitForAgentRequest();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why steps?" }] });

    await expect(latest).resolves.toMatchObject({ status: "discussion", groupIds: ["layout"] });
    expect(await abandoned).toEqual(await latest);
  });

  it("accepts several prepared threads in one request", async () => {
    const session = liveSession();
    session.requestDiscussion({
      items: [
        { groupId: "layout", message: "Why steps?" },
        { groupId: "copy", message: "Suggest a headline." },
      ],
    });

    await expect(session.waitForAgentRequest()).resolves.toMatchObject({ groupIds: ["layout", "copy"] });
  });

  it("allows one active discussion at a time and rejects invalid requests", () => {
    const session = liveSession();
    expect(() => session.requestDiscussion({ items: [{ groupId: "ghost", message: "Hi" }] })).toThrow("Unknown group");
    expect(() => session.requestDiscussion({ items: [] })).toThrow(InvalidRequestError);
    expect(() => session.requestDiscussion({
      items: [{ groupId: "layout", message: "A" }, { groupId: "layout", message: "B" }],
    })).toThrow("at most one message per group");

    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });
    expect(() => session.requestDiscussion({ items: [{ groupId: "copy", message: "And?" }] })).toThrow(AgentBusyError);
  });

  it("records a revision with the agent reply and revised groups", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Add a wizard option?" }] });
    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");

    const response = await session.respond(reply(request.document, "layout", "Added a modal option.", (next) => {
      next.groups[0]!.options.push({ id: "modal", label: "Modal", description: "Checkout in a dialog." });
      next.intro = "Updated intro.";
    }));

    expect(response).toEqual({ status: "accepted", documentVersion: 2, revisedGroupIds: ["layout"] });
    const snapshot = session.snapshot();
    expect(snapshot.agentPending).toBe(false);
    expect(snapshot.documentVersion).toBe(2);
    expect(snapshot.revisions[1]).toMatchObject({
      number: 2,
      reason: "discussion",
      revisedGroupIds: ["layout"],
      answeredGroupIds: ["layout"],
      changes: { layout: ["options"] },
      documentChanges: ["intro"],
    });
    expect(snapshot.document.groups[0]?.thread.messages.at(-1)).toMatchObject({ author: "agent", body: "Added a modal option." });
    expect(snapshot.revisions[0]?.document.groups[0]?.options).toHaveLength(2);
  });

  it("marks new groups as added", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "copy", message: "Ask about the tone too." }] });
    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");

    await session.respond(reply(request.document, "copy", "Added a tone question.", (next) => {
      next.groups.push({ ...structuredClone(next.groups[2]!), id: "tone", title: "Tone", thread: { messages: [] } });
    }));

    expect(session.snapshot().revisions[1]?.changes).toEqual({ tone: ["added"] });
  });

  it.each([
    ["dropping a user message", (next: DecisionDocument) => { next.groups[0]!.thread.messages = []; }, "cannot edit or drop"],
    ["editing a user message", (next: DecisionDocument) => { next.groups[0]!.thread.messages[0]!.body = "Edited"; }, "cannot edit or drop"],
    ["replying twice", (next: DecisionDocument) => {
      next.groups[0]!.thread.messages.push({ id: "u-fake", author: "user", body: "fake" }, { id: "a-2", author: "agent", body: "again" });
    }, "exactly one reply"],
    ["replying to another group", (next: DecisionDocument) => {
      next.groups[1]!.thread.messages.push({ id: "x", author: "agent", body: "unprompted" });
    }, null],
    ["dismissing the thread", (next: DecisionDocument) => {
      next.groups[0]!.thread.dismissed = true;
      next.groups[0]!.thread.dismissalReason = "Done";
    }, "Only the user can dismiss"],
    ["removing a discussed group", (next: DecisionDocument) => { next.groups.splice(0, 1); }, "cannot remove group layout"],
    ["changing the language", (next: DecisionDocument) => { next.language = "Polish"; }, "cannot change the decision language"],
    ["changing the session", (next: DecisionDocument) => { next.sessionId = "other"; }, "different Decisionator session"],
    ["starting a discussion on a new group", (next: DecisionDocument) => {
      next.groups.push({
        ...structuredClone(next.groups[2]!),
        id: "new",
        thread: { messages: [{ id: "u9", author: "user", body: "fake" }, { id: "a9", author: "agent", body: "reply" }] },
      });
    }, "cannot start with a discussion"],
  ])("rejects an agent response %s", async (_name, change, message) => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });
    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");

    const attempt = session.respond(reply(request.document, "layout", "Because.", change));
    await expect(attempt).rejects.toThrow(message ? new RegExp(message) : /./);
    expect(session.snapshot().agentPending).toBe(true);
  });

  it("requires a pending request before the agent responds", async () => {
    const session = liveSession();
    await expect(session.respond(decisionDocument())).rejects.toThrow("no discussion waiting");
  });

  it("allows the agent to remove a group nobody discussed", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Drop the headline question?" }] });
    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");

    await session.respond(reply(request.document, "layout", "Removed it.", (next) => { next.groups.pop(); }));
    expect(session.document.groups.map(({ id }) => id)).toEqual(["layout", "notifications"]);
  });

  it("confirms the current version and returns the result to a waiting agent", async () => {
    const session = liveSession();
    const waiting = session.waitForAgentRequest();
    const result = session.confirm(confirmation());

    expect(result.status).toBe("confirmed");
    await expect(waiting).resolves.toEqual(result);
    await expect(session.waitForResult()).resolves.toEqual(result);
    await expect(session.waitForAgentRequest()).resolves.toEqual(result);
    expect(session.snapshot().result).toEqual(result);
    expect(() => session.cancel()).toThrow(ClosedSessionError);
  });

  it("writes confirmed images and returns their paths", async () => {
    const session = liveSession();
    const comment = session.uploadAttachment(pngBytes(8));
    const final = session.uploadAttachment(pngBytes(9));

    const result = session.confirm({
      ...confirmation(),
      groups: [
        { groupId: "layout", selectedOptionIds: ["steps"], attachments: [{ field: "comment", id: comment.id, type: "image/png", name: "a.png" }] },
        { groupId: "notifications", skipped: true },
        { groupId: "copy", text: "Thanks" },
      ],
      globalAttachments: [{ id: final.id, type: "image/png", name: "b.png" }],
    });

    const directory = session.snapshot().attachmentDirectory;
    expect(result.answers.groups[0]?.attachments).toEqual([
      { field: "comment", path: `${directory}/${comment.id}.png`, type: "image/png", name: "a.png" },
    ]);
    expect(result.answers.globalAttachments).toEqual([{ path: `${directory}/${final.id}.png`, type: "image/png", name: "b.png" }]);
    expect(existsSync(`${directory}/${comment.id}.png`)).toBe(true);
    expect(existsSync(`${directory}/${final.id}.png`)).toBe(true);
  });

  it("stays open when a confirmed image was never uploaded", () => {
    const session = liveSession();

    expect(() => session.confirm({
      ...confirmation(),
      globalAttachments: [{ id: "d".repeat(64), type: "image/png", name: "gone.png" }],
    })).toThrow("gone.png was not uploaded");
    expect(session.isOpen).toBe(true);
  });

  it("rejects a confirmation made against an older version", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });
    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");
    await session.respond(reply(request.document, "layout", "Because."));

    expect(() => session.confirm(confirmation(1))).toThrow(StaleDocumentError);
    expect(session.confirm(confirmation(2)).documentVersion).toBe(2);
  });

  it("lets the human confirm while the agent is still answering", async () => {
    const session = liveSession();
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });
    const request = await session.waitForAgentRequest();
    if (request.status !== "discussion") throw new Error("Expected a discussion");

    const result = session.confirm(confirmation());
    expect(result.answers.groups[0]?.thread.messages).toHaveLength(1);
    await expect(session.respond(reply(request.document, "layout", "Late."))).rejects.toThrow(ClosedSessionError);
  });

  it("cancels without decisions", async () => {
    const session = liveSession();
    expect(session.cancel()).toEqual({ status: "cancelled", sessionId: "checkout-redesign" });
    await expect(session.waitForAgentRequest()).resolves.toEqual({ status: "cancelled", sessionId: "checkout-redesign" });
  });

  it("ends a non-live session with the discussion and its document", async () => {
    const session = new DecisionSession(decisionDocument(), {}, new AssetStore(), attachmentStore(), false, fixedNow);
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });

    const result = await session.waitForResult();
    expect(result).toMatchObject({ status: "discussion", groupIds: ["layout"] });
    expect(session.isOpen).toBe(false);
    await expect(session.respond(decisionDocument())).rejects.toThrow(ClosedSessionError);
  });

  it("notifies listeners about changes and closing", async () => {
    const session = liveSession();
    const change = session.waitForChange(0);
    session.requestDiscussion({ items: [{ groupId: "layout", message: "Why?" }] });
    await expect(change).resolves.toBe(1);

    const closing = session.waitForChange(1);
    session.cancel();
    await expect(closing).resolves.toBe(2);
    await expect(session.waitForChange(2)).resolves.toBeNull();
  });

  it("rejects an initial document that leaves a user question unanswered", () => {
    const input = structuredClone(decisionDocument());
    input.groups[0]!.thread.messages.push({ id: "u1", author: "user", body: "Waiting" });
    expect(() => liveSession(parseDecisionDocument(input))).toThrow("ends with a user message");
  });
});
