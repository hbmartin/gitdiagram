import {
  getPrivateLocation,
  getPublicLocation,
  type RepoVariant,
  type StorageLocation,
} from "~/server/storage/cache-key";
import {
  deleteObject,
  getJsonObject,
  putJsonObject,
} from "~/server/storage/r2";
import type {
  ArtifactVisibility,
  DiagramArtifact,
} from "~/server/storage/types";

export const MAX_HISTORY_ENTRIES = 20;

export interface DiagramVersionEntry {
  /** Stable identifier, the generatedAt timestamp of the version. */
  id: string;
  generatedAt: string;
  commitSha: string | null;
  ref: string | null;
  subdir: string | null;
  model: string | null;
  key: string;
}

export interface DiagramVersionIndex {
  version: 1;
  updatedAt: string;
  entries: DiagramVersionEntry[];
}

function historyBase(location: StorageLocation): string {
  return location.artifactKey.replace(/\.json$/, "");
}

export function getHistoryIndexKey(location: StorageLocation): string {
  return `${historyBase(location)}/history/index.json`;
}

export function getHistoryEntryKey(
  location: StorageLocation,
  id: string,
): string {
  return `${historyBase(location)}/history/${encodeURIComponent(id)}.json`;
}

function resolveLocation(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility?: ArtifactVisibility;
  variant?: RepoVariant | null;
}): StorageLocation {
  const visibility =
    params.visibility ?? (params.githubPat?.trim() ? "private" : "public");
  return visibility === "private"
    ? getPrivateLocation(
        params.username,
        params.repo,
        params.githubPat ?? "",
        params.variant,
      )
    : getPublicLocation(params.username, params.repo, params.variant);
}

/**
 * Record a successful generation as a new history version, keeping at most
 * MAX_HISTORY_ENTRIES entries (older versions are deleted from R2).
 */
export async function appendDiagramVersion(params: {
  username: string;
  repo: string;
  githubPat?: string;
  visibility: ArtifactVisibility;
  variant?: RepoVariant | null;
  artifact: DiagramArtifact;
}): Promise<void> {
  const location = resolveLocation(params);
  const id = params.artifact.generatedAt;
  if (!id) {
    return;
  }

  const entryKey = getHistoryEntryKey(location, id);
  await putJsonObject(location.bucket, entryKey, params.artifact);

  const indexKey = getHistoryIndexKey(location);
  const existing =
    (await getJsonObject<DiagramVersionIndex>(location.bucket, indexKey)) ??
    ({ version: 1, updatedAt: "", entries: [] } satisfies DiagramVersionIndex);

  const entry: DiagramVersionEntry = {
    id,
    generatedAt: params.artifact.generatedAt,
    commitSha: params.artifact.commitSha ?? null,
    ref: params.artifact.ref ?? null,
    subdir: params.artifact.subdir ?? null,
    model: params.artifact.latestSessionSummary?.model ?? null,
    key: entryKey,
  };

  const entries = [
    entry,
    ...existing.entries.filter((candidate) => candidate.id !== id),
  ];
  const kept = entries.slice(0, MAX_HISTORY_ENTRIES);
  const evicted = entries.slice(MAX_HISTORY_ENTRIES);

  await putJsonObject(location.bucket, indexKey, {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: kept,
  } satisfies DiagramVersionIndex);

  for (const evictedEntry of evicted) {
    try {
      await deleteObject(location.bucket, evictedEntry.key);
    } catch {
      // Best-effort cleanup; a dangling object is harmless.
    }
  }
}

export async function listDiagramVersions(params: {
  username: string;
  repo: string;
  githubPat?: string;
  variant?: RepoVariant | null;
}): Promise<DiagramVersionEntry[]> {
  const location = resolveLocation(params);
  const index = await getJsonObject<DiagramVersionIndex>(
    location.bucket,
    getHistoryIndexKey(location),
  );
  return index?.entries ?? [];
}

export async function getDiagramVersion(params: {
  username: string;
  repo: string;
  githubPat?: string;
  variant?: RepoVariant | null;
  id: string;
}): Promise<DiagramArtifact | null> {
  const location = resolveLocation(params);
  return getJsonObject<DiagramArtifact>(
    location.bucket,
    getHistoryEntryKey(location, params.id),
  );
}
