import type { GenerationCostSummary } from "~/features/diagram/cost";
import type {
  DiagramGraph,
  DiagramSampleInfo,
  GenerationSessionAudit,
  GraphAttemptAudit,
} from "~/features/diagram/graph";
import { upstashCommand } from "~/server/storage/upstash";

export const PROGRESS_TTL_SECONDS = 15 * 60;

/**
 * Cumulative view of an in-flight generation, persisted to Redis so a client
 * that lost its SSE connection can reattach and continue from live state.
 */
export interface GenerationProgressSnapshot {
  sessionId: string;
  seq: number;
  status: string;
  message?: string;
  costSummary?: GenerationCostSummary;
  quotaResetAt?: string;
  explanation?: string;
  graph?: DiagramGraph;
  graphAttempts?: GraphAttemptAudit[];
  diagram?: string;
  sampled?: DiagramSampleInfo | null;
  error?: string;
  errorCode?: string;
  validationError?: string;
  failureStage?: string;
  latestSessionAudit?: GenerationSessionAudit;
  generatedAt?: string;
  updatedAt: string;
}

function progressKey(sessionId: string): string {
  return `gen:v1:progress:${encodeURIComponent(sessionId)}`;
}

export async function writeGenerationProgress(
  snapshot: GenerationProgressSnapshot,
): Promise<void> {
  await upstashCommand([
    "SET",
    progressKey(snapshot.sessionId),
    JSON.stringify(snapshot),
    "EX",
    PROGRESS_TTL_SECONDS,
  ]);
}

export async function readGenerationProgress(
  sessionId: string,
): Promise<GenerationProgressSnapshot | null> {
  const result = await upstashCommand<string | null>([
    "GET",
    progressKey(sessionId),
  ]);
  if (!result) {
    return null;
  }
  return JSON.parse(result) as GenerationProgressSnapshot;
}

export function isTerminalProgressStatus(status: string): boolean {
  return status === "complete" || status === "error";
}
