import clsx from "clsx";
import { ArrowRight, CircleX, History, ListChecks, LoaderCircle, Send, Sparkles } from "lucide-react";
import type { DecisionDocument } from "../../src/domain/decision";
import { groupDraft, type Draft } from "../draft";
import type { GroupStatus } from "../status";
import type { DocumentRevision } from "../types";
import { optionLetters } from "./GroupCard";

type Props = {
  document: DecisionDocument;
  draft: Draft;
  statuses: Record<string, GroupStatus>;
  revisions: DocumentRevision[];
  viewedVersion: number | null;
  tab: "answers" | "history";
  lang?: string;
  preparedCount: number;
  agentPending: boolean;
  error: string | null;
  onTabChange: (tab: "answers" | "history") => void;
  onSelectGroup: (id: string) => void;
  onViewVersion: (version: number | null) => void;
  onSendPrepared: () => void;
  onReview: () => void;
  onCancel: () => void;
};

export function answerText(document: DecisionDocument, draft: Draft, groupId: string): string {
  const group = document.groups.find(({ id }) => id === groupId)!;
  const current = groupDraft(draft, groupId);
  if (current.skipped) {
    const labels = group.options.filter((option) => group.recommendation?.optionIds.includes(option.id)).map(({ label }) => label);
    return labels.length > 0 ? `Skipped, uses ${labels.join(", ")}` : "Skipped";
  }
  if (group.mode === "text") return current.text.trim() || "No answer yet";
  const parts = group.options
    .map((option, index) => ({ option, letter: optionLetters[index] }))
    .filter(({ option }) => current.selectedOptionIds.includes(option.id))
    .map(({ option, letter }) => `${letter}. ${option.label}`);
  if (current.otherSelected && current.otherText.trim()) parts.push(`Other: ${current.otherText.trim()}`);
  return parts.join(", ") || "No answer yet";
}

export function AnswersPanel({
  document,
  draft,
  statuses,
  revisions,
  viewedVersion,
  tab,
  lang,
  preparedCount,
  agentPending,
  error,
  onTabChange,
  onSelectGroup,
  onViewVersion,
  onSendPrepared,
  onReview,
  onCancel,
}: Props) {
  const latest = revisions.length;
  return (
    <aside className="answers-panel" aria-label="Your answers">
      <div className="panel-tabs" role="tablist" aria-label="Side panel">
        <button type="button" role="tab" aria-selected={tab === "answers"} onClick={() => onTabChange("answers")}>
          <ListChecks aria-hidden="true" size={14} /> Your answers
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => onTabChange("history")}>
          <History aria-hidden="true" size={14} /> History <span>{latest}</span>
        </button>
      </div>

      <div className="panel-content">
        {tab === "answers" ? (
          <ol className="answer-list">
            {document.groups.map((group, index) => (
              <li key={group.id} className={`answer-${statuses[group.id]}`}>
                <button type="button" onClick={() => onSelectGroup(group.id)}>
                  <span className="nav-number">{index + 1}</span>
                  <span>
                    <strong lang={lang}>{group.title}</strong>
                    <small lang={lang}>{answerText(document, draft, group.id)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="version-list" reversed>
            {[...revisions].reverse().map((revision) => {
              const current = revision.number === latest;
              const viewing = viewedVersion === revision.number || (viewedVersion === null && current);
              const titles = revision.revisedGroupIds
                .map((id) => revision.document.groups.find((group) => group.id === id)?.title ?? id);
              return (
                <li key={revision.number} className={clsx(viewing && "viewing")}>
                  <button type="button" aria-current={viewing ? "true" : undefined} onClick={() => onViewVersion(current ? null : revision.number)}>
                    <span className="version-number">v{revision.number}</span>
                    <span>
                      <strong>
                        {revision.reason === "initial" ? "First version" : "Revised after discussion"}
                        {current && <em>Current</em>}
                      </strong>
                      <small>{new Date(revision.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                      {titles.length > 0 && (
                        <small className="version-changes" lang={lang}><Sparkles aria-hidden="true" size={10} /> {titles.join(", ")}</small>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="panel-actions">
        {error && <p className="error-message" role="alert">{error}</p>}
        {preparedCount > 0 && (
          <button type="button" className="secondary-button send-prepared" disabled={agentPending} onClick={onSendPrepared}>
            {agentPending ? <LoaderCircle className="spin" aria-hidden="true" size={15} /> : <Send aria-hidden="true" size={15} />}
            {agentPending
              ? "AI agent is responding"
              : `Send ${preparedCount} prepared discussion${preparedCount === 1 ? "" : "s"}`}
          </button>
        )}
        <button type="button" className="primary-button" disabled={preparedCount > 0} onClick={onReview}>
          Review and confirm <ArrowRight aria-hidden="true" size={16} />
        </button>
        {preparedCount > 0 && (
          <p className="action-hint">Send or clear your prepared discussions before confirming.</p>
        )}
        <button type="button" className="cancel-button" onClick={onCancel}>
          <CircleX aria-hidden="true" size={14} /> Cancel session
        </button>
      </footer>
    </aside>
  );
}
