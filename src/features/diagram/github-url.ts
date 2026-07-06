export interface ParsedGitHubRepo {
  username: string;
  repo: string;
  /** Branch, tag, or commit extracted from a /tree/ or /blob/ URL. */
  ref?: string;
  /** Directory scope extracted from a /tree/ URL (or the parent dir of a /blob/ file). */
  subdir?: string;
}

const GITHUB_URL_PATTERN =
  /^https?:\/\/github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/?$/;
const GITHUB_TREE_URL_PATTERN =
  /^https?:\/\/github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)\/(tree|blob)\/([^/]+)(?:\/(.*?))?\/?$/;
const GITHUB_REPO_SHORTHAND_PATTERN = /^([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_.]+)$/;

function normalizeGitHubRepoUrl(input: string): string {
  const trimmedInput = input.trim();

  if (GITHUB_REPO_SHORTHAND_PATTERN.test(trimmedInput)) {
    return `https://github.com/${trimmedInput}`;
  }

  return trimmedInput;
}

function subdirFromPath(
  kind: string,
  path: string | undefined,
): string | undefined {
  if (!path) {
    return undefined;
  }
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  if (!cleaned) {
    return undefined;
  }
  if (kind === "blob") {
    // A blob URL points at a file; scope to its parent directory.
    const index = cleaned.lastIndexOf("/");
    return index === -1 ? undefined : cleaned.slice(0, index);
  }
  return cleaned;
}

export function parseGitHubRepoUrl(url: string): ParsedGitHubRepo | null {
  const normalized = normalizeGitHubRepoUrl(url);

  const plainMatch = GITHUB_URL_PATTERN.exec(normalized);
  if (plainMatch) {
    const [, username, repo] = plainMatch;
    if (!username || !repo) return null;
    return { username, repo };
  }

  const treeMatch = GITHUB_TREE_URL_PATTERN.exec(normalized);
  if (treeMatch) {
    const [, username, repo, kind, ref, path] = treeMatch;
    if (!username || !repo || !ref) return null;
    const decodedRef = decodeURIComponent(ref);
    const subdir = subdirFromPath(kind ?? "tree", path);
    return {
      username,
      repo,
      ref: decodedRef,
      ...(subdir ? { subdir: decodeURIComponent(subdir) } : {}),
    };
  }

  return null;
}
