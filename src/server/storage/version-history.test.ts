import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiagramArtifact } from "~/server/storage/types";

const getJsonObject = vi.fn();
const putJsonObject = vi.fn();
const deleteObject = vi.fn();

vi.mock("~/server/storage/r2", () => ({
  getJsonObject: (...args: unknown[]) => getJsonObject(...args),
  putJsonObject: (...args: unknown[]) => putJsonObject(...args),
  deleteObject: (...args: unknown[]) => deleteObject(...args),
}));

import {
  appendDiagramVersion,
  getHistoryEntryKey,
  getHistoryIndexKey,
  listDiagramVersions,
  MAX_HISTORY_ENTRIES,
  type DiagramVersionIndex,
} from "~/server/storage/version-history";

function makeArtifact(generatedAt: string): DiagramArtifact {
  return {
    version: 1,
    visibility: "public",
    username: "acme",
    repo: "demo",
    stargazerCount: 1,
    diagram: "flowchart TD\nA-->B",
    explanation: "explanation",
    graph: null,
    generatedAt,
    usedOwnKey: false,
    latestSessionSummary: {
      sessionId: "s",
      status: "succeeded",
      stage: "complete",
      provider: "openai",
      model: "gpt-5.4-mini",
      graph: null,
      graphAttempts: [],
      stageUsages: [],
      timeline: [],
      createdAt: generatedAt,
      updatedAt: generatedAt,
    },
    lastSuccessfulAt: generatedAt,
    ref: "main",
    subdir: null,
    commitSha: "abc1234def",
  };
}

describe("version history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("R2_PUBLIC_BUCKET", "public-bucket");
  });

  it("derives history keys from the artifact key", () => {
    const location = {
      visibility: "public" as const,
      bucket: "public-bucket",
      artifactKey: "public/v1/acme/demo.json",
      statusKey: "status:v1:public:acme:demo",
    };
    expect(getHistoryIndexKey(location)).toBe(
      "public/v1/acme/demo/history/index.json",
    );
    expect(getHistoryEntryKey(location, "2026-07-05T12:00:00.000Z")).toBe(
      "public/v1/acme/demo/history/2026-07-05T12%3A00%3A00.000Z.json",
    );
  });

  it("appends a version and updates the index", async () => {
    getJsonObject.mockResolvedValueOnce(null);
    const artifact = makeArtifact("2026-07-05T12:00:00.000Z");

    await appendDiagramVersion({
      username: "acme",
      repo: "demo",
      visibility: "public",
      artifact,
    });

    expect(putJsonObject).toHaveBeenCalledTimes(2);
    const [, entryKey, entryPayload] = putJsonObject.mock.calls[0]!;
    expect(entryKey).toContain("/history/");
    expect(entryPayload).toEqual(artifact);

    const [, indexKey, indexPayload] = putJsonObject.mock.calls[1]!;
    expect(indexKey).toBe("public/v1/acme/demo/history/index.json");
    const index = indexPayload as DiagramVersionIndex;
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({
      id: "2026-07-05T12:00:00.000Z",
      commitSha: "abc1234def",
      ref: "main",
      model: "gpt-5.4-mini",
    });
  });

  it("caps the index and deletes evicted versions", async () => {
    const existingEntries = Array.from(
      { length: MAX_HISTORY_ENTRIES },
      (_, i) => ({
        id: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        generatedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        commitSha: null,
        ref: null,
        subdir: null,
        model: null,
        key: `public/v1/acme/demo/history/entry-${i}.json`,
      }),
    );
    getJsonObject.mockResolvedValueOnce({
      version: 1,
      updatedAt: "",
      entries: existingEntries,
    });

    await appendDiagramVersion({
      username: "acme",
      repo: "demo",
      visibility: "public",
      artifact: makeArtifact("2026-07-05T12:00:00.000Z"),
    });

    const indexPayload = putJsonObject.mock.calls[1]![2] as DiagramVersionIndex;
    expect(indexPayload.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(indexPayload.entries[0]?.id).toBe("2026-07-05T12:00:00.000Z");
    expect(deleteObject).toHaveBeenCalledWith(
      "public-bucket",
      `public/v1/acme/demo/history/entry-${MAX_HISTORY_ENTRIES - 1}.json`,
    );
  });

  it("lists versions from the index", async () => {
    getJsonObject.mockResolvedValueOnce({
      version: 1,
      updatedAt: "",
      entries: [{ id: "a" }],
    });
    const entries = await listDiagramVersions({
      username: "acme",
      repo: "demo",
    });
    expect(entries).toEqual([{ id: "a" }]);
  });
});
