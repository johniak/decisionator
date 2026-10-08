import clsx from "clsx";
import { Bot, Info, Lightbulb, MinusCircle, PenLine, RotateCcw, Sparkles, SkipForward, ThumbsDown, ThumbsUp } from "lucide-react";
import type { MouseEvent } from "react";
import type { DecisionGroup, DecisionOption } from "../../src/domain/decision";
import type { DraftAttachment } from "../attachments";
import {
  addAttachment,
  chooseOption,
  chooseOther,
  fieldAttachments,
  skipGroup,
  withFieldAttachments,
  type DraftAttachmentField,
  type GroupDraft,
} from "../draft";
import { MockupView, type AssetResolver } from "../mockups/MockupView";
import type { GroupStatus } from "../status";
import { AttachmentControls } from "./Attachments";
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
  unreadReply?: boolean;
  language?: string;
  readOnly?: boolean;
  active?: boolean;
  agentPending: boolean;
  revision?: { number: number; changes: string[] };
  removedSelections?: string[];
  resolveAsset: AssetResolver;
  onChange: (draft: GroupDraft) => void;
  /** Applies a change to the latest draft, for images that finish loading after other edits. */
  onUpdate: (update: (draft: GroupDraft) => GroupDraft) => void;
  onSend: () => void;
  onActivate: () => void;
};

export type ImageHandlers = {
  add: (field: DraftAttachmentField, attachment: DraftAttachment) => void;
  remove: (field: DraftAttachmentField, id: string) => void;
};

export function groupCardId(id: string): string {
  return `group-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function GroupCard({
  group,
  index,
  draft,
  status,
  unreadReply = false,
  language,
  readOnly = false,
  active = false,
  agentPending,
  revision,
  removedSelections = [],
  resolveAsset,
  onChange,
  onUpdate,
  onSend,
  onActivate,
}: Props) {
  const images: ImageHandlers = {
    add: (field, attachment) => onUpdate((current) => {
      // An image is an answer too, like typing: it clears a skip and selects Other.
      const base = field === "otherText" && !current.otherSelected ? chooseOther(group, current)
        : field === "text" || field === "otherText" ? { ...current, skipped: false } : current;
      return withFieldAttachments(base, field, addAttachment(fieldAttachments(base, field), attachment));
    }),
    remove: (field, id) => onUpdate((current) => withFieldAttachments(
      current,
      field,
      fieldAttachments(current, field).filter((attachment) => attachment.id !== id),
    )),
  };
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
          {unreadReply && status !== "agent_replied" && (
            <span className="status-badge status-agent_replied"><Bot aria-hidden="true" size={12} /> New reply</span>
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
        <div className="text-answer">
          <label htmlFor={`${groupCardId(group.id)}-answer`}><PenLine aria-hidden="true" size={13} /> Your answer</label>
          <AttachmentControls
            label="your answer"
            attachments={fieldAttachments(draft, "text")}
            disabled={readOnly}
            onAdd={(attachment) => images.add("text", attachment)}
            onRemove={(id) => images.remove("text", id)}
          >
            {(handlers) => (
              <textarea
                id={`${groupCardId(group.id)}-answer`}
                rows={4}
                value={draft.text}
                disabled={readOnly}
                placeholder="Write your answer…"
                onChange={(event) => onChange({ ...draft, text: event.target.value, skipped: false })}
                {...handlers}
              />
            )}
          </AttachmentControls>
        </div>
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
            <OtherOption group={group} draft={draft} readOnly={readOnly} images={images} onChange={onChange} />
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
          <div className="comment-field">
            <label htmlFor={`${groupCardId(group.id)}-comment`}>Comment for the AI agent <small>Sent only when you confirm</small></label>
            <AttachmentControls
              label="your comment"
              attachments={fieldAttachments(draft, "comment")}
              onAdd={(attachment) => images.add("comment", attachment)}
              onRemove={(id) => images.remove("comment", id)}
            >
              {(handlers) => (
                <textarea
                  id={`${groupCardId(group.id)}-comment`}
                  rows={2}
                  value={draft.comment}
                  data-shortcut="comment"
                  placeholder="Add context, a condition, or a concern…"
                  onChange={(event) => onChange({ ...draft, comment: event.target.value })}
                  {...handlers}
                />
              )}
            </AttachmentControls>
          </div>
        </div>
      )}

      <DiscussionThread
        group={group}
        draft={draft}
        readOnly={readOnly}
        agentPending={agentPending}
        language={language}
        images={images}
        resolveAsset={resolveAsset}
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
  images,
  onChange,
}: {
  group: DecisionGroup;
  draft: GroupDraft;
  readOnly: boolean;
  images: ImageHandlers;
  onChange: (draft: GroupDraft) => void;
}) {
  const inputId = `${groupCardId(group.id)}-other`;
  const field = (handlers: object) => (
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
      {...handlers}
    />
  );
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
      {/* Always wrapped, so the field keeps focus when typing selects Other. */}
      <AttachmentControls
        label="your Other answer"
        attachments={fieldAttachments(draft, "otherText")}
        disabled={readOnly || !draft.otherSelected}
        onAdd={(attachment) => images.add("otherText", attachment)}
        onRemove={(id) => images.remove("otherText", id)}
      >
        {field}
      </AttachmentControls>
    </div>
  );
}
