import type { Metadata } from "next";

import { getStoredDiagramState } from "~/server/storage/artifact-store";
import { SITE_URL } from "~/lib/site";
import EmbedDiagram from "./embed-diagram";

type EmbedPageProps = {
  params: Promise<{ username: string; repo: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const revalidate = 300;

function firstParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

export async function generateMetadata({
  params,
}: EmbedPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  return {
    title: `${username}/${repo} architecture diagram | GitDiagram`,
    robots: { index: false, follow: false },
  };
}

export default async function EmbedPage({
  params,
  searchParams,
}: EmbedPageProps) {
  const { username, repo } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const ref = firstParam(resolvedSearchParams.ref);
  const subdir = firstParam(resolvedSearchParams.subdir);
  const repoUrl = `${SITE_URL}/${encodeURIComponent(username.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}`;

  let diagram: string | null = null;
  try {
    const state = await getStoredDiagramState({
      username: username.toLowerCase(),
      repo: repo.toLowerCase(),
      variant: { ref, subdir },
    });
    diagram = state?.diagram ?? null;
  } catch {
    diagram = null;
  }

  return (
    <div className="flex h-screen w-full flex-col bg-white dark:bg-neutral-950">
      <div className="min-h-0 flex-1">
        {diagram ? (
          <EmbedDiagram chart={diagram} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-600 dark:text-neutral-400">
            <p>
              No diagram has been generated for {username}/{repo} yet.{" "}
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-700 underline dark:text-purple-300"
              >
                Generate one on GitDiagram
              </a>
              .
            </p>
          </div>
        )}
      </div>
      <a
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-end gap-1 border-t border-gray-200 px-3 py-1 text-xs text-gray-500 hover:text-purple-700 dark:border-neutral-800 dark:text-neutral-400 dark:hover:text-purple-300"
      >
        Made with GitDiagram
      </a>
    </div>
  );
}
