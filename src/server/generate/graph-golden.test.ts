import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { diagramGraphSchema } from "~/features/diagram/graph";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  validateDiagramGraph,
} from "~/server/generate/graph";
import { fitFileTreeToTokenBudget } from "~/server/generate/tree-budget";

const fixturesDir = join(process.cwd(), "shared", "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

describe("pipeline golden fixtures", () => {
  const graph = diagramGraphSchema.parse(
    JSON.parse(readFixture("diagram-graph.json")),
  );
  const fileTree = readFixture("file-tree.txt").trim();

  it("fixture graph validates against the fixture file tree", () => {
    const result = validateDiagramGraph(graph, buildFileTreeLookup(fileTree));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("compiles the fixture graph to the golden mermaid output", () => {
    const compiled = compileDiagramGraph({
      graph,
      username: "acme",
      repo: "demo",
      branch: "main",
    });
    // Regenerate with: bun scripts/parity/dump-contract.ts
    // (the compiled_mermaid field), and keep the Python golden test green.
    expect(`${compiled}\n`).toBe(readFixture("expected-mermaid.mmd"));
  });

  it("truncates the fixture tree deterministically", () => {
    const first = fitFileTreeToTokenBudget(fileTree, 500);
    const second = fitFileTreeToTokenBudget(fileTree, 500);
    expect(first).toEqual(second);
    expect(first.sample).not.toBeNull();
    expect(first.fileTree.split("\n")).toContain("src/app");
  });
});
