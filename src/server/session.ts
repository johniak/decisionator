import { z } from "zod";
import {
  parseDecisionDocument,
  validateAgentDocument,
  InvalidDocumentError,
  type DecisionDocument,
  type DecisionGroup,
  type VersionReference,
} from "../domain/decision";
import {
  buildConfirmedResult,
  discussionRequestSchema,
  type CancelledResult,
  type ConfirmRequest,
  type ConfirmedResult,
} from "../domain/protocol";
import type { AssetStore } from "./assets";

export type DiscussionResult = {
  status: "discussion";
  sessionId: string;
  documentVersion: number;
  groupIds: string[];
  messages: { groupId: string; messageId: string; body: string }[];
};

export type SessionResult = DiscussionResult | ConfirmedResult | CancelledResult;
export type FinalResult = ConfirmedResult | CancelledResult;
export type AgentWaitResult = (DiscussionResult & { document: DecisionDocument }) | FinalResult;

export type DocumentRevision = VersionReference & {
  answeredGroupIds: string[];
  changes: Record<string, string[]>;
  documentChanges: string[];
  document: DecisionDocument;
  assets: Record<string, string>;
};

export class ClosedSessionError extends Error {}
export class AgentBusyError extends Error {}
export class InvalidRequestError extends Error {}

const groupFields = ["title", "context", "mode", "options", "recommendation", "allowOther", "mockup"] as const;
const documentFields = ["title", "intro", "assumptions"] as const;

export class DecisionSession {
  private state: "open" | "closed" = "open";
  private readonly revisions: DocumentRevision[] = [];
  private readonly resultPromise: Promise<SessionResult>;
  private resolveResult!: (result: SessionResult) => void;
  private finalResult?: SessionResult;
  private pendingAgentRequests: DiscussionResult[] = [];
  private activeAgentRequest?: DiscussionResult;
  private agentWaiters: ((result: AgentWaitResult) => void)[] = [];
  private changeVersion = 0;
  private changeWaiters: ((version: number | null) => void)[] = [];
  private current: DecisionDocument;

  constructor(
    document: DecisionDocument,
    assets: Record<string, string>,
    private readonly assetStore: AssetStore,
    readonly live = false,
    private readonly now: () => Date = () => new Date(),
  ) {
    validateAgentDocument(document);
    const { versions: _versions, ...initial } = document;
    this.current = initial;
    this.recordRevision(initial, assets, "initial", []);
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
  }

  get sessionId(): string {
    return this.current.sessionId;
  }

  get document(): DecisionDocument {
    return { ...this.current, versions: this.revisions.map(toReference) };
  }

  get documentVersion(): number {
    return this.revisions.length;
  }

  get version(): number {
    return this.changeVersion;
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      live: this.live,
      version: this.version,
      documentVersion: this.documentVersion,
      document: this.document,
      revisions: this.revisions,
      agentPending: Boolean(this.activeAgentRequest || this.pendingAgentRequests.length),
      pendingGroupIds: [this.activeAgentRequest, ...this.pendingAgentRequests]
        .flatMap((request) => request?.groupIds ?? []),
      result: this.finalResult && this.finalResult.status !== "discussion" ? this.finalResult : null,
    };
  }

  requestDiscussion(input: unknown): DiscussionResult {
    this.assertOpen();
    if (this.live && (this.activeAgentRequest || this.pendingAgentRequests.length > 0)) {
      throw new AgentBusyError("The AI agent is still answering the previous discussion.");
    }
    const parsed = discussionRequestSchema.safeParse(input);
    if (!parsed.success) throw new InvalidRequestError(z.prettifyError(parsed.error));
    const groups = new Map(this.current.groups.map((group) => [group.id, group]));
    for (const { groupId } of parsed.data.items) {
      const group = groups.get(groupId);
      if (!group) throw new InvalidRequestError(`Unknown group: ${groupId}`);
      if (group.thread.messages.at(-1)?.author === "user") {
        throw new InvalidRequestError(`The discussion in group ${groupId} is already waiting for the AI agent.`);
      }
    }
    const messages = parsed.data.items.map(({ groupId, message }) => ({
      groupId,
      messageId: `u-${crypto.randomUUID()}`,
      body: message,
    }));
    const added = new Map(messages.map((message) => [message.groupId, message]));
    this.current = {
      ...this.current,
      groups: this.current.groups.map((group) => {
        const message = added.get(group.id);
        if (!message) return group;
        return {
          ...group,
          thread: {
            ...group.thread,
            messages: [...group.thread.messages, { id: message.messageId, author: "user", body: message.body }],
          },
        };
      }),
    };
    const request: DiscussionResult = {
      status: "discussion",
      sessionId: this.sessionId,
      documentVersion: this.documentVersion,
      groupIds: messages.map(({ groupId }) => groupId),
      messages,
    };
    if (!this.live) {
      this.complete(request);
      return request;
    }
    this.pendingAgentRequests.push(request);
    this.releaseAgentWaiter();
    this.notifyChanged();
    return request;
  }

  waitForAgentRequest(): Promise<AgentWaitResult> {
    if (this.state === "closed") return this.resultPromise.then((result) => this.agentResult(result));
    if (this.activeAgentRequest) return Promise.resolve(this.agentResult(this.activeAgentRequest));
    const next = this.pendingAgentRequests.shift();
    if (next) {
      this.activeAgentRequest = next;
      return Promise.resolve(this.agentResult(next));
    }
    return new Promise((resolve) => this.agentWaiters.push(resolve));
  }

  async respond(input: unknown): Promise<{ status: "accepted"; documentVersion: number; revisedGroupIds: string[] }> {
    this.assertOpen();
    if (!this.live) throw new InvalidRequestError("Agent responses require a live Decisionator session.");
    const request = this.activeAgentRequest;
    if (!request) throw new InvalidRequestError("There is no discussion waiting for an agent response.");
    const next = parseDecisionDocument(input);
    this.validateAgentResponse(next, request);
    const assets = await this.assetStore.ingest(next);
    this.assertOpen();
    if (this.activeAgentRequest !== request) {
      throw new InvalidRequestError("This discussion was already answered.");
    }
    const { versions: _versions, ...document } = next;
    const revision = this.recordRevision(document, assets, "discussion", request.groupIds);
    this.current = document;
    this.activeAgentRequest = undefined;
    this.notifyChanged();
    this.releaseAgentWaiter();
    return { status: "accepted", documentVersion: revision.number, revisedGroupIds: revision.revisedGroupIds };
  }

  waitForChange(afterVersion: number): Promise<number | null> {
    if (this.changeVersion > afterVersion) return Promise.resolve(this.changeVersion);
    if (this.state === "closed") return Promise.resolve(null);
    return new Promise((resolve) => this.changeWaiters.push(resolve));
  }

  confirm(input: unknown): ConfirmedResult {
    this.assertOpen();
    const result = buildConfirmedResult(this.current, this.documentVersion, input as ConfirmRequest);
    this.complete(result);
    return result;
  }

  cancel(): CancelledResult {
    this.assertOpen();
    const result: CancelledResult = { status: "cancelled", sessionId: this.sessionId };
    this.complete(result);
    return result;
  }

  assetIdForPath(version: number, path: string): string | undefined {
    return this.revisions[version - 1]?.assets[path];
  }

  waitForResult(): Promise<SessionResult> {
    return this.resultPromise;
  }

  private assertOpen(): void {
    if (this.state !== "open") throw new ClosedSessionError("This Decisionator session is no longer open.");
  }

  private complete(result: SessionResult): void {
    this.state = "closed";
    this.finalResult = result;
    this.resolveResult(result);
    const agentResult = this.agentResult(result);
    for (const resolve of this.agentWaiters.splice(0)) resolve(agentResult);
    this.notifyChanged();
    for (const resolve of this.changeWaiters.splice(0)) resolve(null);
  }

  private recordRevision(
    document: DecisionDocument,
    assets: Record<string, string>,
    reason: DocumentRevision["reason"],
    answeredGroupIds: string[],
  ): DocumentRevision {
    const previous = this.revisions.at(-1)?.document;
    const changes: Record<string, string[]> = {};
    if (previous) {
      const before = new Map(previous.groups.map((group) => [group.id, group]));
      for (const group of document.groups) {
        const old = before.get(group.id);
        const changed = old ? changedGroupFields(old, group) : ["added"];
        if (changed.length > 0) changes[group.id] = changed;
      }
    }
    const { versions: _versions, ...stored } = document;
    const revision: DocumentRevision = {
      number: this.revisions.length + 1,
      createdAt: this.now().toISOString(),
      reason,
      revisedGroupIds: Object.keys(changes),
      answeredGroupIds,
      changes,
      documentChanges: previous
        ? documentFields.filter((field) => stableStringify(previous[field]) !== stableStringify(document[field]))
        : [],
      document: stored,
      assets,
    };
    this.revisions.push(revision);
    return revision;
  }

  private validateAgentResponse(next: DecisionDocument, request: DiscussionResult): void {
    if (next.sessionId !== this.sessionId) {
      throw new InvalidDocumentError("The agent response belongs to a different Decisionator session.");
    }
    if (next.language !== this.current.language) {
      throw new InvalidDocumentError("The agent cannot change the decision language during a live session.");
    }
    validateAgentDocument(next);
    const requested = new Set(request.groupIds);
    const nextGroups = new Map(next.groups.map((group) => [group.id, group]));
    for (const current of this.current.groups) {
      const updated = nextGroups.get(current.id);
      if (!updated) {
        if (current.thread.messages.length > 0) {
          throw new InvalidDocumentError(`The agent cannot remove group ${current.id} because it has a discussion.`);
        }
        continue;
      }
      const history = current.thread.messages;
      for (const [index, message] of history.entries()) {
        if (stableStringify(updated.thread.messages[index]) !== stableStringify(message)) {
          throw new InvalidDocumentError(`The agent cannot edit or drop discussion messages in group ${current.id}.`);
        }
      }
      const additions = updated.thread.messages.slice(history.length);
      if (requested.has(current.id)) {
        if (additions.length !== 1 || additions[0]?.author !== "agent") {
          throw new InvalidDocumentError(`The agent must add exactly one reply to the discussion in group ${current.id}.`);
        }
      } else if (additions.length > 0) {
        throw new InvalidDocumentError(`The discussion in group ${current.id} is not waiting for an agent reply.`);
      }
    }
    const currentIds = new Set(this.current.groups.map(({ id }) => id));
    for (const group of next.groups) {
      if (!currentIds.has(group.id) && group.thread.messages.length > 0) {
        throw new InvalidDocumentError(`New group ${group.id} cannot start with a discussion.`);
      }
    }
  }

  private releaseAgentWaiter(): void {
    if (this.activeAgentRequest || this.pendingAgentRequests.length === 0 || this.agentWaiters.length === 0) return;
    this.activeAgentRequest = this.pendingAgentRequests.shift();
    const resolve = this.agentWaiters.shift();
    if (resolve && this.activeAgentRequest) resolve(this.agentResult(this.activeAgentRequest));
  }

  private agentResult(result: SessionResult): AgentWaitResult {
    return result.status === "discussion" ? { ...result, document: this.document } : result;
  }

  private notifyChanged(): void {
    this.changeVersion += 1;
    for (const resolve of this.changeWaiters.splice(0)) resolve(this.changeVersion);
  }
}

function toReference(revision: DocumentRevision): VersionReference {
  return {
    number: revision.number,
    createdAt: revision.createdAt,
    reason: revision.reason,
    revisedGroupIds: revision.revisedGroupIds,
  };
}

export function changedGroupFields(before: DecisionGroup, after: DecisionGroup): string[] {
  return groupFields.filter((field) => stableStringify(before[field]) !== stableStringify(after[field]));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  }) ?? "undefined";
}
