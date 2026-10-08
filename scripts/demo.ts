import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Opens the example decision screen. The example keeps its screenshots next to the JSON,
 * so their relative paths are resolved to the absolute paths Decisionator requires.
 *
 *   bun run demo                    # live session in the browser
 *   bun scripts/demo.ts --write-only # print the resolved document path and exit
 */
const examples = resolve(import.meta.dir, "../examples");
const document = await Bun.file(join(examples, "checkout-redesign.json")).json();

function resolveImages(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(resolveImages);
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.kind === "image" && typeof record.path === "string") record.path = resolve(examples, record.path);
  Object.values(record).forEach(resolveImages);
}

resolveImages(document);
const file = join(tmpdir(), "decisionator-demo.json");
await Bun.write(file, `${JSON.stringify(document, null, 2)}\n`);
const args = process.argv.slice(2);
if (args.includes("--write-only")) {
  process.stdout.write(`${file}\n`);
  process.exit(0);
}
const child = Bun.spawn(["bun", resolve(import.meta.dir, "../src/cli.ts"), document.sessionId, "--file", file, ...args], {
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(await child.exited);
