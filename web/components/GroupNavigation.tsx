import clsx from "clsx";
import { ListChecks, MessageSquareText, Sparkles } from "lucide-react";
import type { DecisionDocument } from "../../src/domain/decision";
import { languageTag } from "../language";
import { statusLabels, type GroupStatus } from "../status";

type Props = {
  document: DecisionDocument;
  statuses: Record<string, GroupStatus>;
  unreadGroupIds: string[];
  progress: string;
  activeGroupId: string | null;
  revisedGroupIds: string[];
  objections: number;
  onSelectGroup: (id: string) => void;
  onSelectSection: (id: "assumptions" | "final-comment") => void;
};

export function GroupNavigation({
  document,
  statuses,
  unreadGroupIds,
  progress,
  activeGroupId,
  revisedGroupIds,
  objections,
  onSelectGroup,
  onSelectSection,
}: Props) {
  return (
    <aside className="navigation-panel" aria-label="Decisions">
      <div className="progress-block">
        <ol className="progress-rail" aria-hidden="true">
          {document.groups.map((group) => (
            <li key={group.id} className={`rail-${statuses[group.id]}`} title={`${group.title}: ${statusLabels[statuses[group.id]!]}`} />
          ))}
        </ol>
        <p className="progress-summary" aria-live="polite">{progress}</p>
      </div>

      <nav className="group-list" aria-label="Decision groups">
        {document.groups.map((group, index) => {
          const status = statuses[group.id]!;
          return (
            <button
              key={group.id}
              type="button"
              className={clsx(`nav-${status}`, activeGroupId === group.id && "active")}
              aria-current={activeGroupId === group.id ? "true" : undefined}
              onClick={() => onSelectGroup(group.id)}
            >
              <span className="nav-number">{index + 1}</span>
              <span className="nav-identity">
                <strong lang={languageTag(document.language)}>{group.title}</strong>
                <small className={`nav-status-${status}`}>
                  {statusLabels[status]}
                  {unreadGroupIds.includes(group.id) && status !== "agent_replied" && <span className="nav-unread">New reply</span>}
                  {revisedGroupIds.includes(group.id) && <span className="nav-revised"><Sparkles aria-hidden="true" size={10} /> Revised</span>}
                </small>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="nav-sections">
        {document.assumptions.length > 0 && (
          <button type="button" onClick={() => onSelectSection("assumptions")}>
            <ListChecks aria-hidden="true" size={14} />
            <span>Assumptions</span>
            <small>{objections > 0 ? `${objections} objected` : `${document.assumptions.length} accepted`}</small>
          </button>
        )}
        <button type="button" onClick={() => onSelectSection("final-comment")}>
          <MessageSquareText aria-hidden="true" size={14} />
          <span>Final comment</span>
        </button>
      </div>
    </aside>
  );
}
