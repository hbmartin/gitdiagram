import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  resumeDiagramGeneration,
  streamDiagramGeneration,
} from "~/features/diagram/api";
import { useDiagramStream } from "~/hooks/diagram/useDiagramStream";

vi.mock("~/features/diagram/api", () => ({
  generationSupportsResume: vi.fn(() => true),
  resumeDiagramGeneration: vi.fn(async () => undefined),
  streamDiagramGeneration: vi.fn(async (_params, handlers) => {
    await handlers.onMessage({
      status: "started",
      message: "starting",
      cost_summary: {
        kind: "estimate",
        approximate: true,
        amountUsd: 0.0123,
        display: "$0.0123 USD",
        pricingModel: "gpt-5.4-mini",
        usage: {
          inputTokens: 1000,
          outputTokens: 2000,
          totalTokens: 3000,
        },
      },
    });
    await handlers.onMessage({
      status: "explanation_chunk",
      chunk: "Repo details",
    });
    await handlers.onMessage({
      status: "complete",
      cost_summary: {
        kind: "actual",
        approximate: false,
        amountUsd: 0.009,
        display: "$0.0090 USD",
        pricingModel: "gpt-5.4-mini",
        usage: {
          inputTokens: 900,
          outputTokens: 1800,
          totalTokens: 2700,
        },
      },
      diagram: "flowchart TD\nA-->B",
      explanation: "done",
      graph: {
        groups: [],
        nodes: [
          {
            id: "a",
            label: "A",
            type: "component",
            description: null,
            groupId: null,
            path: null,
            shape: null,
          },
        ],
        edges: [],
      },
    });
  }),
}));

describe("useDiagramStream", () => {
  it("updates state through stream lifecycle", async () => {
    const onComplete = vi.fn(async () => undefined);
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useDiagramStream({
        username: "acme",
        repo: "demo",
        onComplete,
        onError,
      }),
    );

    await act(async () => {
      await result.current.runGeneration();
    });

    expect(result.current.state.status).toBe("complete");
    expect(result.current.state.diagram).toContain("flowchart TD");
    expect(result.current.state.graph?.nodes).toHaveLength(1);
    expect(result.current.state.costSummary?.kind).toBe("actual");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("resumes from a progress snapshot when the stream drops mid-generation", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(streamDiagramGeneration).mockImplementationOnce(
        async (_params, handlers) => {
          await handlers.onMessage({
            status: "started",
            session_id: "session-123",
            message: "starting",
          });
          await handlers.onMessage({
            status: "explanation_chunk",
            session_id: "session-123",
            chunk: "partial",
          });
          throw new Error("network dropped");
        },
      );
      vi.mocked(resumeDiagramGeneration).mockImplementationOnce(
        async (_sessionId, handlers) => {
          await handlers.onMessage({
            status: "explanation",
            session_id: "session-123",
            explanation: "partial explanation from snapshot",
            resumed: true,
          });
          await handlers.onMessage({
            status: "complete",
            session_id: "session-123",
            diagram: "flowchart TD\nA-->B",
            explanation: "full explanation",
            resumed: true,
          });
        },
      );

      const onComplete = vi.fn(async () => undefined);
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useDiagramStream({
          username: "acme",
          repo: "demo",
          onComplete,
          onError,
        }),
      );

      await act(async () => {
        const generation = result.current.runGeneration();
        await vi.advanceTimersByTimeAsync(2_000);
        await generation;
      });

      expect(resumeDiagramGeneration).toHaveBeenCalledWith(
        "session-123",
        expect.anything(),
      );
      expect(result.current.state.status).toBe("complete");
      expect(result.current.state.diagram).toContain("flowchart TD");
      expect(result.current.state.explanation).toBe("full explanation");
      expect(onError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
