import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { ZodError } from "zod";
import { InvalidDocumentError } from "../domain/decision";
import { InvalidDecisionError, StaleDocumentError } from "../domain/protocol";
import type { AssetStore } from "./assets";
import {
  AgentBusyError,
  ClosedSessionError,
  InvalidRequestError,
  type DecisionSession,
} from "./session";

type AppDependencies = {
  html: string;
  favicon: string;
  token: string;
  session: DecisionSession;
  assets: AssetStore;
  connections?: ConnectionTracker;
};

/** Counts open browser tabs so a restarted server can reuse a tab instead of opening another one. */
export class ConnectionTracker {
  private count = 0;
  private waiters: (() => void)[] = [];

  get connected(): number {
    return this.count;
  }

  open(): void {
    this.count += 1;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  close(): void {
    this.count = Math.max(0, this.count - 1);
  }

  waitForClient(timeoutMs: number): Promise<boolean> {
    if (this.count > 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.count > 0), timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function contentSecurityPolicy(html: string): string {
  const scriptHashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => `'sha256-${createHash("sha256").update(match[1] ?? "").digest("base64")}'`);
  return [
    "default-src 'none'",
    `script-src ${scriptHashes.join(" ") || "'none'"} 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src data:",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function createApp({
  html,
  favicon,
  token,
  session,
  assets,
  connections = new ConnectionTracker(),
}: AppDependencies): Hono {
  const app = new Hono();
  const policy = contentSecurityPolicy(html);

  app.use("*", async (context, next) => {
    const host = new URL(context.req.url).hostname;
    if (!loopbackHosts.has(host) && !loopbackHosts.has(`[${host}]`)) {
      return context.json({ error: "Decisionator only accepts loopback requests." }, 421);
    }
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Cross-Origin-Opener-Policy", "same-origin");
    context.header("Cross-Origin-Resource-Policy", "same-origin");
  });

  app.get("/", (context) => {
    context.header("Content-Security-Policy", policy);
    context.header("Cache-Control", "no-store");
    return context.html(html);
  });
  app.get("/favicon.svg", (context) => context.body(favicon, 200, { "content-type": "image/svg+xml" }));
  app.get("/health", (context) => context.json({ status: "ok" }));

  app.get("/api/events", (context) => {
    if (context.req.query("token") !== token) return context.json({ error: "Unauthorized" }, 401);
    return streamSSE(context, async (stream) => {
      connections.open();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        connections.close();
      };
      stream.onAbort(release);
      let version = session.version;
      await stream.writeSSE({ event: "ready", data: String(version), retry: 1_000 });
      while (true) {
        const nextVersion = await session.waitForChange(version);
        if (nextVersion === null) break;
        version = nextVersion;
        await stream.writeSSE({ event: "session", data: String(version) });
      }
      await stream.writeSSE({ event: "closed", data: String(session.version) });
      release();
    });
  });

  app.get("/api/assets/:id", (context) => {
    if (context.req.query("token") !== token) return context.json({ error: "Unauthorized" }, 401);
    const asset = assets.get(context.req.param("id"));
    if (!asset) return context.json({ error: "This file is not part of the decision documents." }, 404);
    return context.body(asset.bytes as Uint8Array<ArrayBuffer>, 200, {
      "content-type": asset.contentType,
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  app.use("/api/*", async (context, next) => {
    if (context.req.header("authorization") !== `Bearer ${token}`) {
      return context.json({ error: "Unauthorized" }, 401);
    }
    await next();
    context.header("Cache-Control", "no-store");
  });

  app.get("/api/session", (context) => context.json(session.snapshot()));

  app.post("/api/discussion", async (context) => {
    session.requestDiscussion(await readJson(context));
    return context.json({ status: "sent", session: session.snapshot() });
  });

  app.get("/api/agent/wait", async (context) => context.json(await session.waitForAgentRequest()));

  app.post("/api/agent/respond", async (context) => context.json(await session.respond(await readJson(context))));

  app.post("/api/confirm", async (context) => context.json(session.confirm(await readJson(context))));

  app.post("/api/cancel", (context) => context.json(session.cancel()));

  app.onError((error, context) => {
    if (error instanceof ZodError) {
      return context.json({ error: "Invalid request", details: error.issues }, 400);
    }
    if (
      error instanceof InvalidDocumentError
      || error instanceof InvalidDecisionError
      || error instanceof InvalidRequestError
    ) {
      return context.json({ error: error.message }, 400);
    }
    if (error instanceof AgentBusyError || error instanceof StaleDocumentError) {
      return context.json({ error: error.message }, 409);
    }
    if (error instanceof ClosedSessionError) {
      return context.json({ error: error.message }, 410);
    }
    console.error(error);
    return context.json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  });

  return app;
}

async function readJson(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new InvalidRequestError("Expected a JSON request body.");
  }
}
