import type { GenerationSessionAudit } from "~/features/diagram/graph";

export type ArtifactVisibility = "public" | "private";

export interface DiagramArtifact {
  version: 1;
  visibility: ArtifactVisibility;
  username: string;
  repo: string;
  stargazerCount: number | null;
  diagram: string;
  explanation: string;
  graph: GenerationSessionAudit["graph"];
  generatedAt: string;
  usedOwnKey: boolean;
  latestSessionSummary: GenerationSessionAudit;
  lastSuccessfulAt: string;
  /** Branch, tag, or commit the diagram was generated against (absent for older artifacts). */
  ref?: string | null;
  /** Subdirectory scope, or null for the whole repository. */
  subdir?: string | null;
  /** Commit SHA the generation snapshot was taken at. */
  commitSha?: string | null;
}

export interface StoredFailureSummary {
  version: 1;
  visibility: ArtifactVisibility;
  username: string;
  repo: string;
  latestSessionSummary: GenerationSessionAudit;
}
