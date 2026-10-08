import type { DecisionDocument, DecisionGroup } from "../src/domain/decision";
import { groupDraft, hasAnswer, type Draft } from "./draft";

export type GroupStatus = "pending" | "answered" | "waiting_for_agent" | "agent_replied" | "skipped";

export const statusLabels: Record<GroupStatus, string> = {
  pending: "No answer yet",
  answered: "Answered",
  waiting_for_agent: "Waiting for agent",
  agent_replied: "Agent replied",
  skipped: "Skipped",
};

export function groupStatus(group: DecisionGroup, draft: Draft): GroupStatus {
  const last = group.thread.messages.at(-1);
  if (last?.author === "user") return "waiting_for_agent";
  if (last?.author === "agent" && !draft.seenMessageIds.includes(last.id)) return "agent_replied";
  const current = groupDraft(draft, group.id);
  if (hasAnswer(group, current)) return "answered";
  if (current.skipped) return "skipped";
  return "pending";
}

export function progressSummary(document: DecisionDocument, draft: Draft): string {
  const statuses = document.groups.map((group) => groupStatus(group, draft));
  const answered = document.groups.filter((group) => hasAnswer(group, groupDraft(draft, group.id))).length;
  const parts = [`${answered} of ${document.groups.length} answered`];
  const waiting = statuses.filter((status) => status === "waiting_for_agent").length;
  const replied = statuses.filter((status) => status === "agent_replied").length;
  const skipped = document.groups.filter((group) => groupDraft(draft, group.id).skipped).length;
  if (waiting) parts.push(`${waiting} waiting for agent`);
  if (replied) parts.push(`${replied} new ${replied === 1 ? "reply" : "replies"}`);
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(", ");
}
