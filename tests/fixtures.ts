import type { z } from "zod";
import { decisionDocumentSchema, parseDecisionDocument, type DecisionDocument } from "../src/domain/decision";

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
