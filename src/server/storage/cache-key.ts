import { createHmac } from "node:crypto";

import type { ArtifactVisibility } from "~/server/storage/types";
import { readRequiredEnv } from "~/server/storage/config";

function normalizeSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function createPatNamespace(githubPat: string): string {
  const secret = readRequiredEnv("CACHE_KEY_SECRET");
  return createHmac("sha256", secret).update(githubPat.trim()).digest("hex");
}

export interface RepoVariant {
  ref?: string | null;
  subdir?: string | null;
}

export interface NormalizedRepoVariant {
  ref: string | null;
  subdir: string | null;
}

export function normalizeRepoVariant(
  variant?: RepoVariant | null,
): NormalizedRepoVariant {
  const ref = variant?.ref?.trim() || null;
  const subdir = variant?.subdir?.trim().replace(/^\/+|\/+$/g, "") || null;
  return { ref, subdir };
}

export function isDefaultVariant(variant?: RepoVariant | null): boolean {
  const normalized = normalizeRepoVariant(variant);
  return normalized.ref === null && normalized.subdir === null;
}

// Refs and subdirs are case-sensitive, so they are encoded without lowercasing.
function variantSegments(variant?: RepoVariant | null): {
  refSegment: string;
  subdirSegment: string;
} | null {
  const normalized = normalizeRepoVariant(variant);
  if (normalized.ref === null && normalized.subdir === null) {
    return null;
  }
  return {
    refSegment: normalized.ref
      ? encodeURIComponent(normalized.ref)
      : "@default",
    subdirSegment: normalized.subdir
      ? encodeURIComponent(normalized.subdir)
      : "@root",
  };
}

export interface StorageLocation {
  visibility: ArtifactVisibility;
  bucket: string;
  artifactKey: string;
  statusKey: string;
}

export function getPublicLocation(
  username: string,
  repo: string,
  variant?: RepoVariant | null,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);
  const segments = variantSegments(variant);

  if (!segments) {
    return {
      visibility: "public",
      bucket: readRequiredEnv("R2_PUBLIC_BUCKET"),
      artifactKey: `public/v1/${normalizedUsername}/${normalizedRepo}.json`,
      statusKey: `status:v1:public:${normalizedUsername}:${normalizedRepo}`,
    };
  }

  return {
    visibility: "public",
    bucket: readRequiredEnv("R2_PUBLIC_BUCKET"),
    artifactKey: `public/v1/${normalizedUsername}/${normalizedRepo}/variants/${segments.refSegment}/${segments.subdirSegment}.json`,
    statusKey: `status:v1:public:${normalizedUsername}:${normalizedRepo}:${segments.refSegment}:${segments.subdirSegment}`,
  };
}

export function getPrivateLocation(
  username: string,
  repo: string,
  githubPat: string,
  variant?: RepoVariant | null,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);
  const namespace = createPatNamespace(githubPat);
  const segments = variantSegments(variant);

  if (!segments) {
    return {
      visibility: "private",
      bucket: readRequiredEnv("R2_PRIVATE_BUCKET"),
      artifactKey: `private/v1/${namespace}/${normalizedUsername}/${normalizedRepo}.json`,
      statusKey: `status:v1:private:${namespace}:${normalizedUsername}:${normalizedRepo}`,
    };
  }

  return {
    visibility: "private",
    bucket: readRequiredEnv("R2_PRIVATE_BUCKET"),
    artifactKey: `private/v1/${namespace}/${normalizedUsername}/${normalizedRepo}/variants/${segments.refSegment}/${segments.subdirSegment}.json`,
    statusKey: `status:v1:private:${namespace}:${normalizedUsername}:${normalizedRepo}:${segments.refSegment}:${segments.subdirSegment}`,
  };
}

export function getReadLocations(params: {
  username: string;
  repo: string;
  githubPat?: string;
  variant?: RepoVariant | null;
}): StorageLocation[] {
  const locations: StorageLocation[] = [];
  if (params.githubPat?.trim()) {
    locations.push(
      getPrivateLocation(
        params.username,
        params.repo,
        params.githubPat,
        params.variant,
      ),
    );
  }
  locations.push(
    getPublicLocation(params.username, params.repo, params.variant),
  );
  return locations;
}
