// @vitest-environment node

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readLiveState, writeLiveState } from "../../src/server/live-state";
import { decisionInput, sessionId } from "../fixtures";

const run = promisify(execFile);
const children = new Set<ChildProcess>();
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
});

async function workspace(document: unknown = decisionInput()) {
  const root = await mkdtemp(join(tmpdir(), "decisionator-e2e-"));
  const file = join(root, "decisions.json");
  await writeFile(file, JSON.stringify(document));
  const fakeBin = join(root, "bin");
  await mkdir(fakeBin);
  const openLog = join(root, "opened.log");
  for (const command of ["open", "xdg-open"]) {
    await writeFile(join(fakeBin, command), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${openLog}"\n`);
    await chmod(join(fakeBin, command), 0o755);
  }
  const { BROWSER: _browser, ...inherited } = process.env;
  const env: NodeJS.ProcessEnv = {
    ...inherited,
    DECISIONATOR_STATE_DIR: join(root, "state"),
    PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
  };
  return {
    root,
    file,
    env,
    opened: async () => readFile(openLog, "utf8").catch(() => ""),
    cli: (args: string[]) => run("bun", ["src/cli.ts", ...args], { cwd: process.cwd(), env }),
  };
}

function start(env: NodeJS.ProcessEnv, args: string[]) {
  const child = spawn("bun", ["src/cli.ts", ...args], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.once("exit", () => children.delete(child));
  let stderr = "";
  let stdout = "";
  child.stdout!.on("data", (chunk) => { stdout += chunk.toString(); });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const ready = new Promise<{ baseUrl: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Decisionator did not start. ${stderr}`)), 15_000);
    child.stderr!.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/(http:\/\/127\.0\.0\.1:\d+)\/#([\w-]+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ baseUrl: match[1]!, token: match[2]! });
      }
    });
    child.once("exit", (code) => {
      if (code !== 0 && !stderr.includes("is ready")) {
        clearTimeout(timer);
        reject(new Error(`Decisionator exited with ${code}: ${stderr}`));
      }
    });
  });
  return { child, ready, exited, stdout: () => stdout, stderr: () => stderr };
}

function api(baseUrl: string, token: string, path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
}

// Forwards to the live server and cuts the first agent waits, like an HTTP idle timeout does.
// Bun's fetch silently retries one reset on a reused connection, so two waits are cut.
async function dropFirstWaits(targetPort: number, count = 2) {
  let markDropped!: () => void;
  const dropped = new Promise<void>((resolve) => { markDropped = resolve; });
  let seen = 0;
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(targetPort, "127.0.0.1");
    sockets.add(client).add(upstream);
    client.on("data", (chunk) => {
      if (seen < count && chunk.toString().startsWith("GET /api/agent/wait")) {
        seen += 1;
        const last = seen === count;
        setTimeout(() => {
          client.destroy();
          upstream.destroy();
          if (last) markDropped();
        }, 300);
      }
    });
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    dropped,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>, event: string) {
  const decoder = new TextDecoder();
  let content = "";
  while (!content.includes(`event: ${event}`)) {
    const next = await reader.read();
    if (next.done) throw new Error(`The event stream ended before ${event}.`);
    content += decoder.decode(next.value, { stream: true });
  }
  return content;
}

const confirmation = (documentVersion: number) => ({
  confirmed: true,
  documentVersion,
  groups: [
    { groupId: "layout", selectedOptionIds: ["steps"], comment: "Short address step" },
    { groupId: "notifications", skipped: true },
    { groupId: "copy", text: "Thank you" },
  ],
  assumptions: [{ id: "guest", accepted: false, objection: "Accounts for subscriptions" }],
  globalComment: "Ship it",
});

describe("Decisionator CLI", () => {
  it("prints its version and usage", async () => {
    const { cli } = await workspace();
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { version: string };

    expect((await cli(["--version"])).stdout).toBe(`Decisionator ${packageJson.version}\n`);
    const help = (await cli(["--help"])).stdout;
    expect(help).toContain("decisionator <SESSION_ID> --file <PATH> [--live] [--no-open] [--port <PORT>]");
    expect(help).toContain("decisionator wait <SESSION_ID>");
    expect(help).toContain("decisionator respond <SESSION_ID> --file <PATH>");
  });

  it("rejects invalid documents and arguments with readable errors", async () => {
    const { cli, file, root } = await workspace({ ...decisionInput(), groups: [] });

    await expect(cli([sessionId, "--file", file, "--no-open"])).rejects.toMatchObject({ stderr: expect.stringContaining("groups") });
    const other = join(root, "other.json");
    await writeFile(other, JSON.stringify({ ...decisionInput(), sessionId: "another" }));
    await expect(cli([sessionId, "--file", other, "--no-open"]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("belongs to session another") });
    await expect(cli(["../escape", "--file", other])).rejects.toMatchObject({ stderr: expect.stringContaining("Session IDs") });
    await expect(cli([sessionId, "--file", join(root, "missing.json")]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("Could not read the decision document") });
    await expect(cli([sessionId])).rejects.toMatchObject({ stderr: expect.stringContaining("Usage:") });
    await expect(cli([sessionId, "--file", other, "--port", "99999"])).rejects.toMatchObject({ stderr: expect.stringContaining("--port") });
    await expect(cli(["wait", sessionId])).rejects.toMatchObject({ stderr: expect.stringContaining("No live Decisionator session") });
  });

  it("returns a confirmed batch from a single non-live run and opens the browser once", async () => {
    const { env, file, opened } = await workspace();
    const process = start(env, [sessionId, "--file", file]);
    const { baseUrl, token } = await process.ready;

    expect((await fetch(`${baseUrl}/api/session`)).status).toBe(401);
    const response = await api(baseUrl, token, "/api/confirm", { method: "POST", body: JSON.stringify(confirmation(1)) });
    expect(response.status).toBe(200);
    expect(await process.exited).toBe(0);
    expect(JSON.parse(process.stdout())).toMatchObject({
      status: "confirmed",
      answers: { groups: [{ groupId: "layout", comment: "Short address step" }, { status: "skipped" }, { text: "Thank you" }] },
    });
    expect(await opened()).toBe(`${baseUrl}/#${token}\n`);
  }, 30_000);

  it("runs the live discussion protocol until the human confirms", async () => {
    const { env, file, root, cli } = await workspace();
    const live = start(env, [sessionId, "--file", file, "--live", "--no-open"]);
    const { baseUrl, token } = await live.ready;

    await expect(cli([sessionId, "--file", file, "--live", "--no-open"]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("already open") });
    const events = await fetch(`${baseUrl}/api/events?token=${token}`);
    const reader = events.body!.getReader();
    await readEvent(reader, "ready");

    const firstWait = cli(["wait", sessionId]);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const sent = await api(baseUrl, token, "/api/discussion", {
      method: "POST",
      body: JSON.stringify({ items: [{ groupId: "layout", message: "Why not one page?" }] }),
    });
    expect(sent.status).toBe(200);
    await readEvent(reader, "session");

    const request = JSON.parse((await firstWait).stdout);
    expect(request).toMatchObject({ status: "discussion", groupIds: ["layout"], messages: [{ body: "Why not one page?" }] });
    expect(JSON.stringify(request)).not.toContain("selectedOptionIds");
    expect(JSON.parse((await cli(["wait", sessionId])).stdout)).toEqual(request);

    const invalid = join(root, "invalid.json");
    await writeFile(invalid, JSON.stringify(request.document));
    await expect(cli(["respond", sessionId, "--file", invalid]))
      .rejects.toMatchObject({ stderr: expect.stringContaining("ends with a user message") });

    const updated = structuredClone(request.document);
    updated.groups[0].thread.messages.push({ id: "layout-a1", author: "agent", body: "One page keeps the long scroll on phones." });
    updated.groups[0].options[1].description = "Three short steps with a progress bar.";
    const reply = join(root, "reply.json");
    await writeFile(reply, JSON.stringify(updated));
    expect(JSON.parse((await cli(["respond", sessionId, "--file", reply])).stdout))
      .toEqual({ status: "accepted", documentVersion: 2, revisedGroupIds: ["layout"] });
    await readEvent(reader, "session");
    const snapshot = await (await api(baseUrl, token, "/api/session")).json();
    expect(snapshot.document.groups[0].thread.messages).toHaveLength(2);
    expect(snapshot.revisions).toHaveLength(2);

    const finalWait = cli(["wait", sessionId]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect((await api(baseUrl, token, "/api/confirm", { method: "POST", body: JSON.stringify(confirmation(2)) })).status).toBe(200);
    const result = JSON.parse((await finalWait).stdout);
    expect(result).toMatchObject({
      status: "confirmed",
      documentVersion: 2,
      answers: {
        groups: [
          { groupId: "layout", selectedOptionIds: ["steps"], thread: { messages: [{ author: "user" }, { author: "agent" }] } },
          { groupId: "notifications", status: "skipped", skippedUsingRecommendation: false },
          { groupId: "copy", text: "Thank you" },
        ],
        assumptions: [{ id: "currency", accepted: true }, { id: "guest", accepted: false, objection: "Accounts for subscriptions" }],
        globalComment: "Ship it",
      },
    });
    expect(await live.exited).toBe(0);
    expect(await readdir(join(root, "state"))).toEqual([]);
    await expect(cli(["respond", sessionId, "--file", reply])).rejects.toMatchObject({ stderr: expect.stringContaining("No live Decisionator session") });
  }, 60_000);

  it("keeps waiting when the wait connection drops before the human acts", async () => {
    const { env, file, cli } = await workspace();
    const live = start(env, [sessionId, "--file", file, "--live", "--no-open"]);
    const { baseUrl, token } = await live.ready;
    const proxy = await dropFirstWaits(Number(new URL(baseUrl).port));
    const state = await readLiveState(sessionId, env);
    await writeLiveState({ ...state, baseUrl: `http://127.0.0.1:${proxy.port}` }, env);

    const waiting = cli(["wait", sessionId]);
    await proxy.dropped;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await api(baseUrl, token, "/api/discussion", {
      method: "POST",
      body: JSON.stringify({ items: [{ groupId: "layout", message: "Still there?" }] }),
    });

    expect(JSON.parse((await waiting).stdout)).toMatchObject({ status: "discussion", groupIds: ["layout"] });
    proxy.close();
  }, 30_000);

  it("keeps the final result for an agent that waits after the session closed", async () => {
    const { env, file, cli, root } = await workspace();
    const live = start(env, [sessionId, "--file", file, "--live", "--no-open"]);
    const { baseUrl, token } = await live.ready;

    expect((await api(baseUrl, token, "/api/cancel", { method: "POST", body: "{}" })).status).toBe(200);
    expect(await live.exited).toBe(0);
    await expect(cli(["respond", sessionId, "--file", file])).rejects.toMatchObject({ stderr: expect.stringContaining("Run decisionator wait") });
    await expect(cli([sessionId, "--file", file, "--live", "--no-open"])).rejects.toMatchObject({ stderr: expect.stringContaining("Run decisionator wait") });
    expect(JSON.parse((await cli(["wait", sessionId])).stdout)).toEqual({ status: "cancelled", sessionId });
    expect(await readdir(join(root, "state"))).toEqual([]);
  }, 30_000);

  it("restarts a crashed live session on the same address so the open tab reconnects", async () => {
    const { env, file, opened } = await workspace();
    const first = start(env, [sessionId, "--file", file, "--live"]);
    const { baseUrl, token } = await first.ready;
    await expect.poll(opened, { timeout: 10_000 }).toBe(`${baseUrl}/#${token}\n`);
    first.child.kill("SIGKILL");
    await first.exited;

    let reconnecting = true;
    const tab = (async () => {
      while (reconnecting) {
        try {
          const events = await fetch(`${baseUrl}/api/events?token=${token}`);
          if (events.ok) return events.body!.getReader();
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      return undefined;
    })();

    const second = start(env, [sessionId, "--file", file, "--live"]);
    expect(await second.ready).toEqual({ baseUrl, token });
    const reader = await tab;
    reconnecting = false;
    await readEvent(reader!, "ready");
    await expect.poll(() => second.stderr(), { timeout: 10_000 }).toContain("Reconnected to the open browser tab.");
    expect(await opened()).toBe(`${baseUrl}/#${token}\n`);
  }, 60_000);

  it("opens a new tab when the restarted session finds no open tab", async () => {
    const { env, file, opened } = await workspace();
    const first = start(env, [sessionId, "--file", file, "--live", "--no-open"]);
    const { baseUrl, token } = await first.ready;
    first.child.kill("SIGKILL");
    await first.exited;

    const second = start(env, [sessionId, "--file", file, "--live"]);
    expect(await second.ready).toEqual({ baseUrl, token });
    await expect.poll(opened, { timeout: 10_000 }).toBe(`${baseUrl}/#${token}\n`);
  }, 60_000);

  it("opens the browser named by the BROWSER variable", async () => {
    const { env, file, root } = await workspace();
    const log = join(root, "browser.log");
    const browser = join(root, "my-browser");
    await writeFile(browser, `#!/bin/sh\nprintf '%s\\n' "$1" > "${log}"\n`);
    await chmod(browser, 0o755);
    const process = start({ ...env, BROWSER: browser }, [sessionId, "--file", file]);
    const { baseUrl, token } = await process.ready;

    await expect.poll(() => readFile(log, "utf8").catch(() => ""), { timeout: 10_000 }).toBe(`${baseUrl}/#${token}\n`);
  }, 30_000);

  it("serves screenshots listed in the document and nothing else", async () => {
    const root = await mkdtemp(join(tmpdir(), "decisionator-e2e-images-"));
    const image = join(root, "screen.png");
    await writeFile(image, png);
    const input = decisionInput();
    input.groups[0]!.mockup = { kind: "image", path: image, alt: "Current checkout" } as never;
    const { env, file } = await workspace(input);
    const process = start(env, [sessionId, "--file", file, "--no-open"]);
    const { baseUrl, token } = await process.ready;

    const snapshot = await (await api(baseUrl, token, "/api/session")).json();
    const id = snapshot.revisions[0].assets[image];
    const served = await fetch(`${baseUrl}/api/assets/${id}?token=${token}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png);
    expect((await fetch(`${baseUrl}/api/assets/${encodeURIComponent(file)}?token=${token}`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/assets/${id}`)).status).toBe(401);
  }, 30_000);

  it("refuses to start when a listed image is not an image", async () => {
    const root = await mkdtemp(join(tmpdir(), "decisionator-e2e-images-"));
    const secret = join(root, "id_rsa");
    await writeFile(secret, "-----BEGIN OPENSSH PRIVATE KEY-----");
    const input = decisionInput();
    input.groups[0]!.mockup = { kind: "image", path: secret, alt: "Not an image" } as never;
    const { cli, file } = await workspace(input);

    await expect(cli([sessionId, "--file", file, "--no-open"])).rejects.toMatchObject({ stderr: expect.stringContaining("Unsupported image format") });
  });
});
