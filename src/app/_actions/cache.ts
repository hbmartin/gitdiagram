"use server";

import type { DiagramStateResponse } from "~/features/diagram/types";
import {
  getDiagramStateRecord,
  recordLatestSessionRenderError,
} from "~/server/storage/diagram-state";

export async function getDiagramState(
  username: string,
  repo: string,
  githubPat?: string,
  variant?: { ref?: string | null; subdir?: string | null },
): Promise<DiagramStateResponse> {
  try {
    return await getDiagramStateRecord(username, repo, githubPat, variant);
  } catch (error) {
    console.error("Error fetching diagram state:", error);
    return {
      diagram: null,
      explanation: null,
      graph: null,
      latestSessionAudit: null,
      lastSuccessfulAt: null,
    };
  }
}

export async function persistDiagramRenderError(
  username: string,
  repo: string,
  renderError: string,
  githubPat?: string,
  variant?: { ref?: string | null; subdir?: string | null },
) {
  try {
    await recordLatestSessionRenderError({
      username,
      repo,
      githubPat,
      renderError,
      variant,
    });
  } catch (error) {
    console.error("Error recording diagram render error:", error);
  }
}
