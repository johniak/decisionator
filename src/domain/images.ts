/** Image rules shared by the server and the browser. */

export const maxImageBytes = 15 * 1024 * 1024;
export const maxAttachmentsPerField = 10;

/** Formats a human may attach. SVG is excluded because it can carry scripts. */
export const attachmentTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AttachmentType = (typeof attachmentTypes)[number];

const extensions: Record<AttachmentType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export function isAttachmentType(type: string | null): type is AttachmentType {
  return (attachmentTypes as readonly string[]).includes(type ?? "");
}

/** Attachment files are named by their SHA-256 hash, so the browser can predict the exact path. */
export function attachmentFileName(id: string, type: AttachmentType): string {
  return `${id}${extensions[type]}`;
}

/** The same path on the server and in the browser preview, so the preview shows the exact result. */
export function attachmentPath(directory: string, { id, type }: { id: string; type: AttachmentType }): string {
  return `${directory}/${attachmentFileName(id, type)}`;
}

export function attachmentIdFromPath(path: string): string | undefined {
  return path.split("/").at(-1)?.match(/^([0-9a-f]{64})\.[a-z]+$/)?.[1];
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
