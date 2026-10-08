import { Bot, CheckCircle2, Circle, LoaderCircle, SkipForward } from "lucide-react";
import { statusLabels, type GroupStatus } from "../status";

const icons = {
  pending: Circle,
  answered: CheckCircle2,
  waiting_for_agent: LoaderCircle,
  agent_replied: Bot,
  skipped: SkipForward,
} as const;

export function StatusBadge({ status }: { status: GroupStatus }) {
  const Icon = icons[status];
  return (
    <span className={`status-badge status-${status}`}>
      <Icon aria-hidden="true" size={12} className={status === "waiting_for_agent" ? "spin" : undefined} />
      {statusLabels[status]}
    </span>
  );
}
