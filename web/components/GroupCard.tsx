import clsx from "clsx";
import { Info, Lightbulb, MinusCircle, PenLine, RotateCcw, Sparkles, SkipForward, ThumbsDown, ThumbsUp } from "lucide-react";
import type { MouseEvent } from "react";
import type { DecisionGroup, DecisionOption } from "../../src/domain/decision";
import { chooseOption, chooseOther, skipGroup, type GroupDraft } from "../draft";
import { MockupView, type AssetResolver } from "../mockups/MockupView";
import type { GroupStatus } from "../status";
import { DiscussionThread } from "./DiscussionThread";
import { Markdown } from "./Markdown";
import { StatusBadge } from "./StatusBadge";

export const optionLetters = ["A", "B", "C", "D"];

const modeHints: Record<DecisionGroup["mode"], string> = {
  single: "Choose one",
  multi: "Choose any that apply",
  text: "Write your answer",
};

const changeLabels: Record<string, string> = {
  added: "new question",
  title: "title",
  context: "context",
  mode: "answer type",
  options: "options",
  recommendation: "recommendation",
  allowOther: "Other answer",
  mockup: "mockup",
};

type Props = {
  group: DecisionGroup;
  index: number;
  draft: GroupDraft;
  status: GroupStatus;
  language?: string;
  readOnly?: boolean;
  active?: boolean;
  agentPending: boolean;
  revision?: { number: number; changes: string[] };
  removedSelections?: string[];
  resolveAsset: AssetResolver;
  onChange: (draft: GroupDraft) => void;
  onSend: () => void;
  onActivate: () => void;
};

export function groupCardId(id: string): string {
  return `group-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function GroupCard({
  group,
  index,
  draft,
  status,
  language,
  readOnly = false,
  active = false,
  agentPending,
  revision,
  removedSelections = [],
  resolveAsset,
  onChange,
  onSend,
  onActivate,
}: Props) {
  const recommendedLabels = group.options
    .filter((option) => group.recommendation?.optionIds.includes(option.id))
    .map(({ label }) => label);
  const wide = Boolean(group.options.some((option) => option.mockup));

  return (
    <article
      id={groupCardId(group.id)}
      className={clsx("group-card", `group-${status}`, active && "active", revision && "revised", readOnly && "read-only")}
      tabIndex={-1}
      aria-labelledby={`${groupCardId(group.id)}-title`}
      onFocusCapture={onActivate}
      onPointerDown={onActivate}
    >
      <header className="group-card-header">
        <span className="group-number" aria-hidden="true">{index + 1}</span>
        <div className="group-heading">
          <h2 id={`${groupCardId(group.id)}-title`} lang={language}>{group.title}</h2>
          <span className="group-mode">{modeHints[group.mode]}</span>
        </div>
        <div className="group-badges">
          {revision && (
            <span className="revised-badge" title={`Changed: ${revision.changes.map((change) => changeLabels[change] ?? change).join(", ")}`}>
              <Sparkles aria-hidden="true" size={12} /> Revised in version {revision.number}
            </span>
          )}
          {!readOnly && <StatusBadge status={status} />}
        </div>
      </header>

      {revision && (
        <p className="revision-note">
          The AI agent changed the {revision.changes.map((change) => changeLabels[change] ?? change).join(", ")}.
        </p>
      )}
      {removedSelections.map((label) => (
        <p key={label} className="removed-selection" role="status">
          <Info aria-hidden="true" size={13} /> Your previous choice “{label}” is no longer an option. Choose again.
        </p>
      ))}

      <Markdown className="markdown group-context" lang={language}>{group.context}</Markdown>
      {group.mockup && <MockupView mockup={group.mockup} title={`${group.title} mockup`} resolveAsset={resolveAsset} />}

      {group.mode === "text" ? (
        <label className="text-answer">
          <span><PenLine aria-hidden="true" size={13} /> Your answer</span>
          <textarea
            rows={4}
            value={draft.text}
            disabled={readOnly}
            placeholder="Write your answer…"
            onChange={(event) => onChange({ ...draft, text: event.target.value, skipped: false })}
          />
        </label>
      ) : (
        <div
          className={clsx("option-list", wide && "wide")}
          role={group.mode === "single" ? "radiogroup" : "group"}
          aria-label={`${group.title} options`}
        >
          {group.options.map((option, optionIndex) => (
            <OptionCard
              key={option.id}
              group={group}
              option={option}
              letter={optionLetters[optionIndex]!}
              selected={draft.selectedOptionIds.includes(option.id)}
              readOnly={readOnly}
              language={language}
              resolveAsset={resolveAsset}
              onChoose={() => onChange(chooseOption(group, draft, option.id))}
            />
          ))}
          {group.allowOther && (
            <OtherOption group={group} draft={draft} readOnly={readOnly} onChange={onChange} />
          )}
        </div>
      )}

      {group.recommendation && (
        <p className="recommendation-note" lang={language}>
          <Lightbulb aria-hidden="true" size={14} />
          <span>
            <strong>The agent recommends {recommendedLabels.join(" and ")}.</strong> {group.recommendation.text}
          </span>
        </p>
      )}

      {!readOnly && (
        <div className="group-footer">
          {draft.skipped ? (
            <p className="skipped-note">
              <SkipForward aria-hidden="true" size={13} />
              {recommendedLabels.length > 0
                ? `Skipped. The agent will use its recommendation: ${recommendedLabels.join(", ")}.`
                : "Skipped. No decision will be recorded for this question."}
              <button type="button" className="text-button" onClick={() => onChange({ ...draft, skipped: false })}>
                <RotateCcw aria-hidden="true" size={12} /> Undo
              </button>
            </p>
          ) : (
            <button type="button" className="text-button subtle" onClick={() => onChange(skipGroup(draft))}>
              <SkipForward aria-hidden="true" size={13} />
              {recommendedLabels.length > 0 ? "Skip and use the recommendation" : "Skip this question"}
            </button>
          )}
          <label className="comment-field">
            <span>Comment for the AI agent <small>Sent only when you confirm</small></span>
            <textarea
              rows={2}
              value={draft.comment}
              data-shortcut="comment"
              placeholder="Add context, a condition, or a concern…"
              onChange={(event) => onChange({ ...draft, comment: event.target.value })}
            />
          </label>
        </div>
      )}

      <DiscussionThread
        group={group}
        draft={draft}
        readOnly={readOnly}
        agentPending={agentPending}
        language={language}
        onChange={onChange}
        onSend={onSend}
      />
    </article>
  );
}

function isInteractive(event: MouseEvent): boolean {
  return Boolean((event.target as HTMLElement).closest("a, button, input, textarea, label, figure, .mockup"));
}

function OptionCard({
  group,
  option,
  letter,
  selected,
  readOnly,
  language,
  resolveAsset,
  onChoose,
}: {
  group: DecisionGroup;
  option: DecisionOption;
  letter: string;
  selected: boolean;
  readOnly: boolean;
  language?: string;
  resolveAsset: AssetResolver;
  onChoose: () => void;
}) {
  const inputId = `${groupCardId(group.id)}-option-${option.id}`;
  return (
    <div
      className={clsx("option-card", selected && "selected", option.recommended && "recommended")}
      data-option-id={option.id}
      onClick={(event) => {
        if (!readOnly && !isInteractive(event)) onChoose();
      }}
    >
      <label className="option-choice" htmlFor={inputId}>
        <input
          id={inputId}
          type={group.mode === "single" ? "radio" : "checkbox"}
          name={`group-${group.id}`}
          checked={selected}
          disabled={readOnly}
          onChange={onChoose}
        />
        <span className="option-letter" aria-hidden="true">{letter}</span>
        <span className="option-label" lang={language}>{option.label}</span>
        {option.recommended && <span className="recommended-label">Recommended</span>}
      </label>
      <Markdown className="markdown option-description" lang={language}>{option.description}</Markdown>
      {(option.pros?.length || option.cons?.length) ? (
        <div className="trade-offs" lang={language}>
          {option.pros?.length ? (
            <ul className="pros" aria-label="Pros">
              {option.pros.map((item) => <li key={item}><ThumbsUp aria-hidden="true" size={12} />{item}</li>)}
            </ul>
          ) : null}
          {option.cons?.length ? (
            <ul className="cons" aria-label="Cons">
              {option.cons.map((item) => <li key={item}><ThumbsDown aria-hidden="true" size={12} />{item}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {option.mockup && <MockupView mockup={option.mockup} title={`${option.label} mockup`} resolveAsset={resolveAsset} />}
    </div>
  );
}

function OtherOption({
  group,
  draft,
  readOnly,
  onChange,
}: {
  group: DecisionGroup;
  draft: GroupDraft;
  readOnly: boolean;
  onChange: (draft: GroupDraft) => void;
}) {
  const inputId = `${groupCardId(group.id)}-other`;
  return (
    <div className={clsx("option-card other-option", draft.otherSelected && "selected")}>
      <label className="option-choice" htmlFor={inputId}>
        <input
          id={inputId}
          type={group.mode === "single" ? "radio" : "checkbox"}
          name={`group-${group.id}`}
          checked={draft.otherSelected}
          disabled={readOnly}
          onChange={() => onChange(chooseOther(group, draft))}
        />
        <span className="option-letter" aria-hidden="true"><MinusCircle size={12} /></span>
        <span className="option-label">Other</span>
      </label>
      <input
        className="other-input"
        type="text"
        aria-label={`Other answer for ${group.title}`}
        data-shortcut="other"
        value={draft.otherText}
        disabled={readOnly}
        placeholder="Describe your own answer…"
        onChange={(event) => {
          const next = draft.otherSelected ? draft : chooseOther(group, draft);
          onChange({ ...next, otherSelected: true, otherText: event.target.value });
        }}
      />
    </div>
  );
}
