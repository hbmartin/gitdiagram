import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";

import type { GenerationTokenUsage } from "~/features/diagram/cost";
import {
  diagramGraphSchema,
  MAX_GRAPH_ATTEMPTS,
  type DiagramSampleInfo,
} from "~/features/diagram/graph";
import type { ArtifactVisibility } from "~/server/storage/types";
import { revalidateBrowseIndexCache } from "~/app/browse/data";
import {
  persistTerminalSessionAudit,
  saveSuccessfulDiagramState,
  updatePublicBrowseIndexForSuccessfulDiagram,
} from "~/server/storage/diagram-state";
import {
  admitComplimentaryQuota,
  buildComplimentaryAdmissionTokens,
  finalizeComplimentaryQuota,
  getComplimentaryDenialMessage,
  getComplimentaryModelMismatchMessage,
  getComplimentaryProviderMismatchMessage,
  isComplimentaryGateEnabled,
  modelMatchesComplimentaryFamily,
  shouldApplyComplimentaryGate,
  type ComplimentaryQuotaReservation,
} from "~/server/generate/complimentary-gate";
import {
  estimateGenerationCost,
  type GenerationEstimateResult,
} from "~/server/generate/cost-estimate";
import {
  extractTaggedSection,
  toTaggedMessage,
} from "~/server/generate/format";
import { getGithubData } from "~/server/generate/github";
import {
  buildFileTreeSampleNote,
  fitFileTreeToTokenBudget,
  MIN_TREE_TOKEN_BUDGET,
  TRUNCATION_TOKEN_MARGIN,
} from "~/server/generate/tree-budget";
import {
  buildFileTreeLookup,
  compileDiagramGraph,
  formatGraphValidationFeedback,
  validateDiagramGraph,
} from "~/server/generate/graph";
import {
  getModel,
  getProvider,
  getProviderLabel,
  shouldUseExactInputTokenCount,
} from "~/server/generate/model-config";
import {
  estimateTokens,
  generateStructuredOutput,
  streamCompletion,
} from "~/server/generate/openai";
import { validateMermaidSyntax } from "~/server/generate/mermaid";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "~/server/generate/prompts";
import {
  isDefaultVariant,
  normalizeRepoVariant,
} from "~/server/storage/cache-key";
import {
  getPublicDiagramStateCacheTag,
  getRepoPagePath,
} from "~/server/storage/repo-page-cache";
import {
  createGenerationSessionAudit,
  withCompiledDiagram,
  withEstimatedCost,
  withExplanation,
  withFinalCost,
  withFailure,
  withGraph,
  withGraphAttempt,
  withStageUsage,
  withSuccess,
  withTimelineEvent,
} from "~/server/generate/session-audit";
import {
  createCostSummary,
  EXPLANATION_MAX_OUTPUT_TOKENS,
  GRAPH_MAX_OUTPUT_TOKENS,
  sumGenerationUsage,
} from "~/server/generate/pricing";
import {
  FREE_GENERATION_INPUT_TOKEN_LIMIT,
  HARD_GENERATION_INPUT_TOKEN_LIMIT,
} from "~/server/generate/limits";
import {
  isTerminalProgressStatus,
  readGenerationProgress,
  writeGenerationProgress,
  type GenerationProgressSnapshot,
} from "~/server/generate/progress-store";
import { generateRequestSchema, sseMessage } from "~/server/generate/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR =
  "GitDiagram's default OpenAI key is temporarily unavailable because its upstream API quota is exhausted. I'm a solo student engineer running this free and open source, so please try again later or use your own OpenAI API key.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbortError() {
  return new DOMException("Generation aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function isOpenAiQuotaExhaustedError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("insufficient_quota") ||
    (normalized.includes("exceeded your current quota") &&
      normalized.includes("billing"))
  );
}

function normalizeGenerationError(params: {
  provider: string;
  apiKey?: string;
  message: string;
}): { message: string; errorCode: string } {
  if (
    params.provider === "openai" &&
    !params.apiKey &&
    isOpenAiQuotaExhaustedError(params.message)
  ) {
    return {
      message: DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED_ERROR,
      errorCode: "DEFAULT_OPENAI_KEY_QUOTA_EXHAUSTED",
    };
  }

  return {
    message: params.message,
    errorCode: "STREAM_FAILED",
  };
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request payload.",
        error_code: "VALIDATION_ERROR",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const parsed = generateRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid request payload.",
        error_code: "VALIDATION_ERROR",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const {
    username,
    repo,
    api_key: apiKey,
    github_pat: githubPat,
    ref: requestedRef,
    subdir: requestedSubdir,
  } = parsed.data;
  const variant = normalizeRepoVariant({
    ref: requestedRef,
    subdir: requestedSubdir,
  });
  const isDefaultRepoVariant = isDefaultVariant(variant);

  const encoder = new TextEncoder();
  const generationAbortController = new AbortController();
  const postResponseTasks: Array<() => Promise<void>> = [];

  // When the client disconnects, the generation keeps running (the work and
  // cost are already committed) and its progress snapshots stay readable via
  // the GET resume endpoint. after() keeps the function alive until then.
  let resolveRunFinished: () => void = () => undefined;
  const runFinished = new Promise<void>((resolve) => {
    resolveRunFinished = resolve;
  });
  let clientGone = false;

  after(async () => {
    await runFinished;
    for (const task of postResponseTasks) {
      await task();
    }
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let controllerClosed = false;
      let wasCancelled = false;

      request.signal.addEventListener(
        "abort",
        () => {
          clientGone = true;
        },
        { once: true },
      );

      const closeStream = () => {
        if (controllerClosed) {
          return;
        }
        controllerClosed = true;
        if (!clientGone) {
          controller.close();
        }
      };

      const progressSnapshot: GenerationProgressSnapshot = {
        sessionId: "",
        seq: 0,
        status: "idle",
        updatedAt: "",
      };
      let progressEnabled = true;
      let lastProgressWriteAt = 0;
      let progressChain: Promise<void> = Promise.resolve();

      const updateProgressSnapshot = (payload: Record<string, unknown>) => {
        const message = payload as {
          status?: string;
          session_id?: string;
          message?: string;
          chunk?: string;
          [key: string]: unknown;
        };
        if (message.session_id) {
          progressSnapshot.sessionId = message.session_id;
        }
        if (message.status === "explanation_chunk") {
          progressSnapshot.explanation =
            (progressSnapshot.explanation ?? "") + (message.chunk ?? "");
          progressSnapshot.status = "explanation_chunk";
        } else if (message.status) {
          progressSnapshot.status = message.status;
        }
        const assign = <K extends keyof GenerationProgressSnapshot>(
          target: K,
          value: GenerationProgressSnapshot[K] | undefined,
        ) => {
          if (value !== undefined) {
            progressSnapshot[target] = value;
          }
        };
        assign(
          "message",
          message.message as GenerationProgressSnapshot["message"],
        );
        assign(
          "costSummary",
          message.cost_summary as GenerationProgressSnapshot["costSummary"],
        );
        assign(
          "quotaResetAt",
          message.quota_reset_at as GenerationProgressSnapshot["quotaResetAt"],
        );
        assign("graph", message.graph as GenerationProgressSnapshot["graph"]);
        assign(
          "graphAttempts",
          message.graph_attempts as GenerationProgressSnapshot["graphAttempts"],
        );
        assign(
          "diagram",
          message.diagram as GenerationProgressSnapshot["diagram"],
        );
        assign(
          "sampled",
          message.sampled as GenerationProgressSnapshot["sampled"],
        );
        assign("error", message.error as GenerationProgressSnapshot["error"]);
        assign(
          "errorCode",
          message.error_code as GenerationProgressSnapshot["errorCode"],
        );
        assign(
          "validationError",
          message.validation_error as GenerationProgressSnapshot["validationError"],
        );
        assign(
          "failureStage",
          message.failure_stage as GenerationProgressSnapshot["failureStage"],
        );
        assign(
          "latestSessionAudit",
          message.latest_session_audit as GenerationProgressSnapshot["latestSessionAudit"],
        );
        assign(
          "generatedAt",
          message.generated_at as GenerationProgressSnapshot["generatedAt"],
        );
        if (message.status === "complete" && message.explanation) {
          progressSnapshot.explanation = message.explanation as string;
        }
        progressSnapshot.seq += 1;
        progressSnapshot.updatedAt = new Date().toISOString();
      };

      const persistProgress = (status: string | undefined) => {
        if (!progressEnabled || !progressSnapshot.sessionId) {
          return;
        }
        const now = Date.now();
        const isChunk = status === "explanation_chunk";
        if (isChunk && now - lastProgressWriteAt < 500) {
          return;
        }
        lastProgressWriteAt = now;
        const copy = { ...progressSnapshot };
        progressChain = progressChain
          .then(() => writeGenerationProgress(copy))
          .catch(() => {
            // Progress persistence is best-effort (e.g. Redis unconfigured).
            progressEnabled = false;
          });
      };

      const send = (payload: Record<string, unknown>) => {
        updateProgressSnapshot(payload);
        persistProgress(payload.status as string | undefined);
        if (controllerClosed || clientGone) {
          return;
        }
        controller.enqueue(encoder.encode(sseMessage(payload)));
      };

      const run = async () => {
        let audit = createGenerationSessionAudit({
          sessionId: randomUUID(),
          provider: "unknown",
          model: "unknown",
        });
        let estimate: GenerationEstimateResult | null = null;
        let quotaReservation: ComplimentaryQuotaReservation | null = null;
        const actualUsages: GenerationTokenUsage[] = [];
        let hasCompleteMeasuredUsage = true;
        let storageVisibility: ArtifactVisibility = githubPat?.trim()
          ? "private"
          : "public";

        const persistTerminalAudit = async (nextAudit = audit) => {
          await persistTerminalSessionAudit({
            username,
            repo,
            githubPat,
            visibility: storageVisibility,
            audit: nextAudit,
            variant,
          });
        };

        try {
          throwIfAborted(generationAbortController.signal);
          const provider = getProvider();
          const providerLabel = getProviderLabel(provider);
          const model = getModel(provider);

          if (isComplimentaryGateEnabled() && !apiKey) {
            if (provider !== "openai") {
              const error = getComplimentaryProviderMismatchMessage();
              audit = withFailure(
                {
                  ...audit,
                  provider,
                  model,
                  quotaStatus: "denied",
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_PROVIDER_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }

            if (!modelMatchesComplimentaryFamily(model)) {
              const error = getComplimentaryModelMismatchMessage();
              audit = withFailure(
                {
                  ...audit,
                  provider,
                  model,
                  quotaStatus: "denied",
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }
          }

          let githubData = await getGithubData(username, repo, {
            githubPat,
            ref: variant.ref,
            subdir: variant.subdir,
            signal: generationAbortController.signal,
          });
          storageVisibility = githubData.isPrivate ? "private" : "public";
          const runEstimate = () =>
            estimateGenerationCost({
              provider,
              model,
              fileTree: githubData.fileTree,
              readme: githubData.readme,
              username,
              repo,
              apiKey,
              preferExactInputTokenCount: shouldUseExactInputTokenCount({
                provider,
                apiKey,
              }),
            });
          estimate = await runEstimate();

          const inputTokenLimit = apiKey
            ? HARD_GENERATION_INPUT_TOKEN_LIMIT
            : FREE_GENERATION_INPUT_TOKEN_LIMIT;
          let sampleInfo: DiagramSampleInfo | null = null;
          if (estimate.explanationInputTokens > inputTokenLimit) {
            const treeTokens = estimateTokens(githubData.fileTree);
            const overage = estimate.explanationInputTokens - inputTokenLimit;
            const treeBudget = treeTokens - overage - TRUNCATION_TOKEN_MARGIN;
            if (treeBudget >= MIN_TREE_TOKEN_BUDGET) {
              const fitted = fitFileTreeToTokenBudget(
                githubData.fileTree,
                treeBudget,
              );
              if (fitted.sample) {
                githubData = { ...githubData, fileTree: fitted.fileTree };
                sampleInfo = fitted.sample;
                estimate = await runEstimate();
              }
            }
          }
          const fileTreeNote = sampleInfo
            ? buildFileTreeSampleNote(sampleInfo)
            : undefined;
          const tokenCount = estimate.explanationInputTokens;

          audit = withStageUsage(
            withEstimatedCost(
              {
                ...audit,
                provider,
                model,
                sampled: sampleInfo ?? undefined,
              },
              estimate.costSummary,
            ),
            {
              stage: "estimate",
              model,
              costSummary: estimate.costSummary,
              createdAt: new Date().toISOString(),
            },
          );

          send({
            status: "started",
            session_id: audit.sessionId,
            message: "Starting generation process...",
            cost_summary: estimate.costSummary,
            sampled: sampleInfo ?? undefined,
          });

          throwIfAborted(generationAbortController.signal);
          if (shouldApplyComplimentaryGate({ provider, model, apiKey })) {
            if (!modelMatchesComplimentaryFamily(model)) {
              const error = getComplimentaryModelMismatchMessage();
              audit = withFailure(
                {
                  ...audit,
                  quotaStatus: "denied",
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "COMPLIMENTARY_GATE_MODEL_MISMATCH",
                failure_stage: "started",
                validation_error: error,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }

            const requestedTokens = buildComplimentaryAdmissionTokens({
              explanationInputTokens: estimate.explanationInputTokens,
              graphStaticInputTokens: estimate.graphStaticInputTokens,
            });
            const reservation = await admitComplimentaryQuota({
              model,
              requestedTokens,
            });

            if (!reservation.admitted) {
              const error =
                reservation.message || getComplimentaryDenialMessage();
              audit = withFailure(
                {
                  ...audit,
                  quotaStatus: "denied",
                  quotaResetAt: reservation.quotaResetAt,
                },
                {
                  failureStage: "started",
                  validationError: error,
                },
              );
              await persistTerminalAudit();
              send({
                status: "error",
                session_id: audit.sessionId,
                error,
                error_code: "DAILY_FREE_TOKEN_LIMIT_REACHED",
                failure_stage: "started",
                validation_error: error,
                quota_reset_at: reservation.quotaResetAt,
                cost_summary: audit.finalCost ?? audit.estimatedCost,
                latest_session_audit: audit,
              });
              closeStream();
              return;
            }

            quotaReservation = reservation.reservation;
            audit = {
              ...audit,
              quotaStatus: "admitted",
              quotaBucket: quotaReservation.quotaBucket,
              quotaDateUtc: quotaReservation.quotaDateUtc,
              quotaResetAt: quotaReservation.quotaResetAt,
            };
          }

          if (
            tokenCount > FREE_GENERATION_INPUT_TOKEN_LIMIT &&
            tokenCount < HARD_GENERATION_INPUT_TOKEN_LIMIT &&
            !apiKey
          ) {
            const error = `File tree and README combined exceeds token limit (${FREE_GENERATION_INPUT_TOKEN_LIMIT.toLocaleString("en-US")}). This repository is too large for free generation. Provide your own ${providerLabel} API key to continue.`;
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            await persistTerminalAudit();
            send({
              status: "error",
              session_id: audit.sessionId,
              error,
              error_code: "API_KEY_REQUIRED",
              validation_error: error,
              failure_stage: "started",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            closeStream();
            return;
          }

          if (tokenCount > HARD_GENERATION_INPUT_TOKEN_LIMIT) {
            const error =
              "Repository is too large (>195k tokens) for analysis. Try a smaller repo.";
            audit = withFailure(audit, {
              failureStage: "started",
              validationError: error,
            });
            await persistTerminalAudit();
            send({
              status: "error",
              session_id: audit.sessionId,
              error,
              error_code: "TOKEN_LIMIT_EXCEEDED",
              validation_error: error,
              failure_stage: "started",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            closeStream();
            return;
          }

          audit = withTimelineEvent(
            audit,
            "explanation_sent",
            `Sending explanation request to ${model}...`,
          );
          send({
            status: "explanation_sent",
            session_id: audit.sessionId,
            message: `Sending explanation request to ${model}...`,
          });
          await sleep(80);
          throwIfAborted(generationAbortController.signal);

          audit = withTimelineEvent(
            audit,
            "explanation",
            "Analyzing repository structure...",
          );
          send({
            status: "explanation",
            session_id: audit.sessionId,
            message: "Analyzing repository structure...",
          });

          let explanationResponse = "";
          const explanationStream = await streamCompletion({
            provider,
            model,
            systemPrompt: SYSTEM_FIRST_PROMPT,
            userPrompt: toTaggedMessage({
              file_tree: githubData.fileTree,
              file_tree_note: fileTreeNote,
              readme: githubData.readme,
            }),
            apiKey,
            reasoningEffort: "medium",
            maxOutputTokens: EXPLANATION_MAX_OUTPUT_TOKENS,
            signal: generationAbortController.signal,
          });
          for await (const chunk of explanationStream.stream) {
            throwIfAborted(generationAbortController.signal);
            explanationResponse += chunk;
            send({
              status: "explanation_chunk",
              session_id: audit.sessionId,
              chunk,
            });
          }
          let explanationUsage: GenerationTokenUsage | null = null;
          try {
            explanationUsage = await explanationStream.usagePromise;
          } catch {
            hasCompleteMeasuredUsage = false;
          }
          if (explanationUsage) {
            actualUsages.push(explanationUsage);
            audit = withStageUsage(audit, {
              stage: "explanation",
              model,
              costSummary: createCostSummary({
                kind: "actual",
                model,
                usage: explanationUsage,
                approximate: false,
              }),
              createdAt: new Date().toISOString(),
            });
          } else {
            hasCompleteMeasuredUsage = false;
          }

          const explanation = extractTaggedSection(
            explanationResponse,
            "explanation",
          );
          if (!explanation.trim()) {
            throw new Error(
              "OpenAI explanation generation returned no usable output.",
            );
          }
          audit = withExplanation(audit, explanation);

          const fileTreeLookup = buildFileTreeLookup(githubData.fileTree);
          let validGraph = null;
          let validationFeedback: string | undefined;
          let previousGraphRaw: string | undefined;

          send({
            status: "graph_sent",
            session_id: audit.sessionId,
            message: `Sending graph planning request to ${model}...`,
          });

          for (let attempt = 1; attempt <= MAX_GRAPH_ATTEMPTS; attempt++) {
            throwIfAborted(generationAbortController.signal);
            const status = attempt === 1 ? "graph" : "graph_retry";
            const message =
              attempt === 1
                ? "Planning repository graph..."
                : `Retrying graph planning (${attempt}/${MAX_GRAPH_ATTEMPTS})...`;

            audit = withTimelineEvent(audit, status, message);
            send({
              status,
              session_id: audit.sessionId,
              message,
              graph_attempts: audit.graphAttempts,
            });

            const {
              output: graph,
              rawText,
              usage,
            } = await generateStructuredOutput({
              provider,
              model,
              systemPrompt: SYSTEM_GRAPH_PROMPT,
              userPrompt: toTaggedMessage({
                explanation,
                file_tree: githubData.fileTree,
                file_tree_note: fileTreeNote,
                repo_owner: username,
                repo_name: repo,
                previous_graph: previousGraphRaw,
                validation_feedback: validationFeedback,
              }),
              schema: diagramGraphSchema,
              schemaName: "diagram_graph",
              apiKey,
              reasoningEffort: "low",
              maxOutputTokens: GRAPH_MAX_OUTPUT_TOKENS,
              signal: generationAbortController.signal,
            });

            if (usage) {
              actualUsages.push(usage);
              audit = withStageUsage(audit, {
                stage: "graph_attempt",
                attempt,
                model,
                costSummary: createCostSummary({
                  kind: "actual",
                  model,
                  usage,
                  approximate: false,
                }),
                createdAt: new Date().toISOString(),
              });
            } else {
              hasCompleteMeasuredUsage = false;
            }

            send({
              status,
              session_id: audit.sessionId,
              graph,
            });

            const graphValidation = validateDiagramGraph(graph, fileTreeLookup);
            const attemptAudit = {
              attempt,
              rawOutput: rawText,
              graph,
              validationFeedback: graphValidation.valid
                ? undefined
                : formatGraphValidationFeedback(graphValidation.issues),
              status: (graphValidation.valid ? "succeeded" : "failed") as
                | "failed"
                | "succeeded",
              createdAt: new Date().toISOString(),
            };

            audit = withGraphAttempt(audit, attemptAudit);

            if (!graphValidation.valid) {
              validationFeedback = formatGraphValidationFeedback(
                graphValidation.issues,
              );
              previousGraphRaw = rawText;
              audit = withTimelineEvent(
                audit,
                "graph_validating",
                `Graph validation failed on attempt ${attempt}/${MAX_GRAPH_ATTEMPTS}.`,
              );
              send({
                status: "graph_validating",
                session_id: audit.sessionId,
                message: `Graph validation failed on attempt ${attempt}/${MAX_GRAPH_ATTEMPTS}.`,
                validation_error: validationFeedback,
                graph_attempts: audit.graphAttempts,
              });
              continue;
            }

            validGraph = graph;
            audit = withGraph(audit, graph);
            break;
          }

          if (!validGraph) {
            const latestValidationError =
              validationFeedback ??
              "Graph generation failed validation after the maximum number of attempts.";
            audit = withFailure(audit, {
              failureStage: "graph_validating",
              validationError: latestValidationError,
            });
            await persistTerminalAudit();
            send({
              status: "error",
              session_id: audit.sessionId,
              error:
                "Graph generation remained invalid after retry attempts. Please retry generation.",
              error_code: "GRAPH_VALIDATION_FAILED",
              validation_error: latestValidationError,
              failure_stage: "graph_validating",
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            closeStream();
            return;
          }

          audit = withTimelineEvent(
            audit,
            "diagram_compiling",
            "Compiling Mermaid diagram...",
          );
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiling Mermaid diagram...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
          });

          throwIfAborted(generationAbortController.signal);
          const diagram = compileDiagramGraph({
            graph: validGraph,
            username,
            repo,
            branch: githubData.resolvedRef,
          });
          audit = withCompiledDiagram(audit, diagram);
          send({
            status: "diagram_compiling",
            session_id: audit.sessionId,
            message: "Compiled Mermaid diagram. Validating syntax...",
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
            diagram,
          });

          throwIfAborted(generationAbortController.signal);
          const mermaidValidation = await validateMermaidSyntax(diagram);
          if (!mermaidValidation.valid) {
            const compilerError =
              mermaidValidation.message ??
              "Compiled Mermaid failed validation.";
            audit = withFailure(audit, {
              failureStage: "diagram_compiling",
              compilerError,
            });
            await persistTerminalAudit();
            send({
              status: "error",
              session_id: audit.sessionId,
              error: "Compiled Mermaid failed validation.",
              error_code: "COMPILER_VALIDATION_FAILED",
              failure_stage: "diagram_compiling",
              validation_error: compilerError,
              cost_summary: audit.finalCost ?? audit.estimatedCost,
              latest_session_audit: audit,
            });
            closeStream();
            return;
          }

          const finalCost = hasCompleteMeasuredUsage
            ? createCostSummary({
                kind: "actual",
                model,
                usage: sumGenerationUsage(...actualUsages),
                approximate: false,
              })
            : {
                ...estimate.costSummary,
                kind: "actual" as const,
                note: "Some stage usage was unavailable, so the final cost remains approximate.",
              };
          throwIfAborted(generationAbortController.signal);
          audit = withFinalCost(audit, finalCost);
          audit = withSuccess(
            withTimelineEvent(
              audit,
              "complete",
              "Diagram generation complete.",
            ),
          );
          await saveSuccessfulDiagramState({
            username,
            repo,
            githubPat,
            visibility: storageVisibility,
            stargazerCount: githubData.stargazerCount,
            explanation,
            graph: validGraph,
            diagram,
            audit,
            usedOwnKey: Boolean(apiKey),
            variant,
            ref: githubData.resolvedRef,
            subdir: githubData.subdir,
            commitSha: githubData.commitSha,
          });

          if (storageVisibility === "public" && isDefaultRepoVariant) {
            const lastSuccessfulAt =
              audit.updatedAt ?? new Date().toISOString();
            postResponseTasks.push(async () => {
              try {
                revalidatePath(getRepoPagePath(username, repo));
                revalidateTag(
                  getPublicDiagramStateCacheTag(username, repo),
                  "max",
                );
                await updatePublicBrowseIndexForSuccessfulDiagram({
                  username,
                  repo,
                  lastSuccessfulAt,
                  stargazerCount: githubData.stargazerCount,
                });
                revalidateBrowseIndexCache();
              } catch (error) {
                console.error(
                  "Failed to update browse index after completion:",
                  error,
                );
              }
            });
          }

          send({
            status: "complete",
            session_id: audit.sessionId,
            cost_summary: audit.finalCost ?? audit.estimatedCost,
            diagram,
            explanation,
            graph: validGraph,
            graph_attempts: audit.graphAttempts,
            latest_session_audit: audit,
            generated_at: audit.updatedAt,
            sampled: sampleInfo ?? undefined,
          });
        } catch (error) {
          if (isAbortError(error)) {
            wasCancelled = true;
            return;
          }
          hasCompleteMeasuredUsage = false;
          const rawMessage =
            error instanceof Error
              ? error.message
              : "Streaming generation failed.";
          const { message, errorCode } = normalizeGenerationError({
            provider: audit.provider,
            apiKey,
            message: rawMessage,
          });
          const failedAudit = withFailure(audit, {
            failureStage: audit.stage || "started",
            validationError: message,
          });
          try {
            await persistTerminalAudit(failedAudit);
          } catch {
            // Best effort persistence.
          }

          send({
            status: "error",
            session_id: failedAudit.sessionId,
            error: message,
            error_code: errorCode,
            failure_stage: failedAudit.failureStage,
            validation_error: failedAudit.validationError,
            cost_summary: failedAudit.finalCost ?? failedAudit.estimatedCost,
            latest_session_audit: failedAudit,
          });
        } finally {
          if (quotaReservation) {
            const measuredCommittedTokens = sumGenerationUsage(
              ...actualUsages,
            ).totalTokens;
            const actualCommittedTokens = measuredCommittedTokens;

            audit = {
              ...audit,
              quotaStatus: "finalized",
              quotaBucket: quotaReservation.quotaBucket,
              quotaDateUtc: quotaReservation.quotaDateUtc,
              actualCommittedTokens,
              quotaResetAt: quotaReservation.quotaResetAt,
            };

            try {
              await finalizeComplimentaryQuota({
                reservation: quotaReservation,
                committedTokens: actualCommittedTokens,
              });
              if (!wasCancelled) {
                await persistTerminalAudit();
              }
            } catch {
              // Best effort quota finalization and audit persistence.
            }
          }
          try {
            await progressChain;
          } catch {
            // Progress writes are best-effort.
          }
          closeStream();
          resolveRunFinished();
        }
      };

      void run();
    },
    cancel() {
      // The client went away; keep generating so the result is persisted and
      // the session can be resumed via GET ?session_id=….
      clientGone = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

const RESUME_POLL_INTERVAL_MS = 800;
const RESUME_MAX_DURATION_MS = 290_000;

function progressSnapshotToStreamMessage(
  snapshot: GenerationProgressSnapshot,
): Record<string, unknown> {
  return {
    // Chunk events are cumulative in the snapshot, so a resumer receives the
    // full explanation under the plain "explanation" status.
    status:
      snapshot.status === "explanation_chunk" ? "explanation" : snapshot.status,
    session_id: snapshot.sessionId,
    message: snapshot.message,
    cost_summary: snapshot.costSummary,
    quota_reset_at: snapshot.quotaResetAt,
    explanation: snapshot.explanation,
    diagram: snapshot.diagram,
    graph: snapshot.graph,
    graph_attempts: snapshot.graphAttempts,
    sampled: snapshot.sampled ?? undefined,
    error: snapshot.error,
    error_code: snapshot.errorCode,
    validation_error: snapshot.validationError,
    failure_stage: snapshot.failureStage,
    latest_session_audit: snapshot.latestSessionAudit,
    generated_at: snapshot.generatedAt,
    resumed: true,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id")?.trim();

  if (!sessionId) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "session_id is required.",
        error_code: "VALIDATION_ERROR",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseMessage(payload)));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const run = async () => {
        const deadline = Date.now() + RESUME_MAX_DURATION_MS;
        let lastSeq = -1;

        while (Date.now() < deadline) {
          if (request.signal.aborted) {
            close();
            return;
          }

          let snapshot: GenerationProgressSnapshot | null = null;
          try {
            snapshot = await readGenerationProgress(sessionId);
          } catch {
            snapshot = null;
          }

          if (!snapshot) {
            send({
              status: "error",
              session_id: sessionId,
              error:
                "No resumable generation was found for this session. Please regenerate.",
              error_code: "RESUME_NOT_FOUND",
            });
            close();
            return;
          }

          if (snapshot.seq !== lastSeq) {
            lastSeq = snapshot.seq;
            send(progressSnapshotToStreamMessage(snapshot));
          }

          if (isTerminalProgressStatus(snapshot.status)) {
            close();
            return;
          }

          await sleep(RESUME_POLL_INTERVAL_MS);
        }

        send({
          status: "error",
          session_id: sessionId,
          error: "Timed out waiting for the generation to finish.",
          error_code: "RESUME_TIMEOUT",
        });
        close();
      };

      run().catch(() => close());
    },
    cancel() {
      // Reader went away; polling loop exits on the aborted signal.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
