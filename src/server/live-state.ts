import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FinalResult } from "./session";

export type LiveSessionState = {
  sessionId: string;
  baseUrl: string;
  token: string;
  pid: number;
  startedAt: string;
  result?: FinalResult;
};

export class MissingLiveSessionError extends Error {}

export function liveStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DECISIONATOR_STATE_DIR) return env.DECISIONATOR_STATE_DIR;
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "decisionator");
}

export function liveStatePath(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return join(liveStateDirectory(env), `${key}.json`);
}

export async function writeLiveState(
  state: LiveSessionState,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const directory = liveStateDirectory(env);
  const destination = liveStatePath(state.sessionId, env);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
}

export async function readLiveState(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LiveSessionState> {
  const path = liveStatePath(sessionId, env);
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as LiveSessionState;
    if (state.sessionId !== sessionId) {
      throw new Error("The saved live session belongs to a different session ID.");
    }
    return state;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new MissingLiveSessionError(`No live Decisionator session was found for ${sessionId}.`);
    }
    throw error;
  }
}

export async function removeLiveState(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await rm(liveStatePath(sessionId, env), { force: true });
}
