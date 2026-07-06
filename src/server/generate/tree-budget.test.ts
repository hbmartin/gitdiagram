import { describe, expect, it } from "vitest";

import { estimateTokens } from "~/server/generate/openai";
import {
  buildFileTreeSampleNote,
  fitFileTreeToTokenBudget,
} from "~/server/generate/tree-budget";

function makeTree(paths: string[]): string {
  return paths.join("\n");
}

describe("fitFileTreeToTokenBudget", () => {
  it("returns the tree untouched when it fits the budget", () => {
    const tree = makeTree(["src", "src/index.ts", "README.md"]);
    const result = fitFileTreeToTokenBudget(tree, 10_000);

    expect(result.fileTree).toBe(tree);
    expect(result.sample).toBeNull();
  });

  it("drops the deepest paths first", () => {
    const paths = [
      "src",
      "src/app",
      "src/app/deep",
      "src/app/deep/nested",
      ...Array.from(
        { length: 200 },
        (_, i) => `src/app/deep/nested/really/long/path/file-${i}.ts`,
      ),
    ];
    const tree = makeTree(paths);
    const budget = estimateTokens(makeTree(paths.slice(0, 4))) + 50;
    const result = fitFileTreeToTokenBudget(tree, budget);

    expect(result.sample).not.toBeNull();
    expect(result.sample?.tier).toBe("depth");
    expect(result.sample?.totalPaths).toBe(paths.length);
    expect(result.fileTree.split("\n")).toContain("src/app");
    expect(result.fileTree).not.toContain("file-0.ts");
    expect(estimateTokens(result.fileTree)).toBeLessThanOrEqual(budget);
  });

  it("caps entries per directory for wide flat repos", () => {
    const paths = Array.from({ length: 500 }, (_, i) => `data/file-${i}.csv`);
    const tree = makeTree(paths);
    const budget = estimateTokens(makeTree(paths.slice(0, 40)));
    const result = fitFileTreeToTokenBudget(tree, budget);

    expect(result.sample?.tier).toBe("per_directory");
    expect(estimateTokens(result.fileTree)).toBeLessThanOrEqual(budget);
    expect(result.fileTree.split("\n")[0]).toBe("data/file-0.csv");
  });

  it("falls back to a shallowest-first prefix when caps are not enough", () => {
    const paths = Array.from({ length: 400 }, (_, i) => `dir-${i}/file.txt`);
    const tree = makeTree(paths);
    const budget = estimateTokens(makeTree(paths.slice(0, 10)));
    const result = fitFileTreeToTokenBudget(tree, budget);

    expect(result.sample?.tier).toBe("prefix");
    expect(result.fileTree.split("\n").length).toBeGreaterThan(0);
    expect(estimateTokens(result.fileTree)).toBeLessThanOrEqual(budget);
  });

  it("is deterministic for the same input", () => {
    const paths = Array.from(
      { length: 300 },
      (_, i) => `pkg/mod-${i % 7}/file-${i}.go`,
    );
    const tree = makeTree(paths);
    const first = fitFileTreeToTokenBudget(tree, 500);
    const second = fitFileTreeToTokenBudget(tree, 500);

    expect(first.fileTree).toBe(second.fileTree);
    expect(first.sample).toEqual(second.sample);
  });
});

describe("buildFileTreeSampleNote", () => {
  it("mentions included and total paths", () => {
    const note = buildFileTreeSampleNote({
      includedPaths: 12,
      totalPaths: 400,
      tier: "depth",
    });
    expect(note).toContain("12");
    expect(note).toContain("400");
  });
});
