import { useCallback, useRef, useState } from "react";

import {
  generationSupportsResume,
  resumeDiagramGeneration,
  streamDiagramGeneration,
} from "~/features/diagram/api";
import type {
  DiagramStreamMessage,
  DiagramStreamState,
} from "~/features/diagram/types";
import { getStoredOpenAiKey } from "~/lib/openai-key";

interface UseDiagramStreamOptions {
  username: string;
  repo: string;
  ref?: string | null;
  subdir?: string | null;
  initialState?: DiagramStreamState;
  onComplete: (result: {
    diagram: string;
    explanation: string;
    graph: DiagramStreamState["graph"];
    latestSessionAudit: DiagramStreamState["latestSessionAudit"];
    generatedAt?: string;
  }) => Promise<void>;
  onError: (message: string) => void;
}

export function useDiagramStream({
  username,
  repo,
  ref,
  subdir,
  initialState,
  onComplete,
  onError,
}: UseDiagramStreamOptions) {
  const [state, setState] = useState<DiagramStreamState>(
    initialState ?? { status: "idle" },
  );

  const handleStreamMessage = useCallback(
    async (
      data: DiagramStreamMessage,
      buffers: {
        explanation: string;
      },
    ) => {
      if (data.error) {
        setState({
          status: "error",
          sessionId: data.session_id,
          costSummary: data.cost_summary,
          quotaResetAt: data.quota_reset_at,
          error: data.error,
          errorCode: data.error_code,
          validationError: data.validation_error,
          failureStage: data.failure_stage,
          latestSessionAudit: data.latest_session_audit,
        });
        onError(data.error);
        return false;
      }

      switch (data.status) {
        case "started":
        case "explanation_sent":
        case "explanation":
        case "graph_sent":
        case "graph":
        case "graph_retry":
        case "graph_validating":
        case "diagram_compiling":
          setState((prev) => ({
            ...prev,
            status: data.status,
            sessionId: data.session_id ?? prev.sessionId,
            message: data.message,
            costSummary: data.cost_summary ?? prev.costSummary,
            quotaResetAt: data.quota_reset_at ?? prev.quotaResetAt,
            graph: data.graph ?? prev.graph,
            graphAttempts: data.graph_attempts ?? prev.graphAttempts,
            diagram: data.diagram ?? prev.diagram,
            validationError: data.validation_error ?? prev.validationError,
            failureStage: data.failure_stage ?? prev.failureStage,
            sampled: data.sampled ?? prev.sampled,
            // Resume snapshots carry the full explanation accumulated so far.
            explanation: data.explanation ?? prev.explanation,
          }));
          break;
        case "explanation_chunk":
          if (data.chunk) {
            buffers.explanation += data.chunk;
            setState((prev) => ({
              ...prev,
              status: "explanation_chunk",
              sessionId: data.session_id ?? prev.sessionId,
              costSummary: data.cost_summary ?? prev.costSummary,
              quotaResetAt: data.quota_reset_at ?? prev.quotaResetAt,
              explanation: buffers.explanation,
            }));
          }
          break;
        case "complete": {
          const explanation = data.explanation ?? buffers.explanation;
          const diagram = data.diagram ?? "";
          setState({
            status: "complete",
            sessionId: data.session_id,
            costSummary: data.cost_summary,
            quotaResetAt: data.quota_reset_at,
            explanation,
            diagram,
            graph: data.graph,
            graphAttempts: data.graph_attempts,
            latestSessionAudit: data.latest_session_audit,
            sampled:
              data.sampled ?? data.latest_session_audit?.sampled ?? undefined,
          });
          await onComplete({
            explanation,
            diagram,
            graph: data.graph,
            latestSessionAudit: data.latest_session_audit,
            generatedAt: data.generated_at,
          });
          return false;
        }
        case "error":
          setState({
            status: "error",
            sessionId: data.session_id,
            costSummary: data.cost_summary,
            quotaResetAt: data.quota_reset_at,
            error: data.error,
            validationError: data.validation_error,
            failureStage: data.failure_stage,
            latestSessionAudit: data.latest_session_audit,
          });
          if (data.error) onError(data.error);
          return false;
      }

      return true;
    },
    [onComplete, onError],
  );

  const sessionIdRef = useRef<string | undefined>(undefined);
  const terminalReachedRef = useRef(false);

  const runGeneration = useCallback(
    async (githubPat?: string) => {
      setState({
        status: "started",
        message: "Starting generation process...",
        costSummary: undefined,
      });
      const buffers = {
        explanation: "",
      };
      sessionIdRef.current = undefined;
      terminalReachedRef.current = false;

      const onMessage = async (message: DiagramStreamMessage) => {
        if (message.session_id) {
          sessionIdRef.current = message.session_id;
        }
        if (
          message.status === "complete" ||
          message.status === "error" ||
          message.error
        ) {
          terminalReachedRef.current = true;
        }
        return handleStreamMessage(message, buffers);
      };

      let streamError: unknown = null;
      try {
        await streamDiagramGeneration(
          {
            username,
            repo,
            apiKey: getStoredOpenAiKey(),
            githubPat,
            ref,
            subdir,
          },
          { onMessage },
        );
      } catch (error) {
        streamError = error;
      }

      // The connection dropped (or ended) before a terminal event. When the
      // backend persists progress snapshots, reattach instead of failing —
      // the server keeps generating after a disconnect.
      const canResume =
        !terminalReachedRef.current &&
        Boolean(sessionIdRef.current) &&
        generationSupportsResume();

      if (canResume) {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (terminalReachedRef.current) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          try {
            await resumeDiagramGeneration(sessionIdRef.current!, {
              onMessage,
            });
          } catch {
            // Retry until attempts are exhausted.
          }
        }
      }

      if (!terminalReachedRef.current) {
        if (streamError) {
          throw streamError;
        }
        setState((prev) => ({
          ...prev,
          status: "error",
          error:
            "The connection to the generation stream was lost. Please try again.",
        }));
        onError("The connection to the generation stream was lost.");
      }
    },
    [handleStreamMessage, onError, ref, repo, subdir, username],
  );

  return {
    state,
    runGeneration,
    setState,
  };
}
