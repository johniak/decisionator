import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { z } from "zod";
import { decisionDocumentSchema, parseDecisionDocument, type DecisionDocument } from "../src/domain/decision";
import { AttachmentStore } from "../src/server/attachments";

export type DecisionInput = z.input<typeof decisionDocumentSchema>;

export const sessionId = "checkout-redesign";

export function decisionInput(): DecisionInput {
  return {
    version: 1,
    sessionId,
    language: "English",
    title: "Checkout redesign — decisions before plan 2",
    intro: "Three decisions block the implementation plan. Everything else follows the assumptions below.",
    groups: [
      {
        id: "layout",
        title: "Checkout layout",
        context: "The layout decides how much we rebuild. **Getting it wrong** costs a second redesign.",
        mode: "single",
        options: [
          {
            id: "one-page",
            label: "One page",
            description: "Every step on one scrolling page.",
            pros: ["Fewer clicks"],
            cons: ["Long form on small screens"],
            mockup: { kind: "html", body: "<div class=\"dn-card\">One page</div>" },
          },
          {
            id: "steps",
            label: "Three steps",
            description: "Address, delivery, and payment on separate steps.",
            recommended: true,
            mockup: { kind: "html", body: "<div class=\"dn-card\">Steps</div>", theme: "light" },
          },
        ],
        recommendation: { optionIds: ["steps"], text: "Three steps keep the payment form short and testable." },
      },
      {
        id: "notifications",
        title: "Order notifications",
        context: "Choose every channel we should support at launch.",
        mode: "multi",
        allowOther: true,
        options: [
          { id: "email", label: "Email", description: "Already available." },
          { id: "sms", label: "SMS", description: "Needs a provider contract." },
          { id: "push", label: "Push", description: "Mobile app only." },
        ],
      },
      {
        id: "copy",
        title: "Confirmation headline",
        context: "Write the headline shown after payment.",
        mode: "text",
      },
    ],
    assumptions: [
      { id: "currency", text: "Prices stay in EUR for the first release." },
      { id: "guest", text: "Guest checkout remains available." },
    ],
  };
}

export function decisionDocument(): DecisionDocument {
  return parseDecisionDocument(decisionInput());
}

/** Attachments written by a test session go to a fresh temporary directory. */
export function attachmentStore(): AttachmentStore {
  return new AttachmentStore(join(mkdtempSync(join(tmpdir(), "decisionator-attachments-")), sessionId, "attachments"));
}

/** A tiny valid PNG, distinct per seed so tests can attach several different images. */
export function pngBytes(seed = 0): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, seed]);
}
