import type { DiagramSampleInfo } from "~/features/diagram/graph";
import { estimateTokens } from "~/server/generate/openai";

export const MIN_TREE_TOKEN_BUDGET = 2_000;
export const TRUNCATION_TOKEN_MARGIN = 2_000;

const PER_DIRECTORY_CAPS = [20, 10, 5, 2, 1];

export interface TreeBudgetResult {
  fileTree: string;
  sample: DiagramSampleInfo | null;
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function fits(lines: string[], maxTokens: number): boolean {
  return estimateTokens(lines.join("\n")) <= maxTokens;
}

function capPerDirectory(lines: string[], cap: number): string[] {
  const counts = new Map<string, number>();
  const kept: string[] = [];
  for (const line of lines) {
    const parent = parentDirectory(line);
    const count = counts.get(parent) ?? 0;
    if (count >= cap) {
      continue;
    }
    counts.set(parent, count + 1);
    kept.push(line);
  }
  return kept;
}

function shallowestPrefix(lines: string[], maxTokens: number): string[] {
  const ordered = lines
    .map((line, index) => ({ line, index, depth: pathDepth(line) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.line);

  const kept: string[] = [];
  let tokens = 0;
  for (const line of ordered) {
    const lineTokens = estimateTokens(line);
    if (kept.length > 0 && tokens + lineTokens > maxTokens) {
      break;
    }
    kept.push(line);
    tokens += lineTokens;
  }
  while (kept.length > 1 && !fits(kept, maxTokens)) {
    kept.pop();
  }
  return kept;
}

/**
 * Shrink a newline-separated file tree until it fits the token budget.
 *
 * Tiers, in order of preference:
 * 1. depth: drop the deepest paths first, keeping the shallow structure intact.
 * 2. per_directory: cap the number of entries per directory.
 * 3. prefix: keep the shallowest paths that fit, in original order.
 */
export function fitFileTreeToTokenBudget(
  fileTree: string,
  maxTokens: number,
): TreeBudgetResult {
  const lines = fileTree.split("\n").filter((line) => line.trim().length > 0);
  const totalPaths = lines.length;

  if (fits(lines, maxTokens)) {
    return { fileTree: lines.join("\n"), sample: null };
  }

  const toResult = (kept: string[], tier: string): TreeBudgetResult => ({
    fileTree: kept.join("\n"),
    sample: {
      includedPaths: kept.length,
      totalPaths,
      tier,
    },
  });

  const maxDepth = Math.max(...lines.map(pathDepth));
  for (let depth = maxDepth - 1; depth >= 1; depth--) {
    const kept = lines.filter((line) => pathDepth(line) <= depth);
    if (kept.length > 0 && fits(kept, maxTokens)) {
      return toResult(kept, "depth");
    }
  }

  for (const cap of PER_DIRECTORY_CAPS) {
    const kept = capPerDirectory(lines, cap);
    if (fits(kept, maxTokens)) {
      return toResult(kept, "per_directory");
    }
  }

  return toResult(shallowestPrefix(lines, maxTokens), "prefix");
}

export function buildFileTreeSampleNote(sample: DiagramSampleInfo): string {
  return `Showing ${sample.includedPaths} of ${sample.totalPaths} repository paths. The repository is large, so the remaining paths were omitted from this listing.`;
}
