import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDecisionDocument } from "../../src/domain/decision";
import { ConnectionTracker, contentSecurityPolicy, createApp } from "../../src/server/app";
import { AssetStore, detectImageType } from "../../src/server/assets";
import { DecisionSession } from "../../src/server/session";
import { decisionInput } from "../fixtures";

const token = "secret-token";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

async function setup(imagePath?: string) {
  const input = decisionInput();
  if (imagePath) input.groups[0]!.mockup = { kind: "image", path: imagePath, alt: "Current checkout" } as never;
  const document = parseDecisionDocument(input);
  const assets = new AssetStore();
  const session = new DecisionSession(document, await assets.ingest(document), assets, true);
  const connections = new ConnectionTracker();
  const app = createApp({
    html: "<html><script type=\"module\">console.log(1)</script></html>",
    favicon: "<svg></svg>",
    token,
    session,
    assets,
    connections,
  });
  const call = (path: string, init?: RequestInit) => app.request(path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
  return { app, session, assets, connections, call };
}

async function temporaryImage(name = "screen.png", bytes: Uint8Array = png) {
  const directory = await mkdtemp(join(tmpdir(), "decisionator-assets-"));
  const path = join(directory, name);
  await writeFile(path, bytes);
  return { directory, path };
}

describe("Decisionator HTTP server", () => {
  it("serves the app with a strict content security policy", async () => {
    const { app } = await setup();
    const response = await app.request("/");
    const policy = response.headers.get("content-security-policy")!;

    expect(response.status).toBe(200);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(policy).not.toContain("script-src 'unsafe-inline'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("hashes every inline script of the bundled page", () => {
    const policy = contentSecurityPolicy("<script>a()</script><script type=\"module\">b()</script>");
    expect(policy.match(/'sha256-/g)).toHaveLength(2);
  });

  it("rejects requests addressed to a non-loopback host", async () => {
    const { app } = await setup();
    const response = await app.request("http://attacker.example/api/session", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(421);
  });

  it("requires the session token on every API endpoint", async () => {
    const { app } = await setup();
    for (const [path, method] of [
      ["/api/session", "GET"],
      ["/api/discussion", "POST"],
      ["/api/agent/wait", "GET"],
      ["/api/agent/respond", "POST"],
      ["/api/confirm", "POST"],
      ["/api/cancel", "POST"],
    ] as const) {
      const response = await app.request(path, { method, headers: { authorization: "Bearer wrong" } });
      expect(response.status, path).toBe(401);
    }
    expect((await app.request("/api/events")).status).toBe(401);
    expect((await app.request("/api/events?token=wrong")).status).toBe(401);
  });

  it("returns the session snapshot", async () => {
    const { call } = await setup();
    const response = await call("/api/session");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ sessionId: "checkout-redesign", documentVersion: 1, live: true });
  });

  it("maps validation, conflict, and closed-session errors to HTTP status codes", async () => {
    const { call } = await setup();

    expect((await call("/api/discussion", { method: "POST", body: "not json" })).status).toBe(400);
    expect((await call("/api/discussion", { method: "POST", body: JSON.stringify({ items: [] }) })).status).toBe(400);
    const sent = await call("/api/discussion", {
      method: "POST",
      body: JSON.stringify({ items: [{ groupId: "layout", message: "Why?" }] }),
    });
    expect(sent.status).toBe(200);
    expect((await sent.json()).session.agentPending).toBe(true);
    const busy = await call("/api/discussion", {
      method: "POST",
      body: JSON.stringify({ items: [{ groupId: "copy", message: "And?" }] }),
    });
    expect(busy.status).toBe(409);
    const stale = await call("/api/confirm", {
      method: "POST",
      body: JSON.stringify({ confirmed: true, documentVersion: 7, groups: [] }),
    });
    expect(stale.status).toBe(409);
    const waited = await call("/api/agent/wait");
    expect(await waited.json()).toMatchObject({ status: "discussion", groupIds: ["layout"] });
    const invalid = await call("/api/agent/respond", { method: "POST", body: JSON.stringify({ version: 1 }) });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("sessionId");

    expect((await call("/api/cancel", { method: "POST", body: "{}" })).status).toBe(200);
    expect((await call("/api/cancel", { method: "POST", body: "{}" })).status).toBe(410);
  });

  it("streams session changes and tracks connected tabs", async () => {
    const { app, call, connections } = await setup();
    const response = await app.request(`/api/events?token=${token}`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const read = async () => decoder.decode((await reader.read()).value);

    expect(await read()).toContain("event: ready");
    expect(connections.connected).toBe(1);
    await expect(connections.waitForClient(10)).resolves.toBe(true);
    await call("/api/discussion", {
      method: "POST",
      body: JSON.stringify({ items: [{ groupId: "layout", message: "Why?" }] }),
    });
    expect(await read()).toContain("event: session");
    await call("/api/cancel", { method: "POST", body: "{}" });
    let rest = "";
    while (!rest.includes("event: closed")) rest += await read();
    expect(rest).toContain("event: closed");
  });

  it("reports when no browser tab reconnects", async () => {
    await expect(new ConnectionTracker().waitForClient(10)).resolves.toBe(false);
  });
});

describe("screenshot serving", () => {
  it("serves only images listed in the document, as read-only snapshots", async () => {
    const { path } = await temporaryImage();
    const { app, session } = await setup(path);
    const id = session.assetIdForPath(1, path)!;

    const response = await app.request(`/api/assets/${id}?token=${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);

    await writeFile(path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const snapshot = await app.request(`/api/assets/${id}?token=${token}`);
    expect(new Uint8Array(await snapshot.arrayBuffer())).toEqual(png);
  });

  it("refuses unknown asset ids, paths, and requests without the token", async () => {
    const { path } = await temporaryImage();
    const { app, session } = await setup(path);
    const id = session.assetIdForPath(1, path)!;

    expect((await app.request(`/api/assets/${id}`)).status).toBe(401);
    expect((await app.request(`/api/assets/${"0".repeat(64)}?token=${token}`)).status).toBe(404);
    expect((await app.request(`/api/assets/${encodeURIComponent(path)}?token=${token}`)).status).toBe(404);
    expect((await app.request(`/api/assets/..%2F..%2Fetc%2Fpasswd?token=${token}`)).status).toBe(404);
  });

  it("rejects missing files, non-images, directories, and oversized files at ingest", async () => {
    const { directory } = await temporaryImage();
    const text = join(directory, "secret.png");
    await writeFile(text, "-----BEGIN PRIVATE KEY-----");

    await expect(setup(join(directory, "missing.png"))).rejects.toThrow("does not exist");
    await expect(setup(text)).rejects.toThrow("Unsupported image format");
    await expect(setup(directory)).rejects.toThrow("not a regular file");
    const large = await temporaryImage("large.png", new Uint8Array(15 * 1024 * 1024 + 1));
    await expect(setup(large.path)).rejects.toThrow("larger than 15 MB");
  });

  it("follows a symlink only to a real image", async () => {
    const { directory, path } = await temporaryImage();
    const link = join(directory, "link.png");
    await symlink(path, link);
    const { session } = await setup(link);

    expect(session.assetIdForPath(1, link)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("detects supported image formats from their bytes", () => {
    const encode = (value: string) => new TextEncoder().encode(value);
    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(detectImageType(encode("GIF89a...."))).toBe("image/gif");
    expect(detectImageType(encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
    expect(detectImageType(encode("<?xml version=\"1.0\"?>\n<!-- logo -->\n<svg viewBox=\"0 0 1 1\"></svg>"))).toBe("image/svg+xml");
    expect(detectImageType(encode("<html><svg></svg></html>"))).toBeNull();
    expect(detectImageType(encode("plain text"))).toBeNull();
  });
});
