import { CheckCircle2, CircleX, Eye, Keyboard, LoaderCircle, Radio, Send, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DecisionDocument } from "../src/domain/decision";
import type { CancelledResult, ConfirmRequest, ConfirmedResult } from "../src/domain/protocol";
import { api, ApiError } from "./api";
import { AttachmentContext, browserAttachmentBlobs, type AttachmentBlobs } from "./attachments";
import { AttachmentControls } from "./components/Attachments";
import { AnswersPanel } from "./components/AnswersPanel";
import { AssumptionsSection } from "./components/AssumptionsSection";
import { ConfirmDialog, ResultSummary } from "./components/ConfirmDialog";
import { CancelDialog, ShortcutsDialog } from "./components/Dialogs";
import { GroupCard, groupCardId } from "./components/GroupCard";
import { GroupNavigation } from "./components/GroupNavigation";
import { Markdown } from "./components/Markdown";
import {
  addAttachment,
  chooseOption,
  clearDraft,
  discussionRequest,
  emptyDraft,
  groupDraft,
  loadDraft,
  preparedDiscussions,
  reconcileDraft,
  saveDraft,
  skipGroup,
  withFieldAttachments,
  type Draft,
  type GroupDraft,
  type PreparedDiscussion,
} from "./draft";
import { languageTag } from "./language";
import { groupStatus, hasUnreadReply, progressSummary, type GroupStatus } from "./status";
import type { SessionSnapshot } from "./types";

type Completion = ConfirmedResult | CancelledResult | { status: "discussion" };

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function optionLabels(document: DecisionDocument): Record<string, Record<string, string>> {
  return Object.fromEntries(document.groups.map((group) => [
    group.id,
    Object.fromEntries(group.options.map((option) => [option.id, option.label])),
  ]));
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function App({ storage = browserStorage(), attachmentBlobs }: { storage?: Storage; attachmentBlobs?: AttachmentBlobs }) {
  const [blobs] = useState(() => attachmentBlobs ?? browserAttachmentBlobs());
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [removedSelections, setRemovedSelections] = useState<Record<string, string[]>>({});
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [viewedVersion, setViewedVersion] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<"answers" | "history">("answers");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const known = useRef<SessionSnapshot | null>(null);
  const draftRef = useRef<Draft>(draft);
  draftRef.current = draft;

  const applySession = useCallback((next: SessionSnapshot) => {
    const previous = known.current;
    known.current = next;
    setSession(next);
    if (!previous) {
      const restored = reconcileDraft(loadDraft(storage, next.sessionId, next.document), next.document);
      setDraft(restored.draft);
      setActiveGroupId(next.document.groups[0]?.id ?? null);
      return;
    }
    if (next.documentVersion === previous.documentVersion) return;
    const { draft: reconciled, removed } = reconcileDraft(draftRef.current, next.document, optionLabels(previous.document));
    const byGroup: Record<string, string[]> = {};
    for (const item of removed) (byGroup[item.groupId] ??= []).push(item.label);
    setRemovedSelections(byGroup);
    setDraft(reconciled);
  }, [storage]);

  const reload = useCallback(() => {
    api.loadSession().then(applySession).catch(() => {});
  }, [applySession]);

  useEffect(() => {
    api.loadSession()
      .then(applySession)
      .catch((error: unknown) => setLoadingError(error instanceof Error ? error.message : "Could not load the decisions."));
  }, [applySession]);

  useEffect(() => {
    if (!session?.live || completion || typeof EventSource === "undefined") return;
    return api.subscribeToSession({
      onUpdate: () => {
        setConnectionLost(false);
        reload();
      },
      onReady: () => {
        setConnectionLost((lost) => {
          if (lost) reload();
          return false;
        });
      },
      onClosed: () => {},
      onError: () => setConnectionLost(true),
    });
  }, [session?.live, completion, reload]);

  useEffect(() => {
    if (session && !completion) saveDraft(storage, session.sessionId, draft);
  }, [draft, session, completion, storage]);

  const document = session?.document;
  const statuses = useMemo<Record<string, GroupStatus>>(
    () => Object.fromEntries((document?.groups ?? []).map((group) => [group.id, groupStatus(group, draft)])),
    [document, draft],
  );
  const prepared = document ? preparedDiscussions(document, draft) : [];
  const latestRevision = session?.revisions.at(-1);
  const viewedRevision = viewedVersion !== null ? session?.revisions[viewedVersion - 1] : undefined;
  const lang = languageTag(document?.language);

  const markSeen = useCallback((groupId: string) => {
    const group = known.current?.document.groups.find(({ id }) => id === groupId);
    const agentIds = group?.thread.messages.filter((message) => message.author === "agent").map(({ id }) => id) ?? [];
    setDraft((current) => {
      const missing = agentIds.filter((id) => !current.seenMessageIds.includes(id));
      return missing.length === 0 ? current : { ...current, seenMessageIds: [...current.seenMessageIds, ...missing] };
    });
  }, []);

  const updateGroup = useCallback((groupId: string, next: GroupDraft) => {
    setDraft((current) => ({ ...current, groups: { ...current.groups, [groupId]: next } }));
    markSeen(groupId);
  }, [markSeen]);

  const updateGroupWith = useCallback((groupId: string, update: (current: GroupDraft) => GroupDraft) => {
    setDraft((current) => ({ ...current, groups: { ...current.groups, [groupId]: update(groupDraft(current, groupId)) } }));
    markSeen(groupId);
  }, [markSeen]);

  useEffect(() => {
    // A file dropped next to a field must not make the browser leave the page.
    const keepPage = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", keepPage);
    window.addEventListener("drop", keepPage);
    return () => {
      window.removeEventListener("dragover", keepPage);
      window.removeEventListener("drop", keepPage);
    };
  }, []);

  const selectGroup = useCallback((groupId: string) => {
    setViewedVersion(null);
    setActiveGroupId(groupId);
    markSeen(groupId);
    window.requestAnimationFrame(() => {
      const element = window.document.getElementById(groupCardId(groupId));
      element?.scrollIntoView({ block: "start", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    });
  }, [markSeen]);

  useEffect(() => {
    if (!document || completion) return;
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (confirmOpen || cancelOpen || isTyping(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (shortcutsOpen || viewedVersion !== null) return;
      const index = document.groups.findIndex(({ id }) => id === activeGroupId);
      const group = document.groups[index] ?? document.groups[0];
      if (!group) return;
      const card = window.document.getElementById(groupCardId(group.id));
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const nextIndex = Math.min(document.groups.length - 1, Math.max(0, (index < 0 ? 0 : index) + (key === "j" ? 1 : -1)));
        selectGroup(document.groups[nextIndex]!.id);
      } else if (/^[1-4]$/.test(key) && group.mode !== "text") {
        const option = group.options[Number(key) - 1];
        if (!option) return;
        event.preventDefault();
        updateGroup(group.id, chooseOption(group, groupDraft(draft, group.id), option.id));
      } else if (key === "o" && group.allowOther) {
        event.preventDefault();
        card?.querySelector<HTMLInputElement>("[data-shortcut='other']")?.focus();
      } else if (key === "c") {
        event.preventDefault();
        card?.querySelector<HTMLTextAreaElement>("[data-shortcut='comment']")?.focus();
      } else if (key === "d") {
        event.preventDefault();
        card?.querySelector<HTMLButtonElement>("[data-shortcut='discuss']")?.click();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [document, draft, activeGroupId, confirmOpen, cancelOpen, shortcutsOpen, viewedVersion, completion, selectGroup, updateGroup]);

  const attachmentContext = useMemo(() => ({ blobs, sessionId: session?.sessionId ?? "" }), [blobs, session?.sessionId]);
  const withAttachments = (content: ReactNode) => (
    <AttachmentContext.Provider value={attachmentContext}>{content}</AttachmentContext.Provider>
  );

  if (loadingError) return <LoadFailure message={loadingError} />;
  if (completion) return withAttachments(<CompletionScreen completion={completion} document={document} />);
  if (!session || !document) return <LoadingScreen />;

  /** Uploads the attached images right before they are sent; the server keeps each one once. */
  async function uploadImages(references: { id: string; name: string }[]) {
    for (const reference of new Map(references.map((item) => [item.id, item])).values()) {
      const image = await blobs.get(attachmentContext.sessionId, reference.id);
      if (!image) throw new Error(`The image ${reference.name} is no longer stored in this browser. Remove it and attach it again.`);
      await api.uploadAttachment(image.bytes, image.type);
    }
  }

  async function sendDiscussions(items: PreparedDiscussion[]) {
    if (items.length === 0) return;
    setActionError(null);
    try {
      await uploadImages(items.flatMap(({ attachments }) => attachments));
      const response = await api.sendDiscussion(discussionRequest(items));
      applySession(response.session);
      setDraft((current) => {
        const groups = { ...current.groups };
        for (const { groupId } of items) {
          groups[groupId] = withFieldAttachments({ ...groupDraft(current, groupId), message: "" }, "message", []);
        }
        return { ...current, groups };
      });
      if (!response.session.live) setCompletion({ status: "discussion" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send the discussion.");
    }
  }

  async function confirm(request: ConfirmRequest) {
    if (!session) return;
    setSending(true);
    setActionError(null);
    try {
      await uploadImages([...(request.groups ?? []).flatMap((group) => group.attachments ?? []), ...(request.globalAttachments ?? [])]);
      const result = await api.confirm(request);
      clearDraft(storage, session.sessionId);
      void blobs.clear(session.sessionId);
      setConfirmOpen(false);
      setCompletion(result);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not send the decisions.");
      if (error instanceof ApiError && error.status === 409) reload();
    } finally {
      setSending(false);
    }
  }

  async function cancel() {
    if (!session) return;
    setActionError(null);
    try {
      const result = await api.cancel();
      clearDraft(storage, session.sessionId);
      void blobs.clear(session.sessionId);
      setCancelOpen(false);
      setCompletion({ status: result.status, sessionId: session.sessionId });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not cancel the session.");
    }
  }

  function skipGroups(groupIds: string[]) {
    setDraft((current) => {
      const groups = { ...current.groups };
      for (const id of groupIds) groups[id] = skipGroup(groupDraft(current, id));
      return { ...current, groups };
    });
  }

  function selectSection(id: "assumptions" | "final-comment") {
    setViewedVersion(null);
    window.requestAnimationFrame(() => {
      const element = window.document.getElementById(id);
      element?.scrollIntoView({ block: "start", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    });
  }

  const shownDocument = viewedRevision?.document ?? document;
  const shownAssets = (viewedRevision ?? latestRevision)?.assets ?? {};
  const resolveAsset = (path: string) => {
    const id = shownAssets[path];
    return id ? api.assetUrl(id) : undefined;
  };
  const revisedGroupIds = latestRevision && latestRevision.number > 1 ? latestRevision.revisedGroupIds : [];
  const objections = Object.values(draft.assumptions).filter((item) => item.objecting).length;

  return withAttachments(
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <div><strong>Decisionator</strong><span>AI options, human decisions</span></div>
        </div>
        <div className="session-heading">
          <h1 lang={lang}>{document.title}</h1>
          <span className="version-chip">Version {session.documentVersion}</span>
        </div>
        <div className="header-actions">
          {connectionLost && (
            <span className="connection-badge" role="status"><WifiOff aria-hidden="true" size={12} /> Reconnecting…</span>
          )}
          {session.live && (
            <span className={`live-session-badge ${session.agentPending ? "working" : ""}`}>
              {session.agentPending ? <LoaderCircle className="spin" aria-hidden="true" size={12} /> : <Radio aria-hidden="true" size={12} />}
              {session.agentPending ? "AI working" : "Live"}
            </span>
          )}
          <button type="button" className="icon-button" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
            <Keyboard size={17} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <GroupNavigation
          document={document}
          statuses={statuses}
          unreadGroupIds={document.groups.filter((group) => hasUnreadReply(group, draft)).map(({ id }) => id)}
          progress={progressSummary(document, draft)}
          activeGroupId={activeGroupId}
          revisedGroupIds={revisedGroupIds}
          objections={objections}
          onSelectGroup={selectGroup}
          onSelectSection={selectSection}
        />

        <main className="decision-canvas">
          <div className="decision-column">
            {viewedRevision && (
              <div className="history-banner" role="status">
                <Eye aria-hidden="true" size={15} />
                <span>You are viewing version {viewedRevision.number}. It is read-only.</span>
                <button type="button" className="text-button" onClick={() => setViewedVersion(null)}>
                  <X aria-hidden="true" size={13} /> Back to version {session.documentVersion}
                </button>
              </div>
            )}

            {shownDocument.intro && (
              <section className="intro-card">
                <Markdown lang={lang}>{shownDocument.intro}</Markdown>
              </section>
            )}

            {shownDocument.groups.map((group, index) => (
              <GroupCard
                key={`${viewedRevision?.number ?? "current"}-${group.id}`}
                group={group}
                index={index}
                draft={viewedRevision ? groupDraft(emptyDraft, group.id) : groupDraft(draft, group.id)}
                status={viewedRevision ? "pending" : statuses[group.id]!}
                unreadReply={!viewedRevision && hasUnreadReply(group, draft)}
                language={lang}
                readOnly={Boolean(viewedRevision)}
                active={!viewedRevision && activeGroupId === group.id}
                agentPending={session.agentPending}
                revision={!viewedRevision && revisedGroupIds.includes(group.id)
                  ? { number: latestRevision!.number, changes: latestRevision!.changes[group.id] ?? [] }
                  : viewedRevision?.changes[group.id]
                    ? { number: viewedRevision.number, changes: viewedRevision.changes[group.id]! }
                    : undefined}
                removedSelections={viewedRevision ? [] : removedSelections[group.id]}
                resolveAsset={resolveAsset}
                onChange={(next) => updateGroup(group.id, next)}
                onUpdate={(update) => updateGroupWith(group.id, update)}
                onSend={() => void sendDiscussions(prepared.filter(({ groupId }) => groupId === group.id))}
                onActivate={() => {
                  if (viewedRevision || activeGroupId === group.id) return;
                  setActiveGroupId(group.id);
                  markSeen(group.id);
                }}
              />
            ))}

            <AssumptionsSection
              assumptions={shownDocument.assumptions}
              drafts={draft.assumptions}
              language={lang}
              readOnly={Boolean(viewedRevision)}
              onChange={(id, next) => setDraft((current) => ({ ...current, assumptions: { ...current.assumptions, [id]: next } }))}
            />

            {!viewedRevision && (
              <section id="final-comment" className="final-comment-card" tabIndex={-1}>
                <label htmlFor="final-comment-field">Anything else the AI agent should know?</label>
                <AttachmentControls
                  label="your final comment"
                  attachments={draft.globalAttachments}
                  onAdd={(attachment) => setDraft((current) => ({
                    ...current,
                    globalAttachments: addAttachment(current.globalAttachments, attachment),
                  }))}
                  onRemove={(id) => setDraft((current) => ({
                    ...current,
                    globalAttachments: current.globalAttachments.filter((attachment) => attachment.id !== id),
                  }))}
                >
                  {(handlers) => (
                    <textarea
                      id="final-comment-field"
                      rows={3}
                      value={draft.globalComment}
                      placeholder="A constraint, a deadline, or a decision that is not listed above…"
                      onChange={(event) => setDraft((current) => ({ ...current, globalComment: event.target.value }))}
                      {...handlers}
                    />
                  )}
                </AttachmentControls>
                <small>Sent once, together with your decisions.</small>
              </section>
            )}
          </div>
        </main>

        <AnswersPanel
          document={document}
          draft={draft}
          statuses={statuses}
          revisions={session.revisions}
          viewedVersion={viewedVersion}
          tab={panelTab}
          lang={lang}
          preparedCount={prepared.length}
          agentPending={session.agentPending}
          error={confirmOpen || cancelOpen ? null : actionError}
          onTabChange={setPanelTab}
          onSelectGroup={selectGroup}
          onViewVersion={setViewedVersion}
          onSendPrepared={() => void sendDiscussions(prepared)}
          onReview={() => {
            setActionError(null);
            setViewedVersion(null);
            setConfirmOpen(true);
          }}
          onCancel={() => {
            setActionError(null);
            setCancelOpen(true);
          }}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        document={document}
        documentVersion={session.documentVersion}
        attachmentDirectory={session.attachmentDirectory}
        draft={draft}
        agentPending={session.agentPending}
        sending={sending}
        error={actionError}
        onOpenChange={setConfirmOpen}
        onSkipGroups={skipGroups}
        onGoToGroup={(groupId) => {
          setConfirmOpen(false);
          selectGroup(groupId);
        }}
        onConfirm={(request) => void confirm(request)}
      />
      <CancelDialog open={cancelOpen} error={actionError} onOpenChange={setCancelOpen} onCancel={() => void cancel()} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function LoadingScreen() {
  return <div className="centered-screen"><LoaderCircle className="spin" aria-hidden="true" /><h1>Loading decisions…</h1></div>;
}

function LoadFailure({ message }: { message: string }) {
  return (
    <div className="centered-screen failure">
      <X aria-hidden="true" />
      <h1>Could not open Decisionator</h1>
      <p>{message}</p>
    </div>
  );
}

export function CompletionScreen({ completion, document }: { completion: Completion; document?: DecisionDocument }) {
  if (completion.status === "confirmed") {
    return (
      <div className="completion-screen">
        <div className="completion-heading">
          <div className="completion-icon completion-confirmed"><CheckCircle2 /></div>
          <div>
            <h1>Decisions sent</h1>
            <p>The AI agent received the answers below and continues with them. You can close this tab.</p>
          </div>
        </div>
        {document && <ResultSummary result={completion} document={document} />}
      </div>
    );
  }
  if (completion.status === "discussion") {
    return (
      <div className="centered-screen completion-screen">
        <div className="completion-icon completion-discussion"><Send /></div>
        <h1>Discussion sent</h1>
        <p>The AI agent will answer and open Decisionator again with its reply.</p>
      </div>
    );
  }
  return (
    <div className="centered-screen completion-screen">
      <div className="completion-icon completion-cancelled"><CircleX /></div>
      <h1>Session cancelled</h1>
      <p>No decisions were sent. The AI agent is told that you cancelled.</p>
    </div>
  );
}
