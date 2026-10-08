import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { imagePaths, InvalidDocumentError, type DecisionDocument } from "../domain/decision";

export const maxImageBytes = 15 * 1024 * 1024;
const maxDocumentImageBytes = 100 * 1024 * 1024;

type StoredAsset = { bytes: Uint8Array; contentType: string };

/**
 * Holds read-only snapshots of the screenshots referenced by the session's documents.
 * Files are read once when a document arrives, so later rounds keep showing the exact
 * image the human saw, and nothing outside the listed files is ever served.
 */
export class AssetStore {
  private readonly assets = new Map<string, StoredAsset>();

  /** Reads every image listed in the document and returns a path → asset ID map. */
  async ingest(document: DecisionDocument): Promise<Record<string, string>> {
    const loaded: [string, string, StoredAsset][] = [];
    let total = 0;
    for (const path of imagePaths(document)) {
      const asset = await readImage(path);
      total += asset.bytes.byteLength;
      if (total > maxDocumentImageBytes) {
        throw new InvalidDocumentError("The images in one document may not exceed 100 MB in total.");
      }
      const id = createHash("sha256").update(asset.bytes).digest("hex");
      loaded.push([path, id, asset]);
    }
    for (const [, id, asset] of loaded) this.assets.set(id, asset);
    return Object.fromEntries(loaded.map(([path, id]) => [path, id]));
  }

  get(id: string): StoredAsset | undefined {
    return this.assets.get(id);
  }
}

async function readImage(path: string): Promise<StoredAsset> {
  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch {
    throw new InvalidDocumentError(`Image file does not exist: ${path}`);
  }
  const stats = await lstat(resolved);
  if (!stats.isFile()) throw new InvalidDocumentError(`Image path is not a regular file: ${path}`);
  if (stats.size > maxImageBytes) throw new InvalidDocumentError(`Image is larger than 15 MB: ${path}`);
  const bytes = new Uint8Array(await readFile(resolved));
  const contentType = detectImageType(bytes);
  if (!contentType) {
    throw new InvalidDocumentError(`Unsupported image format (use PNG, JPEG, GIF, WebP, or SVG): ${path}`);
  }
  return { bytes, contentType };
}

export function detectImageType(bytes: Uint8Array): string | null {
  const starts = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  const head = new TextDecoder().decode(bytes.subarray(0, 4_096)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}
