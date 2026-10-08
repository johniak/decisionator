import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { imagePaths, InvalidDocumentError, type DecisionDocument } from "../domain/decision";
import { detectImageType, maxImageBytes } from "../domain/images";

export { detectImageType, maxImageBytes };
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
      const id = createHash("sha256").update(asset.bytes).digest("hex");
      // Images held from earlier rounds, such as the human's attachments, cost no new memory.
      if (!this.assets.has(id)) total += asset.bytes.byteLength;
      if (total > maxDocumentImageBytes) {
        throw new InvalidDocumentError("The images in one document may not exceed 100 MB in total.");
      }
      loaded.push([path, id, asset]);
    }
    for (const [, id, asset] of loaded) this.assets.set(id, asset);
    return Object.fromEntries(loaded.map(([path, id]) => [path, id]));
  }

  /** Serves an image the human attached; it is already validated and written by the attachment store. */
  add(bytes: Uint8Array, contentType: string): string {
    const id = createHash("sha256").update(bytes).digest("hex");
    this.assets.set(id, { bytes, contentType });
    return id;
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
