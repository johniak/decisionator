import type { DecisionDocument } from "../src/domain/decision";
import type { CancelledResult, ConfirmedResult } from "../src/domain/protocol";
import type { DocumentRevision } from "../src/server/session";

export type SessionSnapshot = {
  sessionId: string;
  live: boolean;
  version: number;
  documentVersion: number;
  document: DecisionDocument;
  revisions: DocumentRevision[];
  agentPending: boolean;
  pendingGroupIds: string[];
  attachmentDirectory: string;
  result: ConfirmedResult | CancelledResult | null;
};

export type { DocumentRevision };
