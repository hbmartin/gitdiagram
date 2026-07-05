import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { getStoredDiagramState } from "~/server/storage/artifact-store";
import { getPublicDiagramStateCacheTag } from "~/server/storage/repo-page-cache";
import RepoPageClient from "./repo-page-client";

type RepoPageProps = {
  params: Promise<{ username: string; repo: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

async function getCachedPublicDiagramState(username: string, repo: string) {
  const getCachedState = unstable_cache(
    async () =>
      getStoredDiagramState({
        username,
        repo,
      }),
    ["public-diagram-state", username.toLowerCase(), repo.toLowerCase()],
    {
      revalidate,
      tags: [getPublicDiagramStateCacheTag(username, repo)],
    },
  );

  return getCachedState();
}

export async function generateMetadata({
  params,
}: RepoPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  const title = `${username}/${repo} Diagram | GitDiagram`;
  const description = `Interactive architecture diagram for ${username}/${repo}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/${username}/${repo}`,
    },
    openGraph: {
      title,
      description,
      url: `https://gitdiagram.com/${username}/${repo}`,
      siteName: "GitDiagram",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: "@ahmedkhaleel2004",
    },
  };
}

export default async function Repo({ params, searchParams }: RepoPageProps) {
  const { username, repo } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const ref = firstParam(resolvedSearchParams.ref);
  const subdir = firstParam(resolvedSearchParams.subdir);
  const isDefaultVariant = !ref && !subdir;

  // Variant pages (specific ref or subdirectory) always resolve their state
  // client-side against the variant-specific storage keys.
  const initialState = isDefaultVariant
    ? ((await getCachedPublicDiagramState(
        username,
        repo,
      )) as DiagramStateResponse | null)
    : null;

  return (
    <RepoPageClient
      username={username}
      repo={repo}
      diagramRef={ref}
      subdir={subdir}
      initialState={initialState?.diagram ? initialState : null}
    />
  );
}
