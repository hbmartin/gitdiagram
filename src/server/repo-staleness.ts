import "server-only";

import { getGitHubApiHeaders } from "./github-auth";

interface GitHubCompareResponse {
  ahead_by?: number;
  status?: string;
}

const STALENESS_REVALIDATE_SECONDS = 60 * 30;

export interface RepoStaleness {
  /** Commits on the ref since the diagram's snapshot commit. */
  aheadBy: number;
  commitSha: string;
}

/**
 * How far a ref has moved since the diagram's snapshot commit. Returns null
 * when the comparison is unavailable (private repo without auth, force-pushed
 * history, API errors) — callers should treat that as "unknown", not "fresh".
 */
export async function getRepoStaleness(params: {
  username: string;
  repo: string;
  commitSha: string;
  ref?: string | null;
}): Promise<RepoStaleness | null> {
  const { username, repo, commitSha } = params;
  const head = params.ref?.trim() || "HEAD";

  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(
      username,
    )}/${encodeURIComponent(repo)}/compare/${commitSha}...${encodeURIComponent(
      head,
    )}?per_page=1`;
    const response = await fetch(url, {
      cache: "force-cache",
      headers: await getGitHubApiHeaders({ allowGitHubAppAuth: false }),
      next: {
        revalidate: STALENESS_REVALIDATE_SECONDS,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as GitHubCompareResponse;
    if (typeof data.ahead_by !== "number") {
      return null;
    }

    return { aheadBy: data.ahead_by, commitSha };
  } catch (error) {
    console.error("Error fetching repo staleness:", error);
    return null;
  }
}
