import clsx from "clsx";
import { Check, Hand } from "lucide-react";
import type { Assumption } from "../../src/domain/decision";
import type { AssumptionDraft } from "../draft";
import { Markdown } from "./Markdown";

type Props = {
  assumptions: Assumption[];
  drafts: Record<string, AssumptionDraft>;
  language?: string;
  readOnly?: boolean;
  onChange: (id: string, draft: AssumptionDraft) => void;
};

export function AssumptionsSection({ assumptions, drafts, language, readOnly = false, onChange }: Props) {
  if (assumptions.length === 0) return null;
  return (
    <section id="assumptions" className="assumptions-card" tabIndex={-1} aria-labelledby="assumptions-title">
      <header>
        <h2 id="assumptions-title">Assumptions</h2>
        <p>The AI agent will adopt these unless you object.</p>
      </header>
      <ul>
        {assumptions.map((assumption) => {
          const draft = drafts[assumption.id] ?? { objecting: false, objection: "" };
          return (
            <li key={assumption.id} className={clsx("assumption", draft.objecting && "objecting")}>
              <Markdown className="markdown assumption-text" lang={language}>{assumption.text}</Markdown>
              {!readOnly && (
                <div className="segmented assumption-choice" role="group" aria-label={`Response to assumption ${assumption.id}`}>
                  <button
                    type="button"
                    aria-pressed={!draft.objecting}
                    onClick={() => onChange(assumption.id, { objecting: false, objection: "" })}
                  >
                    <Check aria-hidden="true" size={13} /> Accept
                  </button>
                  <button
                    type="button"
                    aria-pressed={draft.objecting}
                    onClick={() => onChange(assumption.id, { ...draft, objecting: true })}
                  >
                    <Hand aria-hidden="true" size={13} /> Object
                  </button>
                </div>
              )}
              {!readOnly && draft.objecting && (
                <label className="objection-field">
                  <span>What should the agent do instead?</span>
                  <textarea
                    rows={2}
                    value={draft.objection}
                    autoFocus
                    placeholder="Explain your objection…"
                    onChange={(event) => onChange(assumption.id, { objecting: true, objection: event.target.value })}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
