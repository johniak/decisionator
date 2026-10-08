import { createStore, delMany, get, keys, set, type UseStore } from "idb-keyval";
import { createContext, useContext, useEffect, useState } from "react";
import {
  attachmentTypes,
  detectImageType,
  isAttachmentType,
  maxImageBytes,
  type AttachmentType,
} from "../src/domain/images";

/** An image in the human's draft. The bytes live in the browser until Send to AI or Confirm. */
export type DraftAttachment = { id: string; type: AttachmentType; name: string; size: number };

export type StoredImage = { bytes: ArrayBuffer; type: AttachmentType };

export type AttachmentBlobs = {
  put(sessionId: string, id: string, image: StoredImage): Promise<void>;
  get(sessionId: string, id: string): Promise<StoredImage | undefined>;
  clear(sessionId: string): Promise<void>;
};

export class AttachmentError extends Error {}

export const acceptedImageTypes = attachmentTypes.join(",");

/** Reads a picked, pasted, or dropped file and checks it the way the server will. */
export async function readAttachment(file: File): Promise<{ attachment: DraftAttachment; image: StoredImage }> {
  const name = file.name.replace(/\s+/g, " ").trim().slice(0, 200) || "Pasted image";
  if (file.size > maxImageBytes) throw new AttachmentError(`${name} is larger than 15 MB.`);
  const bytes = await file.arrayBuffer();
  const type = detectImageType(new Uint8Array(bytes));
  if (!isAttachmentType(type)) throw new AttachmentError(`${name} is not a PNG, JPEG, GIF, or WebP image.`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const id = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return { attachment: { id, type, name, size: bytes.byteLength }, image: { bytes, type } };
}

/**
 * Keeps attached images in IndexedDB so a reload restores them with the draft. Without
 * IndexedDB, as in a private window that blocks it, images stay in memory for this tab.
 */
export function browserAttachmentBlobs(): AttachmentBlobs {
  const memory = new Map<string, StoredImage>();
  let store: UseStore | undefined;
  try {
    if (typeof indexedDB !== "undefined") store = createStore("decisionator", "attachments");
  } catch {
    store = undefined;
  }
  const key = (sessionId: string, id: string) => `${sessionId}/${id}`;
  return {
    async put(sessionId, id, image) {
      memory.set(key(sessionId, id), image);
      if (store) await set(key(sessionId, id), image, store).catch(() => {});
    },
    async get(sessionId, id) {
      const cached = memory.get(key(sessionId, id));
      if (cached || !store) return cached;
      const stored = await get<StoredImage>(key(sessionId, id), store).catch(() => undefined);
      if (stored) memory.set(key(sessionId, id), stored);
      return stored;
    },
    async clear(sessionId) {
      for (const name of [...memory.keys()]) if (name.startsWith(`${sessionId}/`)) memory.delete(name);
      if (!store) return;
      const names = await keys(store).catch(() => []);
      await delMany(names.filter((name) => String(name).startsWith(`${sessionId}/`)), store).catch(() => {});
    },
  };
}

export const AttachmentContext = createContext<{ blobs: AttachmentBlobs; sessionId: string } | null>(null);

export function useAttachments() {
  const context = useContext(AttachmentContext);
  if (!context) throw new Error("Attachments are not available outside a Decisionator session.");
  return context;
}

/** An object URL for an image in the draft, revoked when the thumbnail goes away. */
export function useAttachmentUrl(id: string): string | undefined {
  const context = useContext(AttachmentContext);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!context) return;
    let active = true;
    let created: string | undefined;
    void context.blobs.get(context.sessionId, id).then((image) => {
      if (!active || !image) return;
      created = URL.createObjectURL(new Blob([image.bytes], { type: image.type }));
      setUrl(created);
    });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [context, id]);
  return url;
}
