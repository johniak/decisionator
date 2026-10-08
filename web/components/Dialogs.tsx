import * as Dialog from "@radix-ui/react-dialog";
import { CircleX, X } from "lucide-react";

export function CancelDialog({
  open,
  error,
  onOpenChange,
  onCancel,
}: {
  open: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="small-dialog" aria-describedby="cancel-description">
          <div className="dialog-heading">
            <div>
              <Dialog.Title>Cancel this decision session?</Dialog.Title>
              <Dialog.Description id="cancel-description">
                The AI agent receives no decisions, comments, or assumptions. It is told that you cancelled.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close cancel dialog"><X size={18} /></Dialog.Close>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <div className="dialog-footer split">
            <Dialog.Close className="secondary-button">Keep answering</Dialog.Close>
            <button type="button" className="danger-button" onClick={onCancel}>
              <CircleX aria-hidden="true" size={15} /> Cancel session
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const shortcuts = [
  ["J / K", "Next or previous question"],
  ["1 – 4", "Choose option A–D in the current question"],
  ["O", "Write an Other answer"],
  ["C", "Comment on the current question"],
  ["D", "Discuss the current question with the AI agent"],
  ["⌘ / Ctrl + Enter", "Send the discussion you are writing"],
  ["?", "Show these shortcuts"],
] as const;

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="small-dialog" aria-describedby={undefined}>
          <div className="dialog-heading">
            <Dialog.Title>Keyboard shortcuts</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close keyboard shortcuts"><X size={18} /></Dialog.Close>
          </div>
          <dl className="shortcut-list">
            {shortcuts.map(([keys, description]) => (
              <div key={keys}><dt><kbd>{keys}</kbd></dt><dd>{description}</dd></div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
