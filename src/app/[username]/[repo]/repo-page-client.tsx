"use client";

import { useCallback, useEffect, useState } from "react";
import type { DiagramStateResponse } from "~/features/diagram/types";
import MainCard from "~/components/main-card";
import Loading from "~/components/loading";
import MermaidChart from "~/components/mermaid-diagram";
import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import { useDiagram } from "~/hooks/useDiagram";
import { ApiKeyDialog } from "~/components/api-key-dialog";
import { ApiKeyButton } from "~/components/api-key-button";
import { useStarReminder } from "~/hooks/useStarReminder";
import { SponsorSlot } from "~/components/sponsor-slot";
import { SampledIndicator } from "~/components/sampled-indicator";

type RepoPageClientProps = {
  username: string;
  repo: string;
  diagramRef?: string | null;
  subdir?: string | null;
  initialState?: DiagramStateResponse | null;
};

export default function RepoPageClient({
  username,
  repo,
  diagramRef = null,
  subdir = null,
  initialState = null,
}: RepoPageClientProps) {
  const [zoomingEnabled, setZoomingEnabled] = useState(false);
  const [diagramRendered, setDiagramRendered] = useState(false);

  useStarReminder();

  const normalizedUsername = username.toLowerCase();
  const normalizedRepo = repo.toLowerCase();

  const {
    diagram,
    error,
    loading,
    lastGenerated,
    showApiKeyDialog,
    handleCopy,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state,
  } = useDiagram(normalizedUsername, normalizedRepo, initialState, {
    ref: diagramRef,
    subdir,
  });

  const hasScope = Boolean(diagramRef || subdir);

  const hasDiagram = Boolean(diagram);
  const hasError = Boolean(error || state.error);

  const handleDiagramRenderComplete = useCallback(() => {
    setDiagramRendered(true);
  }, []);

  useEffect(() => {
    setDiagramRendered(false);
  }, [diagram, zoomingEnabled]);

  return (
    <div className="flex flex-col items-center p-4">
      <div className="flex w-full justify-center pt-8">
        <MainCard
          isHome={false}
          username={normalizedUsername}
          repo={normalizedRepo}
          hasDiagram={hasDiagram}
          onCopy={handleCopy}
          lastGenerated={lastGenerated}
          actualCost={
            state.costSummary?.kind === "actual"
              ? state.costSummary.display
              : undefined
          }
          onExportImage={handleExportImage}
          onRegenerate={handleRegenerate}
          zoomingEnabled={zoomingEnabled}
          onZoomToggle={() => setZoomingEnabled((prev) => !prev)}
          loading={loading}
        />
      </div>
      {hasScope && (
        <div className="mt-4 flex max-w-3xl flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md border border-purple-300 bg-purple-50 px-2 py-1 font-medium text-purple-900 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200">
            {diagramRef ? `ref: ${diagramRef}` : null}
            {diagramRef && subdir ? " · " : null}
            {subdir ? `path: ${subdir}/` : null}
          </span>
          <a
            href={`/${normalizedUsername}/${normalizedRepo}`}
            className="text-purple-700 underline hover:text-purple-900 dark:text-purple-300"
          >
            View full repository diagram
          </a>
        </div>
      )}
      <div className="mt-8 flex w-full flex-col items-center gap-8">
        {loading ? (
          <Loading
            costSummary={state.costSummary}
            status={state.status}
            message={state.message}
            explanation={state.explanation}
            graph={state.graph}
            graphAttempts={state.graphAttempts}
            validationError={state.validationError}
            diagram={state.diagram}
          />
        ) : (
          <div className="flex w-full flex-col items-center gap-8">
            {hasDiagram && (
              <>
                <SampledIndicator sampled={state.sampled} />
                <div className="flex w-full justify-center px-4">
                  <MermaidChart
                    chart={diagram}
                    zoomingEnabled={zoomingEnabled}
                    onRenderError={handleDiagramRenderError}
                    onRenderComplete={handleDiagramRenderComplete}
                  />
                </div>
                {diagramRendered && (
                  <SponsorSlot
                    surface="diagram"
                    className="mx-4 mb-8 max-w-5xl sm:mb-12"
                  />
                )}
              </>
            )}
            {hasError && (
              <div className="w-full max-w-5xl text-center">
                <GenerationAuditPanel
                  audit={state.latestSessionAudit}
                  error={error || state.error}
                />
                {(error?.includes("API key") ||
                  state.error?.includes("API key")) && (
                  <div className="mt-8 flex flex-col items-center gap-2">
                    <ApiKeyButton onClick={handleOpenApiKeyDialog} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ApiKeyDialog
        isOpen={showApiKeyDialog}
        onClose={handleCloseApiKeyDialog}
        onSubmit={handleApiKeySubmit}
      />
    </div>
  );
}
