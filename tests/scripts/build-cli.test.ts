// @vitest-environment node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const macOS = process.platform === "darwin";

async function outputPath() {
  return join(await mkdtemp(join(tmpdir(), "decisionator-build-test-")), "decisionator");
}

describe("CLI build script", () => {
  it.runIf(macOS)("signs a macOS build so it passes strict verification and runs", async () => {
    const output = await outputPath();
    await run("scripts/build-cli.sh", [output]);

    await expect(run("codesign", ["--verify", "--strict", output])).resolves.toBeDefined();
    const { stderr } = await run("codesign", ["-dv", output]);
    expect(stderr).not.toContain("linker-signed");
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    expect((await run(output, ["--version"])).stdout).toBe(`Decisionator ${version}\n`);
  }, 120_000);

  it.runIf(macOS)("signs a macOS binary for the other architecture too", async () => {
    const output = await outputPath();
    await run("scripts/build-cli.sh", [output, process.arch === "arm64" ? "bun-darwin-x64" : "bun-darwin-arm64"]);

    await expect(run("codesign", ["--verify", "--strict", output])).resolves.toBeDefined();
  }, 120_000);

  it.runIf(process.platform === "linux")("builds a Linux binary without signing it", async () => {
    const output = await outputPath();
    const { stdout } = await run("scripts/build-cli.sh", [output]);

    expect(stdout).not.toContain("Signed");
    expect((await run(output, ["--version"])).stdout).toMatch(/^Decisionator /);
  }, 120_000);

  it("refuses to build a macOS binary where codesign is missing", async () => {
    const bin = join(await mkdtemp(join(tmpdir(), "decisionator-build-path-")), "bin");
    await mkdir(bin);
    for (const tool of ["dirname", "uname"]) {
      const { stdout } = await run("sh", ["-c", `command -v ${tool}`]);
      await symlink(stdout.trim(), join(bin, tool));
    }

    await expect(run("scripts/build-cli.sh", [await outputPath(), "bun-darwin-arm64"], { env: { PATH: `${bin}:/bin` } }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("needs codesign. Build macOS binaries on macOS.") });
  });

  it("builds macOS release binaries on macOS and fails the release when a signature is invalid", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");

    expect(workflow).toMatch(/- platform: darwin-arm64\n\s+target: bun-darwin-arm64\n\s+os: macos-latest/);
    expect(workflow).toMatch(/- platform: darwin-x64\n\s+target: bun-darwin-x64\n\s+os: macos-latest/);
    expect(workflow).toMatch(/- platform: linux-x64\n\s+target: bun-linux-x64-baseline\n\s+os: ubuntu-latest/);
    expect(workflow).toContain("./scripts/build-cli.sh \"dist/decisionator-${{ matrix.platform }}\" \"${{ matrix.target }}\"");
    expect(workflow).toContain("codesign --verify --strict --verbose=2 verify/decisionator");
    expect(workflow).not.toContain("bun build --compile");
  });
});
