import { getGitHubApiHeaders } from "../github-auth";

// GITHUB_API_BASE_URL supports GitHub Enterprise hosts and test mocks.
function githubApiBase(): string {
  return (
    process.env.GITHUB_API_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://api.github.com"
  );
}

interface GitHubRepoResponse {
  default_branch?: string;
  private?: boolean;
  stargazers_count?: number;
}

interface GitHubTreeItem {
  path: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItem[];
}

interface GitHubReadmeResponse {
  content?: string;
  encoding?: string;
}

export interface GithubData {
  defaultBranch: string;
  /** The branch, tag, or commit the diagram was generated against. */
  resolvedRef: string;
  /** Commit SHA the resolved ref pointed at, when resolvable. */
  commitSha: string | null;
  /** Normalized subdirectory scope, or null for the whole repository. */
  subdir: string | null;
  fileTree: string;
  readme: string;
  isPrivate: boolean;
  stargazerCount: number | null;
}

export interface GithubDataOptions {
  githubPat?: string;
  ref?: string | null;
  subdir?: string | null;
  signal?: AbortSignal;
}

interface GitHubCommitResponse {
  sha?: string;
}

const EXCLUDED_PATTERNS = [
  "node_modules/",
  "vendor/",
  "venv/",
  ".min.",
  ".pyc",
  ".pyo",
  ".pyd",
  ".so",
  ".dll",
  ".class",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".ico",
  ".svg",
  ".ttf",
  ".woff",
  ".webp",
  "__pycache__/",
  ".cache/",
  ".tmp/",
  "yarn.lock",
  "poetry.lock",
  "*.log",
  ".vscode/",
  ".idea/",
];

function shouldIncludeFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return !EXCLUDED_PATTERNS.some((pattern) => lowerPath.includes(pattern));
}

async function fetchJson<T>(
  url: string,
  headers: HeadersInit,
  notFoundMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal,
  });

  if (response.status === 404) {
    throw new Error(notFoundMessage);
  }

  if (!response.ok) {
    throw new Error(
      `GitHub request failed (${response.status}): ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

async function getRepoMetadata(
  username: string,
  repo: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<{
  defaultBranch: string;
  isPrivate: boolean;
  stargazerCount: number | null;
}> {
  const data = await fetchJson<GitHubRepoResponse>(
    `${githubApiBase()}/repos/${username}/${repo}`,
    headers,
    "Repository not found.",
    signal,
  );

  return {
    defaultBranch: data.default_branch || "main",
    isPrivate: Boolean(data.private),
    stargazerCount:
      typeof data.stargazers_count === "number" ? data.stargazers_count : null,
  };
}

async function resolveCommitSha(
  username: string,
  repo: string,
  ref: string,
  headers: HeadersInit,
  isExplicitRef: boolean,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const data = await fetchJson<GitHubCommitResponse>(
      `${githubApiBase()}/repos/${username}/${repo}/commits/${encodeURIComponent(ref)}`,
      headers,
      `Branch, tag, or commit "${ref}" was not found in the repository.`,
      signal,
    );
    return data.sha ?? null;
  } catch (error) {
    if (isExplicitRef) {
      throw error;
    }
    // The default branch should always resolve; if it does not (e.g. an
    // empty repository), the tree fetch below produces the real error.
    return null;
  }
}

export function normalizeSubdir(subdir?: string | null): string | null {
  return subdir?.trim().replace(/^\/+|\/+$/g, "") || null;
}

async function getFileTree(
  username: string,
  repo: string,
  treeRef: string,
  subdir: string | null,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<string> {
  const data = await fetchJson<GitHubTreeResponse>(
    `${githubApiBase()}/repos/${username}/${repo}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`,
    headers,
    "Could not fetch repository file tree.",
    signal,
  );

  let paths = (data.tree ?? [])
    .map((item) => item.path)
    .filter((path): path is string => Boolean(path))
    .filter(shouldIncludeFile);

  if (subdir) {
    const prefix = `${subdir}/`;
    paths = paths.filter((path) => path === subdir || path.startsWith(prefix));
    if (!paths.length) {
      throw new Error(
        `Subdirectory "${subdir}" was not found in the repository.`,
      );
    }
  }

  if (!paths.length) {
    throw new Error(
      "Could not fetch repository file tree. Repository might be empty or inaccessible.",
    );
  }

  return paths.join("\n");
}

async function fetchReadmeContent(
  url: string,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<string> {
  const data = await fetchJson<GitHubReadmeResponse>(
    url,
    headers,
    "No README found for the specified repository.",
    signal,
  );

  if (!data.content) {
    throw new Error("No README found for the specified repository.");
  }

  if (data.encoding === "base64") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  return data.content;
}

async function getReadme(
  username: string,
  repo: string,
  ref: string | null,
  subdir: string | null,
  headers: HeadersInit,
  signal?: AbortSignal,
): Promise<string> {
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";

  if (subdir) {
    try {
      return await fetchReadmeContent(
        `${githubApiBase()}/repos/${username}/${repo}/readme/${subdir
          .split("/")
          .map(encodeURIComponent)
          .join("/")}${refQuery}`,
        headers,
        signal,
      );
    } catch {
      // Fall back to the repository root README below.
    }
  }

  return fetchReadmeContent(
    `${githubApiBase()}/repos/${username}/${repo}/readme${refQuery}`,
    headers,
    signal,
  );
}

export async function getGithubData(
  username: string,
  repo: string,
  options: GithubDataOptions = {},
): Promise<GithubData> {
  const { githubPat, signal } = options;
  const requestedRef = options.ref?.trim() || null;
  const subdir = normalizeSubdir(options.subdir);

  const headers = await getGitHubApiHeaders({ githubPat });
  const { defaultBranch, isPrivate, stargazerCount } = await getRepoMetadata(
    username,
    repo,
    headers,
    signal,
  );
  const resolvedRef = requestedRef ?? defaultBranch;
  const commitSha = await resolveCommitSha(
    username,
    repo,
    resolvedRef,
    headers,
    requestedRef !== null,
    signal,
  );
  const [fileTree, readme] = await Promise.all([
    getFileTree(
      username,
      repo,
      commitSha ?? resolvedRef,
      subdir,
      headers,
      signal,
    ),
    getReadme(username, repo, requestedRef, subdir, headers, signal),
  ]);

  return {
    defaultBranch,
    resolvedRef,
    commitSha,
    subdir,
    fileTree,
    readme,
    isPrivate,
    stargazerCount,
  };
}
