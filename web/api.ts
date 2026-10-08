import type { AttachmentType } from "../src/domain/images";
import type { ConfirmRequest, ConfirmedResult, DiscussionRequest } from "../src/domain/protocol";
import type { SessionSnapshot } from "./types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function sessionToken(): string {
  const token = window.location.hash.slice(1);
  if (!token) throw new Error("This Decisionator link is missing its session token.");
  return token;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `Bearer ${sessionToken()}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) throw new ApiError(payload.error ?? "Decisionator request failed.", response.status);
  return payload;
}

export const api = {
  loadSession: () => request<SessionSnapshot>("/api/session"),
  uploadAttachment: (bytes: ArrayBuffer, type: AttachmentType) => request<{ id: string; type: AttachmentType; size: number }>(
    "/api/attachments",
    { method: "POST", body: bytes, headers: { "content-type": type } },
  ),
  sendDiscussion: (input: DiscussionRequest) => request<{ status: "sent"; session: SessionSnapshot }>("/api/discussion", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  confirm: (input: ConfirmRequest) => request<ConfirmedResult>("/api/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  cancel: () => request<{ status: "cancelled" }>("/api/cancel", { method: "POST", body: "{}" }),
  assetUrl: (id: string) => `/api/assets/${encodeURIComponent(id)}?token=${encodeURIComponent(sessionToken())}`,
  subscribeToSession: (handlers: { onUpdate: () => void; onReady: () => void; onClosed: () => void; onError: () => void }) => {
    const events = new EventSource(`/api/events?token=${encodeURIComponent(sessionToken())}`);
    events.addEventListener("session", handlers.onUpdate);
    events.addEventListener("ready", handlers.onReady);
    events.addEventListener("closed", () => {
      events.close();
      handlers.onClosed();
    });
    events.onerror = handlers.onError;
    return () => events.close();
  },
};
