import clsx from "clsx";
import { ImageIcon, ImagePlus, X } from "lucide-react";
import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import type { Attachment } from "../../src/domain/decision";
import { attachmentIdFromPath, maxAttachmentsPerField } from "../../src/domain/images";
import {
  acceptedImageTypes,
  AttachmentError,
  readAttachment,
  useAttachments,
  useAttachmentUrl,
  type DraftAttachment,
} from "../attachments";
import type { AssetResolver } from "../mockups/MockupView";
import { ZoomDialog } from "./ZoomDialog";

export type AttachmentFieldHandlers = {
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

const pasteShortcut = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘V" : "Ctrl+V";

/**
 * Lets the human add images to one field: paste them, drop them on the field, or pick files.
 * The field itself is rendered by `children`, which receives the paste and drop handlers.
 */
export function AttachmentControls({
  label,
  attachments,
  disabled = false,
  onAdd,
  onRemove,
  children,
}: {
  label: string;
  attachments: DraftAttachment[];
  disabled?: boolean;
  onAdd: (attachment: DraftAttachment) => void;
  onRemove: (id: string) => void;
  children: (handlers: AttachmentFieldHandlers) => ReactNode;
}) {
  const { blobs, sessionId } = useAttachments();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    setError(null);
    let count = attachments.length;
    for (const file of files) {
      try {
        const { attachment, image } = await readAttachment(file);
        if (attachments.some(({ id }) => id === attachment.id)) continue;
        if (count >= maxAttachmentsPerField) {
          setError(`You can attach up to ${maxAttachmentsPerField} images here.`);
          return;
        }
        await blobs.put(sessionId, attachment.id, image);
        onAdd(attachment);
        count += 1;
      } catch (caught) {
        setError(caught instanceof AttachmentError ? caught.message : "This image could not be attached.");
      }
    }
  }

  const handlers: AttachmentFieldHandlers = {
    onPaste: (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (disabled || files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    },
    onDragOver: (event) => {
      if (disabled || !event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => {
      const files = [...(event.dataTransfer?.files ?? [])];
      setDragging(false);
      if (disabled || files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    },
  };

  return (
    <div className={clsx("attachment-field", dragging && "dragging")}>
      {children(handlers)}
      {attachments.length > 0 && (
        <ul className="attachment-list" aria-label={`Images attached to ${label}`}>
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <DraftThumbnail attachment={attachment} onRemove={disabled ? undefined : () => onRemove(attachment.id)} />
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="attachment-actions">
          <button type="button" className="text-button attachment-add" onClick={() => input.current?.click()}>
            <ImagePlus aria-hidden="true" size={13} /> Add image
          </button>
          <small>or paste with {pasteShortcut}, or drop a file on the field</small>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept={acceptedImageTypes}
            multiple
            tabIndex={-1}
            aria-label={`Choose images to attach to ${label}`}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              void addFiles(files);
            }}
          />
        </div>
      )}
      {error && <p className="attachment-error" role="alert">{error}</p>}
    </div>
  );
}

function DraftThumbnail({ attachment, onRemove }: { attachment: DraftAttachment; onRemove?: () => void }) {
  return <Thumbnail name={attachment.name} url={useAttachmentUrl(attachment.id)} onRemove={onRemove} />;
}

/** Images the human already sent, served by the session like every other screenshot. */
export function SentAttachments({ attachments, resolveAsset }: { attachments: Attachment[]; resolveAsset: AssetResolver }) {
  return (
    <ul className="attachment-list sent" aria-label="Attached images">
      {attachments.map((attachment) => (
        <li key={attachment.path}><Thumbnail name={attachment.name} url={resolveAsset(attachment.path)} /></li>
      ))}
    </ul>
  );
}

/** Images in the confirmation preview, shown from the draft while it still holds them. */
export function ResultAttachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <ul className="attachment-list result" aria-label="Attached images">
      {attachments.map((attachment) => (
        <li key={attachment.path}><ResultThumbnail attachment={attachment} /></li>
      ))}
    </ul>
  );
}

function ResultThumbnail({ attachment }: { attachment: Attachment }) {
  return <Thumbnail name={attachment.name} url={useAttachmentUrl(attachmentIdFromPath(attachment.path) ?? "")} />;
}

function Thumbnail({ name, url, onRemove }: { name: string; url?: string; onRemove?: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className="attachment-thumb">
      {url ? (
        <button type="button" className="attachment-preview" aria-label={`Enlarge ${name}`} title={name} onClick={() => setZoomed(true)}>
          <img src={url} alt={name} />
        </button>
      ) : (
        <span className="attachment-preview missing" title={name}><ImageIcon aria-hidden="true" size={14} /> {name}</span>
      )}
      {onRemove && (
        <button type="button" className="attachment-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
          <X aria-hidden="true" size={12} />
        </button>
      )}
      {url && (
        <ZoomDialog open={zoomed} onOpenChange={setZoomed} title={name}>
          <img className="zoomed-image" src={url} alt={name} />
        </ZoomDialog>
      )}
    </div>
  );
}
