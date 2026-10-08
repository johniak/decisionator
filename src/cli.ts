import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import favicon from "../web/favicon.svg" with { type: "text" };
import appHtml from "../web-dist/index.txt" with { type: "text" };
import { InvalidDocumentError, parseDecisionDocument, sessionIdSchema, type DecisionDocument } from "./domain/decision";
import { BunCommandRunner, openBrowser } from "./platform/command";
import { createApp, ConnectionTracker } from "./server/app";
import { AssetStore } from "./server/assets";
import {
  MissingLiveSessionError,
  readLiveState,
  removeLiveState,
  writeLiveState,
  type LiveSessionState,
} from "./server/live-state";
import { DecisionSession } from "./server/session";

const help = `Decisionator — ask a human for a batch of decisions in the browser

Usage:
  decisionator <SESSION_ID> --file <PATH> [--live] [--no-open] [--port <PORT>]
  decisionator wait <SESSION_ID>
  decisionator respond <SESSION_ID> --file <PATH>
  decisionator --version

Commands:
  <SESSION_ID> --file   Validate the decision document and open it in the browser.
                        With --live the session stays open for discussion rounds.
  wait                  Block until the human sends a discussion, confirms, or cancels.
  respond               Send an updated document that answers the pending discussion.

Results are printed to stdout as JSON. Progress and errors are printed to stderr.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      file: { type: "string" },
      live: { type: "boolean", default: false },
      "no-open": { type: "boolean", default: false },
      port: { type: "string" },
    },
  });

  if (values.help) {
    process.stdout.write(help);
    return;
  }

  if (values.version) {
    process.stdout.write(`Decisionator ${packageJson.version}\n`);
    return;
  }

  if (positionals[0] === "wait") {
    if (positionals.length !== 2) throw new Error(help);
    await waitForLiveRequest(parseSessionId(positionals[1]));
    return;
  }

  if (positionals[0] === "respond") {
    if (positionals.length !== 2 || !values.file) throw new Error(help);
    await respondToLiveRequest(parseSessionId(positionals[1]), values.file);
    return;
  }

  if (positionals.length !== 1 || !values.file) throw new Error(help);
  const sessionId = parseSessionId(positionals[0]);
  const requestedPort = values.port === undefined ? undefined : Number(values.port);
  if (requestedPort !== undefined && (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535)) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  const previous = values.live ? await inspectPreviousLiveSession(sessionId) : undefined;
  const document = await readDocument(values.file, sessionId);
  const assets = new AssetStore();
  const session = new DecisionSession(document, await assets.ingest(document), assets, values.live);
  const token = previous?.token ?? crypto.randomUUID();
  const connections = new ConnectionTracker();
  const app = createApp({ html: appHtml, favicon, token, session, assets, connections });
  const server = serve(app.fetch, requestedPort ?? (previous ? Number(new URL(previous.baseUrl).port) : 0), requestedPort === undefined && previous !== undefined);
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const url = `${baseUrl}/#${token}`;

  let liveState: LiveSessionState | undefined;
  if (values.live) {
    liveState = { sessionId, baseUrl, token, pid: process.pid, startedAt: new Date().toISOString() };
    await writeLiveState(liveState);
  }
  process.stderr.write(`Decisionator is ready at ${url}\n`);
  if (liveState) process.stderr.write(`Live discussion is active for ${sessionId}\n`);

  if (!values["no-open"]) {
    const reconnected = previous !== undefined
      && previous.baseUrl === baseUrl
      && await connections.waitForClient(4_000);
    if (reconnected) process.stderr.write("Reconnected to the open browser tab.\n");
    else await openBrowser(url, new BunCommandRunner());
  }

  const result = await session.waitForResult();
  if (liveState && result.status !== "discussion") await writeLiveState({ ...liveState, result });
  await Bun.sleep(100);
  server.stop(true);
  process.stdout.write(`${JSON.stringify(result.status === "discussion" ? { ...result, document: session.document } : result)}\n`);
}

function serve(fetch: (request: Request) => Response | Promise<Response>, port: number, fallbackToRandomPort: boolean) {
  try {
    return Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, fetch });
  } catch (error) {
    if (!fallbackToRandomPort) throw error;
    return Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch });
  }
}

function parseSessionId(value: string | undefined): string {
  const parsed = sessionIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Session IDs must start with a letter or digit and contain only letters, digits, dots, underscores, or hyphens.");
  }
  return parsed.data;
}

async function readDocument(path: string, sessionId: string): Promise<DecisionDocument> {
  let input: unknown;
  try {
    input = await Bun.file(path).json();
  } catch (error) {
    throw new Error(`Could not read the decision document ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const document = parseDecisionDocument(input);
  if (document.sessionId !== sessionId) {
    throw new InvalidDocumentError(`The decision document belongs to session ${document.sessionId}, not ${sessionId}.`);
  }
  return document;
}

async function waitForLiveRequest(sessionId: string): Promise<void> {
  const state = await readLiveState(sessionId);
  if (state.result) {
    process.stdout.write(`${JSON.stringify(state.result)}\n`);
    await removeLiveState(sessionId);
    return;
  }
  await assertLiveServerReachable(state);
  const result = await waitForAgentRequest(state);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (isFinalResult(result)) await removeLiveState(sessionId);
}

// A human can take longer than Bun's five-minute fetch idle timeout, so the wait disables it,
// and a dropped wait is retried for as long as the session's server is running.
async function waitForAgentRequest(state: LiveSessionState): Promise<unknown> {
  for (;;) {
    try {
      return await liveRequest(state, "/api/agent/wait", { timeout: false }, "wait");
    } catch (error) {
      if (!(error instanceof DroppedConnectionError)) throw error;
      const latest = await readLiveState(state.sessionId).catch(() => state);
      if (latest.result) return latest.result;
      await assertLiveServerReachable(latest);
      await Bun.sleep(250);
    }
  }
}

async function respondToLiveRequest(sessionId: string, file: string): Promise<void> {
  const state = await readLiveState(sessionId);
  if (state.result) {
    throw new Error(`This live Decisionator session has already finished. Run decisionator wait ${sessionId} to read the result.`);
  }
  await assertLiveServerReachable(state);
  const document = await readDocument(file, sessionId);
  const result = await liveRequest(state, "/api/agent/respond", {
    method: "POST",
    body: JSON.stringify(document),
  }, "respond");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

class DroppedConnectionError extends Error {}

async function liveRequest(
  state: LiveSessionState,
  path: string,
  init?: BunFetchRequestInit,
  operation = "request",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, state.baseUrl), {
      ...init,
      headers: {
        authorization: `Bearer ${state.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    const retry = operation === "wait"
      ? `decisionator wait ${state.sessionId}`
      : `the decisionator ${operation} command for ${state.sessionId}`;
    throw new DroppedConnectionError(`The live session was reachable, but the ${operation} connection ended unexpectedly. Retry ${retry}.`);
  }
  const payload = await response.json() as { error?: string };
  if (response.status === 410) {
    throw new Error(`${payload.error ?? "The session is closed."} Run decisionator wait ${state.sessionId} to read the result.`);
  }
  if (!response.ok) throw new Error(payload.error ?? "The live Decisionator request failed.");
  return payload;
}

async function assertLiveServerReachable(state: LiveSessionState): Promise<void> {
  if (await isReachable(state)) return;
  throw new Error(
    `No running Decisionator server was found for ${state.sessionId}. `
    + "Start it again with the same session ID; the open browser tab reconnects automatically.",
  );
}

async function isReachable(state: LiveSessionState): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", state.baseUrl), { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function isFinalResult(result: unknown): boolean {
  return typeof result === "object"
    && result !== null
    && "status" in result
    && (result.status === "confirmed" || result.status === "cancelled");
}

/** Returns a stale state whose port and token can be reused, so an open tab reconnects. */
async function inspectPreviousLiveSession(sessionId: string): Promise<LiveSessionState | undefined> {
  let state: LiveSessionState;
  try {
    state = await readLiveState(sessionId);
  } catch (error) {
    if (error instanceof MissingLiveSessionError) return undefined;
    throw error;
  }
  if (state.result) {
    throw new Error(`A finished live session is waiting for the agent. Run decisionator wait ${sessionId} first.`);
  }
  if (await isReachable(state)) {
    throw new Error(`A live Decisionator session is already open for ${sessionId}. Use decisionator wait and respond.`);
  }
  return state;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
