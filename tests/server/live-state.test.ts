// @vitest-environment node

import { mkdtemp, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveStateDirectory,
  liveStatePath,
  MissingLiveSessionError,
  readLiveState,
  removeLiveState,
  writeLiveState,
} from "../../src/server/live-state";

const state = {
  sessionId: "checkout-redesign",
  baseUrl: "http://127.0.0.1:1234",
  token: "local-secret",
  pid: 123,
  startedAt: "2026-10-08T00:00:00.000Z",
};

describe("live session state", () => {
  it("finds a session by ID and stores its local secret with owner-only permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "decisionator-state-"));
    const env = { DECISIONATOR_STATE_DIR: directory };

    await writeLiveState(state, env);

    expect(await readLiveState(state.sessionId, env)).toEqual(state);
    expect(liveStatePath(state.sessionId, env)).not.toContain(state.sessionId);
    expect((await stat(liveStatePath(state.sessionId, env))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
  });

  it("keeps sessions with different IDs apart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "decisionator-state-"));
    const env = { DECISIONATOR_STATE_DIR: directory };
    await writeLiveState(state, env);

    await expect(readLiveState("another-session", env)).rejects.toThrow(MissingLiveSessionError);
  });

  it("removes completed session state without failing when called twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "decisionator-state-"));
    const env = { DECISIONATOR_STATE_DIR: directory };
    await writeLiveState(state, env);

    await removeLiveState(state.sessionId, env);
    await removeLiveState(state.sessionId, env);

    await expect(readLiveState(state.sessionId, env)).rejects.toThrow(/No live Decisionator session/);
  });

  it("uses the XDG state directory by default", () => {
    expect(liveStateDirectory({ XDG_STATE_HOME: "/state" })).toBe("/state/decisionator");
    expect(liveStateDirectory({})).toBe(join(homedir(), ".local", "state", "decisionator"));
  });
});
