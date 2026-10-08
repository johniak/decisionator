import { vi } from "vitest";
import type { DecisionDocument } from "../../src/domain/decision";
import { createApp } from "../../src/server/app";
import { AssetStore } from "../../src/server/assets";
import { DecisionSession } from "../../src/server/session";
import { attachmentStore, decisionDocument } from "../fixtures";

export const token = "test-token";

type Listener = (event: MessageEvent) => void;

/**
 * Connects the browser code to the real Decisionator server: `fetch` and server-sent events
 * are routed to the in-process Hono app, so tests exercise the actual HTTP contract.
 */
export async function startHarness(document: DecisionDocument = decisionDocument(), live = true) {
  const assets = new AssetStore();
  const attachments = attachmentStore();
  const session = new DecisionSession(document, await assets.ingest(document), assets, attachments, live);
  const app = createApp({ html: "<html></html>", favicon: "<svg></svg>", token, session, assets });
  const requests: { method: string; path: string; body: unknown }[] = [];

  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const value = input instanceof Request ? input.url : input.toString();
    const url = new URL(value, "http://127.0.0.1");
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    requests.push({ method: init?.method ?? "GET", path: url.pathname, body });
    return app.request(`${url.pathname}${url.search}`, init);
  });

  class AppEventSource {
    onerror: (() => void) | null = null;
    private readonly listeners = new Map<string, Set<Listener>>();
    private reader?: ReadableStreamDefaultReader<Uint8Array>;
    private closed = false;

    constructor(url: string) {
      void this.connect(url);
    }

    addEventListener(type: string, listener: Listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(listener);
    }

    close() {
      this.closed = true;
      void this.reader?.cancel().catch(() => {});
    }

    private async connect(url: string) {
      const response = await app.request(url);
      if (!response.body) return;
      this.reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.closed) {
        const chunk = await this.reader.read().catch(() => ({ done: true, value: undefined }));
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const type = block.match(/^event: (.*)$/m)?.[1] ?? "message";
          const data = block.match(/^data: (.*)$/m)?.[1] ?? "";
          for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data }));
          boundary = buffer.indexOf("\n\n");
        }
      }
    }
  }

  vi.stubGlobal("EventSource", AppEventSource);
  window.location.hash = token;

  return {
    session,
    requests,
    sent: (path: string) => requests.filter((request) => request.path === path),
  };
}

export async function agentReply(
  session: DecisionSession,
  body: string,
  change?: (document: DecisionDocument) => void,
) {
  const request = await session.waitForAgentRequest();
  if (request.status !== "discussion") throw new Error(`Expected a discussion, got ${request.status}`);
  const next = structuredClone(request.document);
  for (const groupId of request.groupIds) {
    const group = next.groups.find(({ id }) => id === groupId)!;
    group.thread.messages.push({ id: `${groupId}-a${group.thread.messages.length}`, author: "agent", body });
  }
  change?.(next);
  return session.respond(next);
}
