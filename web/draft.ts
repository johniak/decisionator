import type { DecisionDocument, DecisionGroup } from "../src/domain/decision";
import type { ConfirmRequest } from "../src/domain/protocol";

export type GroupDraft = {
  selectedOptionIds: string[];
  otherSelected: boolean;
  otherText: string;
  text: string;
  comment: string;
  skipped: boolean;
  message: string;
  dismissing: boolean;
  dismissalReason: string;
};

export type AssumptionDraft = {
  objecting: boolean;
  objection: string;
};

export type Draft = {
  groups: Record<string, GroupDraft>;
  assumptions: Record<string, AssumptionDraft>;
  globalComment: string;
  seenMessageIds: string[];
};

export const emptyGroupDraft: GroupDraft = {
  selectedOptionIds: [],
  otherSelected: false,
  otherText: "",
  text: "",
  comment: "",
  skipped: false,
  message: "",
  dismissing: false,
  dismissalReason: "",
};

export const emptyDraft: Draft = { groups: {}, assumptions: {}, globalComment: "", seenMessageIds: [] };

export function draftStorageKey(sessionId: string): string {
  return `decisionator:draft:${sessionId}`;
}

export function loadDraft(storage: Storage | undefined, sessionId: string): Draft {
  try {
    const raw = storage?.getItem(draftStorageKey(sessionId));
    if (!raw) return emptyDraft;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      groups: Object.fromEntries(Object.entries(parsed.groups ?? {}).map(([id, group]) => [id, { ...emptyGroupDraft, ...group }])),
      assumptions: parsed.assumptions ?? {},
      globalComment: parsed.globalComment ?? "",
      seenMessageIds: parsed.seenMessageIds ?? [],
    };
  } catch {
    return emptyDraft;
  }
}

export function saveDraft(storage: Storage | undefined, sessionId: string, draft: Draft): void {
  try {
    storage?.setItem(draftStorageKey(sessionId), JSON.stringify(draft));
  } catch {
    // A full or blocked storage must never break answering; the draft stays in memory.
  }
}

export function clearDraft(storage: Storage | undefined, sessionId: string): void {
  try {
    storage?.removeItem(draftStorageKey(sessionId));
  } catch {
    // Ignore blocked storage.
  }
}

export function groupDraft(draft: Draft, groupId: string): GroupDraft {
  return draft.groups[groupId] ?? emptyGroupDraft;
}

export type RemovedSelection = { groupId: string; label: string };

/**
 * Keeps the human's draft valid after the agent revises the document: choices that no
 * longer exist are dropped and reported, everything else is preserved.
 */
export function reconcileDraft(
  draft: Draft,
  document: DecisionDocument,
  labelsBefore: Record<string, Record<string, string>> = {},
): { draft: Draft; removed: RemovedSelection[] } {
  const removed: RemovedSelection[] = [];
  const groups: Record<string, GroupDraft> = {};
  for (const group of document.groups) {
    const current = draft.groups[group.id];
    if (!current) continue;
    const optionIds = new Set(group.options.map(({ id }) => id));
    const kept = current.selectedOptionIds.filter((id) => optionIds.has(id));
    for (const id of current.selectedOptionIds.filter((value) => !optionIds.has(value))) {
      removed.push({ groupId: group.id, label: labelsBefore[group.id]?.[id] ?? id });
    }
    const otherAllowed = group.allowOther;
    groups[group.id] = {
      ...current,
      selectedOptionIds: group.mode === "single" ? kept.slice(0, 1) : kept,
      otherSelected: otherAllowed && current.otherSelected,
      otherText: otherAllowed ? current.otherText : "",
      text: group.mode === "text" ? current.text : "",
      dismissing: group.thread.messages.length > 0 && current.dismissing,
    };
  }
  const assumptionIds = new Set(document.assumptions.map(({ id }) => id));
  const assumptions = Object.fromEntries(Object.entries(draft.assumptions).filter(([id]) => assumptionIds.has(id)));
  return { draft: { ...draft, groups, assumptions }, removed };
}

export function hasAnswer(group: DecisionGroup, draft: GroupDraft): boolean {
  if (group.mode === "text") return draft.text.trim().length > 0;
  const other = draft.otherSelected && draft.otherText.trim().length > 0;
  return draft.selectedOptionIds.length > 0 || other;
}

export function unansweredGroups(document: DecisionDocument, draft: Draft): DecisionGroup[] {
  return document.groups.filter((group) => {
    const current = groupDraft(draft, group.id);
    return !current.skipped && !hasAnswer(group, current);
  });
}

export function preparedDiscussions(
  document: DecisionDocument,
  draft: Draft,
): { groupId: string; message: string }[] {
  return document.groups
    .filter((group) => group.thread.messages.at(-1)?.author !== "user" && !groupDraft(draft, group.id).dismissing)
    .map((group) => ({ groupId: group.id, message: groupDraft(draft, group.id).message.trim() }))
    .filter(({ message }) => message.length > 0);
}

export function toConfirmRequest(document: DecisionDocument, documentVersion: number, draft: Draft): ConfirmRequest {
  return {
    confirmed: true,
    documentVersion,
    groups: document.groups.map((group) => {
      const current = groupDraft(draft, group.id);
      const dismissalReason = current.dismissing ? current.dismissalReason.trim() : "";
      const comment = current.comment.trim();
      if (current.skipped) return { groupId: group.id, skipped: true, comment, dismissalReason };
      const otherText = group.allowOther && current.otherSelected ? current.otherText.trim() : "";
      if (group.mode === "text") return { groupId: group.id, text: current.text.trim(), comment, dismissalReason };
      return {
        groupId: group.id,
        selectedOptionIds: group.mode === "single" && otherText ? [] : current.selectedOptionIds,
        otherText,
        comment,
        dismissalReason,
      };
    }),
    assumptions: document.assumptions.map((assumption) => {
      const current = draft.assumptions[assumption.id];
      return current?.objecting
        ? { id: assumption.id, accepted: false, objection: current.objection.trim() }
        : { id: assumption.id, accepted: true };
    }),
    globalComment: draft.globalComment.trim(),
  };
}

export function chooseOption(group: DecisionGroup, current: GroupDraft, optionId: string): GroupDraft {
  if (group.mode === "single") {
    return { ...current, selectedOptionIds: [optionId], otherSelected: false, skipped: false };
  }
  const selected = current.selectedOptionIds.includes(optionId)
    ? current.selectedOptionIds.filter((id) => id !== optionId)
    : [...current.selectedOptionIds, optionId];
  return { ...current, selectedOptionIds: selected, skipped: false };
}

export function chooseOther(group: DecisionGroup, current: GroupDraft): GroupDraft {
  if (group.mode === "single") return { ...current, selectedOptionIds: [], otherSelected: true, skipped: false };
  return { ...current, otherSelected: !current.otherSelected, skipped: false };
}

export function skipGroup(current: GroupDraft): GroupDraft {
  return { ...current, selectedOptionIds: [], otherSelected: false, otherText: "", text: "", skipped: true };
}
