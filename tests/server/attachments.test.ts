// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maxImageBytes } from "../../src/domain/images";
import { InvalidAttachmentError } from "../../src/server/attachments";
import { attachmentStore, pngBytes } from "../fixtures";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("attachment store", () => {
  it("identifies an upload by its content hash and detected type", () => {
    const store = attachmentStore();
    const bytes = pngBytes(1);

    expect(store.add(bytes)).toEqual({ id: sha256(bytes), type: "image/png", size: bytes.byteLength });
    expect(store.pathFor({ id: sha256(bytes), type: "image/png" })).toBe(`${store.directory}/${sha256(bytes)}.png`);
  });

  it.each([
    ["an SVG image", new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")],
    ["plain text", new TextEncoder().encode("not an image")],
    ["an empty file", new Uint8Array()],
  ])("refuses %s", (_name, bytes) => {
    expect(() => attachmentStore().add(bytes)).toThrow("Attach PNG, JPEG, GIF, or WebP images.");
  });

  it("refuses an image larger than 15 MB", () => {
    const bytes = new Uint8Array(maxImageBytes + 1);
    bytes.set(pngBytes());
    expect(() => attachmentStore().add(bytes)).toThrow("at most 15 MB");
  });

  it("writes referenced uploads to a private directory", () => {
    const store = attachmentStore();
    const bytes = pngBytes(2);
    const { id } = store.add(bytes);

    const [file] = store.persist([{ id, type: "image/png", name: "shot.png" }]);

    expect(file?.path).toBe(store.pathFor({ id, type: "image/png" }));
    expect(new Uint8Array(readFileSync(file!.path))).toEqual(bytes);
    expect(statSync(file!.path).mode & 0o777).toBe(0o600);
    expect(statSync(store.directory).mode & 0o777).toBe(0o700);
  });

  it("checks every reference before writing anything", () => {
    const store = attachmentStore();
    const { id } = store.add(pngBytes(3));

    expect(() => store.persist([
      { id, type: "image/png", name: "first.png" },
      { id: "f".repeat(64), type: "image/png", name: "missing.png" },
    ])).toThrow("missing.png was not uploaded");
    expect(() => store.persist([{ id, type: "image/jpeg", name: "renamed.jpg" }])).toThrow(InvalidAttachmentError);
    expect(existsSync(store.directory)).toBe(false);
  });
});
