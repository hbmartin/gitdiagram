import type { DiagramStateResponse } from "~/features/diagram/types";
import type { GenerationSessionAudit } from "~/features/diagram/graph";
import {
  getPrivateLocation,
  getReadLocations,
  getPublicLocation,
  type RepoVariant,
  type StorageLocation,
} from "~/server/storage/cache-key";
import { getJsonObject, putJsonObject } from "~/server/storage/r2";
import type {
  ArtifactVisibility,
  DiagramArtifact,
} from "~/server/storage/types";

export function toStoredSessionSummary(
  audit: GenerationSessionAudit,
): GenerationSessionAudit {
  return {
    sessionId: audit.sessionId,
    status: audit.status,
    stage: audit.stage,
    provider: audit.provider,
    model: audit.model,
    quotaStatus: audit.quotaStatus,
    quotaBucket: audit.quotaBucket,
    quotaDateUtc: audit.quotaDateUtc,
    actualCommittedTokens: audit.actualCommittedTokens,
    quotaResetAt: audit.quotaResetAt,
    estimatedCost: audit.estimatedCost,
    finalCost: audit.finalCost,
    sampled: audit.sampled,
    graph: audit.graph,
    graphAttempts: audit.status === "failed" ? audit.graphAttempts : [],
    stageUsages: [],
    validationError: audit.validationError,
    failureStage: audit.failureStage,
    compilerError: audit.compilerError,
    renderError: audit.renderError,
    timeline: [],
    createdAt: audit.createdAt,
    updatedAt: audit.updatedAt,
  };
}

function toDiagramStateResponse(
  artifact: DiagramArtifact,
): DiagramStateResponse {
  return {
    diagram: artifact.diagram,
    explanation: artifact.explanation,
    graph: artifact.graph,
    latestSessionAudit: artifact.latestSessionSummary,
    lastSuccessfulAt: artifact.lastSuccessfulAt,
    ref: artifact.ref ?? null,
    subdir: artifact.subdir ?? null,
    commitSha: artifact.commitSha ?? null,
  };
}

async function getArtifactForLocation(
  location: StorageLocation,
): Promise<DiagramArtifact | null> {
  return getJsonObject<DiagramArtifact>(location.bucket, location.artifactKey);
}

export async function getStoredDiagramArtifact(params: {
  username: string;
  repo: string;
  githubPat?: string;
  variant?: RepoVariant | null;
}): Promise<{
  artifact: DiagramArtifact;
  location: StorageLocation;
} | null> {
  for (const location of getReadLocations(params)) {
    const artifact = await getArtifactForLocation(location);
    if (artifact) {
      return { artifact, location };
    }
  }

  return null;
}

export async function getStoredDiagramState(params: {
  username: string;
  repo: string;
  githubPat?: string;
  variant?: RepoVariant | null;
}): Promise<DiagramStateResponse | null> {
  const result = await getStoredDiagramArtifact(params);
  if (!result) {
    return null;
  }

  return toDiagramStateResponse(result.artifact);
}

export async function getPublicDiagramPreview(params: {
  username: string;
  repo: string;
}): Promise<{
  diagram: string;
  lastSuccessfulAt: string;
} | null> {
  const artifact = await getArtifactForLocation(
    getPublicLocation(params.username, params.repo),
  );
  if (!artifact?.diagram) {
    return null;
  }

  return {
    diagram: artifact.diagram,
    lastSuccessfulAt: artifact.lastSuccessfulAt,
  };
}

export async function writeDiagramArtifact(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  stargazerCount: number | null;
  diagram: string;
  explanation: string;
  graph: GenerationSessionAudit["graph"];
  generatedAt: string;
  usedOwnKey: boolean;
  latestSessionSummary: GenerationSessionAudit;
  lastSuccessfulAt: string;
  variant?: RepoVariant | null;
  ref?: string | null;
  subdir?: string | null;
  commitSha?: string | null;
}): Promise<void> {
  const location =
    params.visibility === "private"
      ? getPrivateLocation(
          params.username,
          params.repo,
          params.githubPat ?? "",
          params.variant,
        )
      : getPublicLocation(params.username, params.repo, params.variant);

  const artifact: DiagramArtifact = {
    version: 1,
    visibility: params.visibility,
    username: params.username,
    repo: params.repo,
    stargazerCount: params.stargazerCount,
    diagram: params.diagram,
    explanation: params.explanation,
    graph: params.graph,
    generatedAt: params.generatedAt,
    usedOwnKey: params.usedOwnKey,
    latestSessionSummary: params.latestSessionSummary,
    lastSuccessfulAt: params.lastSuccessfulAt,
    ref: params.ref ?? null,
    subdir: params.subdir ?? null,
    commitSha: params.commitSha ?? null,
  };

  await putJsonObject(location.bucket, location.artifactKey, artifact);
}

export async function updateArtifactLatestSessionSummary(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  latestSessionSummary: GenerationSessionAudit;
  variant?: RepoVariant | null;
}): Promise<boolean> {
  const location =
    params.visibility === "private"
      ? getPrivateLocation(
          params.username,
          params.repo,
          params.githubPat ?? "",
          params.variant,
        )
      : getPublicLocation(params.username, params.repo, params.variant);

  const artifact = await getArtifactForLocation(location);
  if (!artifact) {
    return false;
  }

  await putJsonObject(location.bucket, location.artifactKey, {
    ...artifact,
    latestSessionSummary: params.latestSessionSummary,
  } satisfies DiagramArtifact);
  return true;
}
