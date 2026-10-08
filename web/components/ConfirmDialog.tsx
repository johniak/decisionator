import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { ArrowLeft, Braces, Check, CheckCircle2, Hand, LoaderCircle, MessageSquareText, Send, SkipForward, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DecisionDocument } from "../../src/domain/decision";
import { attachmentPath, type AttachmentType } from "../../src/domain/images";
import { buildConfirmedResult, type ConfirmRequest, type ConfirmedResult } from "../../src/domain/protocol";
import { toConfirmRequest, unansweredGroups, type Draft } from "../draft";
import { languageTag } from "../language";
import { ResultAttachments } from "./Attachments";

type Props = {
  open: boolean;
  document: DecisionDocument;
  documentVersion: number;
  attachmentDirectory: string;
  draft: Draft;
  agentPending: boolean;
  sending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSkipGroups: (groupIds: string[]) => void;
  onGoToGroup: (groupId: string) => void;
  onConfirm: (request: ConfirmRequest) => void;
};

type Preview = { request: ConfirmRequest; result: ConfirmedResult } | { error: string };

export function buildPreview(
  document: DecisionDocument,
  documentVersion: number,
  draft: Draft,
  attachmentDirectory: string,
): Preview {
  const request = toConfirmRequest(document, documentVersion, draft);
  try {
    const locate = (reference: { id: string; type: AttachmentType }) => attachmentPath(attachmentDirectory, reference);
    return { request, result: buildConfirmedResult(document, documentVersion, request, locate) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "These decisions cannot be confirmed yet." };
  }
}

export function ConfirmDialog({
  open,
  document,
  documentVersion,
  attachmentDirectory,
  draft,
  agentPending,
  sending,
  error,
  onOpenChange,
  onSkipGroups,
  onGoToGroup,
  onConfirm,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [tab, setTab] = useState<"summary" | "json">("summary");
  const unanswered = unansweredGroups(document, draft);
  const preview = useMemo(
    () => (unanswered.length === 0 ? buildPreview(document, documentVersion, draft, attachmentDirectory) : null),
    [document, documentVersion, draft, attachmentDirectory, unanswered.length],
  );

  useEffect(() => {
    if (open) {
      setConfirmed(false);
      setTab("summary");
    }
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="confirm-dialog" aria-describedby="confirm-description">
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{unanswered.length > 0 ? "Some questions have no answer" : "Send these decisions to the AI agent?"}</Dialog.Title>
              <Dialog.Description id="confirm-description">
                {unanswered.length > 0
                  ? "Answer them, or skip them explicitly. Skipping is recorded in the result."
                  : "Nothing is sent until you confirm. This is exactly what the agent will receive."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close confirmation dialog"><X size={18} /></Dialog.Close>
          </div>

          {unanswered.length > 0 ? (
            <UnansweredStep
              document={document}
              groupIds={unanswered.map(({ id }) => id)}
              onGoToGroup={onGoToGroup}
              onSkip={() => onSkipGroups(unanswered.map(({ id }) => id))}
            />
          ) : preview && "error" in preview ? (
            <div className="dialog-content">
              <p className="error-message" role="alert"><TriangleAlert aria-hidden="true" size={14} /> {preview.error}</p>
              <div className="dialog-footer">
                <button type="button" className="secondary-button" onClick={() => onOpenChange(false)}>
                  <ArrowLeft aria-hidden="true" size={15} /> Go back and fix it
                </button>
              </div>
            </div>
          ) : preview ? (
            <>
              <div className="dialog-tabs" role="tablist" aria-label="Preview format">
                <button type="button" role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}>
                  <CheckCircle2 aria-hidden="true" size={14} /> Summary
                </button>
                <button type="button" role="tab" aria-selected={tab === "json"} onClick={() => setTab("json")}>
                  <Braces aria-hidden="true" size={14} /> Exact JSON
                </button>
              </div>
              <div className="dialog-content preview-content" role="region" aria-label="Decision preview" tabIndex={0}>
                {tab === "summary"
                  ? <ResultSummary result={preview.result} document={document} />
                  : <pre className="json-preview" data-testid="result-json">{JSON.stringify(preview.result, null, 2)}</pre>}
              </div>
              <div className="dialog-footer">
                {agentPending && (
                  <p className="warning-message">
                    <TriangleAlert aria-hidden="true" size={14} />
                    The AI agent is still answering a discussion. Its reply will not arrive after you confirm.
                  </p>
                )}
                <label className="confirm-checkbox">
                  <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                  I confirm these decisions and want to send them to the AI agent.
                </label>
                {error && <p className="error-message" role="alert">{error}</p>}
                <button
                  type="button"
                  className="primary-button"
                  disabled={!confirmed || sending}
                  onClick={() => onConfirm(preview.request)}
                >
                  {sending ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : <Send aria-hidden="true" size={16} />}
                  {sending ? "Sending decisions…" : "Send decisions"}
                </button>
              </div>
            </>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function UnansweredStep({
  document,
  groupIds,
  onGoToGroup,
  onSkip,
}: {
  document: DecisionDocument;
  groupIds: string[];
  onGoToGroup: (groupId: string) => void;
  onSkip: () => void;
}) {
  const groups = document.groups.filter(({ id }) => groupIds.includes(id));
  return (
    <div className="dialog-content">
      <ul className="unanswered-list">
        {groups.map((group) => {
          const recommended = group.options.filter((option) => group.recommendation?.optionIds.includes(option.id));
          return (
            <li key={group.id}>
              <button type="button" className="text-button" onClick={() => onGoToGroup(group.id)} lang={languageTag(document.language)}>
                {group.title}
              </button>
              <span>
                {recommended.length > 0
                  ? <>If skipped, the agent uses its recommendation: <strong lang={languageTag(document.language)}>{recommended.map(({ label }) => label).join(", ")}</strong></>
                  : "No recommendation. If skipped, no decision is recorded and the agent has to ask again."}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="dialog-footer split">
        <button type="button" className="secondary-button" onClick={() => onGoToGroup(groupIds[0]!)}>
          <ArrowLeft aria-hidden="true" size={15} /> Go back and answer
        </button>
        <button type="button" className="primary-button" onClick={onSkip}>
          <SkipForward aria-hidden="true" size={15} />
          {groups.length === 1 ? "Skip it and use the recommendation" : `Skip these ${groups.length} and use the recommendations`}
        </button>
      </div>
    </div>
  );
}

export function ResultSummary({ result, document }: { result: ConfirmedResult; document: DecisionDocument }) {
  const { answers } = result;
  return (
    <div className="result-summary" lang={languageTag(document.language)}>
      <ol className="result-groups">
        {answers.groups.map((group) => (
          <li key={group.groupId} className={clsx("result-group", group.status === "skipped" && "skipped")}>
            <div className="result-group-heading">
              <strong>{group.title}</strong>
              <span className={`result-status result-${group.status}`}>
                {group.status === "skipped" ? <SkipForward aria-hidden="true" size={12} /> : <Check aria-hidden="true" size={12} />}
                {group.status === "skipped"
                  ? group.skippedUsingRecommendation ? "Skipped, recommendation adopted" : "Skipped, no decision"
                  : "Answered"}
              </span>
            </div>
            {group.selectedOptionLabels.length > 0 && <p className="result-answer">{group.selectedOptionLabels.join(", ")}</p>}
            {group.otherText && <p className="result-answer">Other: {group.otherText}</p>}
            {group.text && <p className="result-answer">{group.text}</p>}
            {group.comment && <p className="result-comment"><MessageSquareText aria-hidden="true" size={12} /> {group.comment}</p>}
            {group.attachments.length > 0 && <ResultAttachments attachments={group.attachments} />}
            {group.thread.messages.length > 0 && (
              <p className="result-thread">
                Discussion with {group.thread.messages.length} message{group.thread.messages.length === 1 ? "" : "s"} included
                {group.thread.dismissed ? `, dismissed: ${group.thread.dismissalReason}` : ""}
              </p>
            )}
          </li>
        ))}
      </ol>
      {answers.assumptions.length > 0 && (
        <section className="result-assumptions">
          <h3>Assumptions</h3>
          <ul>
            {answers.assumptions.map((assumption) => (
              <li key={assumption.id} className={assumption.accepted ? "accepted" : "objected"}>
                {assumption.accepted ? <Check aria-hidden="true" size={13} /> : <Hand aria-hidden="true" size={13} />}
                <span>
                  {assumption.text}
                  {assumption.objection && <em>Objection: {assumption.objection}</em>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(answers.globalComment || answers.globalAttachments.length > 0) && (
        <section className="result-global-comment">
          <h3>Final comment</h3>
          {answers.globalComment && <p>{answers.globalComment}</p>}
          {answers.globalAttachments.length > 0 && <ResultAttachments attachments={answers.globalAttachments} />}
        </section>
      )}
    </div>
  );
}
