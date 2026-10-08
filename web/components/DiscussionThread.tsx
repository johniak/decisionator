import { Bot, CircleX, LoaderCircle, MessageSquareText, Send, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { DecisionGroup } from "../../src/domain/decision";
import type { GroupDraft } from "../draft";

type Props = {
  group: DecisionGroup;
  draft: GroupDraft;
  readOnly?: boolean;
  agentPending: boolean;
  language?: string;
  onChange: (draft: GroupDraft) => void;
  onSend: () => void;
};

export function DiscussionThread({ group, draft, readOnly = false, agentPending, language, onChange, onSend }: Props) {
  const messages = group.thread.messages;
  const waiting = messages.at(-1)?.author === "user";
  const [composerOpen, setComposerOpen] = useState(false);
  const showComposer = !readOnly && !waiting && !draft.dismissing && (composerOpen || draft.message.length > 0);
  const fieldId = `discussion-${group.id}`;
  const canSend = draft.message.trim().length > 0 && !agentPending;

  if (readOnly && messages.length === 0) return null;

  return (
    <section className="discussion" aria-label={`Discussion about ${group.title}`}>
      {messages.length > 0 && (
        <div className="discussion-heading">
          <span><MessageSquareText aria-hidden="true" size={14} /> Private discussion with the AI agent</span>
        </div>
      )}
      {messages.length > 0 && (
        <ol className="discussion-timeline">
          {messages.map((message) => (
            <li key={message.id} className={`discussion-message discussion-${message.author}`}>
              <span className="discussion-avatar" aria-hidden="true">
                {message.author === "user" ? <UserRound size={13} /> : <Bot size={13} />}
              </span>
              <div>
                <strong>{message.author === "user" ? "You" : "AI agent"}</strong>
                <p lang={message.author === "agent" ? language : undefined}>{message.body}</p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {waiting && (
        <p className="discussion-waiting" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={13} /> The AI agent is answering this discussion.
        </p>
      )}

      {group.thread.dismissed && group.thread.dismissalReason && (
        <p className="discussion-dismissed"><CircleX aria-hidden="true" size={13} /> You dismissed this discussion: {group.thread.dismissalReason}</p>
      )}

      {!readOnly && draft.dismissing && (
        <div className="dismissal-field">
          <label htmlFor={`${fieldId}-dismissal`}>
            <span>Why are you closing this discussion?</span>
            <textarea
              id={`${fieldId}-dismissal`}
              rows={2}
              value={draft.dismissalReason}
              placeholder="For example: the reply answered my question."
              onChange={(event) => onChange({ ...draft, dismissalReason: event.target.value })}
              autoFocus
            />
          </label>
          <small>The dismissal and your reason are sent with your decisions.</small>
          <button type="button" className="text-button" onClick={() => onChange({ ...draft, dismissing: false, dismissalReason: "" })}>
            <X aria-hidden="true" size={13} /> Keep discussion
          </button>
        </div>
      )}

      {showComposer && (
        <div className="discussion-composer">
          <label htmlFor={fieldId}>
            {messages.length > 0 ? "Reply to the AI agent" : "Ask the AI agent about this decision"}
          </label>
          <textarea
            id={fieldId}
            rows={3}
            value={draft.message}
            placeholder="Ask for another option, a clearer trade-off, or a different mockup…"
            onChange={(event) => onChange({ ...draft, message: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && canSend) {
                event.preventDefault();
                onSend();
              }
            }}
            autoFocus={composerOpen}
          />
          <div className="discussion-composer-actions">
            <small>Only this discussion is sent. Your answer and comment stay here until you confirm.</small>
            <button type="button" className="send-button" disabled={!canSend} onClick={onSend}>
              {agentPending ? <LoaderCircle className="spin" aria-hidden="true" size={13} /> : <Send aria-hidden="true" size={13} />}
              {agentPending ? "AI agent is responding" : "Send to AI"}
            </button>
          </div>
        </div>
      )}

      {!readOnly && !waiting && !draft.dismissing && (
        <div className="discussion-actions">
          {!showComposer && (
            <button type="button" className="text-button" data-shortcut="discuss" onClick={() => setComposerOpen(true)}>
              <MessageSquareText aria-hidden="true" size={13} />
              {messages.length > 0 ? "Reply to the AI agent" : "Discuss with AI"}
            </button>
          )}
          {messages.length > 0 && (
            <button type="button" className="text-button subtle" onClick={() => onChange({ ...draft, dismissing: true, message: "" })}>
              <CircleX aria-hidden="true" size={13} /> Dismiss discussion
            </button>
          )}
        </div>
      )}
    </section>
  );
}
