import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import {
  attachmentPath,
  detectImageType,
  isAttachmentType,
  maxImageBytes,
  type AttachmentType,
} from "../domain/images";
import type { AttachmentReference } from "../domain/protocol";

const maxUploadedBytes = 300 * 1024 * 1024;

export class InvalidAttachmentError extends Error {}

type Upload = { bytes: Uint8Array; type: AttachmentType };

/**
 * Holds the images the browser uploads right before Send to AI or Confirm, and writes the
 * ones a request references into a private directory where the agent can open them.
 */
export class AttachmentStore {
  private readonly uploads = new Map<string, Upload>();
  private uploadedBytes = 0;

  constructor(readonly directory: string) {}

  add(bytes: Uint8Array): { id: string; type: AttachmentType; size: number } {
    if (bytes.byteLength > maxImageBytes) throw new InvalidAttachmentError("Images can be at most 15 MB.");
    const type = detectImageType(bytes);
    if (!isAttachmentType(type)) throw new InvalidAttachmentError("Attach PNG, JPEG, GIF, or WebP images.");
    const id = createHash("sha256").update(bytes).digest("hex");
    if (!this.uploads.has(id)) {
      if (this.uploadedBytes + bytes.byteLength > maxUploadedBytes) {
        throw new InvalidAttachmentError("This session already holds 300 MB of images. Send fewer images at once.");
      }
      this.uploads.set(id, { bytes, type });
      this.uploadedBytes += bytes.byteLength;
    }
    return { id, type, size: bytes.byteLength };
  }

  pathFor({ id, type }: { id: string; type: AttachmentType }): string {
    return attachmentPath(this.directory, { id, type });
  }

  /** Checks every reference before writing any file, so a bad request leaves nothing behind. */
  persist(references: AttachmentReference[]): (Upload & { path: string })[] {
    const files = references.map((reference) => {
      const upload = this.uploads.get(reference.id);
      if (!upload) throw new InvalidAttachmentError(`The image ${reference.name} was not uploaded. Attach it again.`);
      if (upload.type !== reference.type) {
        throw new InvalidAttachmentError(`The image ${reference.name} is not a ${reference.type} file.`);
      }
      return { ...upload, path: this.pathFor(reference) };
    });
    if (files.length === 0) return files;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    for (const file of files) {
      writeFileSync(file.path, file.bytes, { mode: 0o600 });
      chmodSync(file.path, 0o600);
    }
    return files;
  }
}
