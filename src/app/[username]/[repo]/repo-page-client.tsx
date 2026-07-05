"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DiagramStateResponse } from "~/features/diagram/types";
import { parseGitHubRepoUrl } from "~/features/diagram/github-url";
import {
  DrillDownMenu,
  type DrillDownTarget,
} from "~/components/drill-down-menu";
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
import {
  VersionHistory,
  type DiagramVersionView,
} from "~/components/version-history";
import { MermaidEditor } from "~/components/mermaid-editor";
import { Pencil } from "lucide-react";
import type { RepoStaleness } from "~/server/repo-staleness";

type RepoPageClientProps = {
  username: string;
  repo: string;
  initialState?: DiagramStateResponse | null;
  staleness?: RepoStaleness | null;
};

export default function RepoPageClient({
  username,
  repo,
  initialState = null,
  staleness = null,
}: RepoPageClientProps) {
  // The server page is static (ISR) and cannot read search params; the
  // ref/subdir variant scope is resolved here on the client instead.
  const searchParams = useSearchParams();
  const diagramRef = searchParams.get("ref")?.trim() || null;
  const subdir = searchParams.get("subdir")?.trim() || null;
  const isScopedVariant = Boolean(diagramRef || subdir);

  // The server-provided initial state is always the default variant, so a
  // scoped page must resolve its own state from scratch.
  if (isScopedVariant) {
    initialState = null;
    staleness = null;
  }
  const [zoomingEnabled, setZoomingEnabled] = useState(false);
  const [diagramRendered, setDiagramRendered] = useState(false);
  const [drillTarget, setDrillTarget] = useState<DrillDownTarget | null>(null);
  const [viewedVersion, setViewedVersion] = useState<DiagramVersionView | null>(
    null,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [editedDiagram, setEditedDiagram] = useState<string | null>(null);
  const router = useRouter();

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
    handleExportSvg,
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
  const displayedDiagram = viewedVersion?.diagram ?? editedDiagram ?? diagram;
  const showStalenessBanner =
    !viewedVersion && Boolean(staleness && staleness.aheadBy > 0);

  // Local edits belong to the diagram they were made on; drop them when the
  // underlying generated diagram changes (regeneration, new data).
  useEffect(() => {
    setEditedDiagram(null);
  }, [diagram]);

  const handleCopyDisplayed = useCallback(() => {
    if (editedDiagram && !viewedVersion) {
      void navigator.clipboard.writeText(editedDiagram);
      return;
    }
    handleCopy();
  }, [editedDiagram, handleCopy, viewedVersion]);

  const handleDiagramRenderComplete = useCallback(() => {
    setDiagramRendered(true);
  }, []);

  const handleNodeLinkClick = useCallback(
    (href: string, event: MouseEvent) => {
      // Only intercept directory (/tree/) links pointing at this repository;
      // file links keep their default open-on-GitHub behavior.
      if (!href.includes("/tree/")) return false;
      const parsed = parseGitHubRepoUrl(href);
      if (
        !parsed?.subdir ||
        parsed.username.toLowerCase() !== normalizedUsername ||
        parsed.repo.toLowerCase() !== normalizedRepo
      ) {
        return false;
      }

      setDrillTarget({
        x: event.clientX,
        y: event.clientY,
        githubUrl: href,
        subdir: parsed.subdir,
      });
      return true;
    },
    [normalizedRepo, normalizedUsername],
  );

  const handleDrillDown = useCallback(() => {
    if (!drillTarget) return;
    const query = new URLSearchParams();
    if (diagramRef) query.set("ref", diagramRef);
    query.set("subdir", drillTarget.subdir);
    setDrillTarget(null);
    router.push(`/${normalizedUsername}/${normalizedRepo}?${query.toString()}`);
  }, [diagramRef, drillTarget, normalizedRepo, normalizedUsername, router]);

  useEffect(() => {
    setDiagramRendered(false);
  }, [displayedDiagram, zoomingEnabled]);

  return (
    <div className="flex flex-col items-center p-4">
      <div className="flex w-full justify-center pt-8">
        <MainCard
          isHome={false}
          username={normalizedUsername}
          repo={normalizedRepo}
          hasDiagram={hasDiagram}
          onCopy={handleCopyDisplayed}
          lastGenerated={lastGenerated}
          actualCost={
            state.costSummary?.kind === "actual"
              ? state.costSummary.display
              : undefined
          }
          onExportImage={handleExportImage}
          onExportSvg={handleExportSvg}
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
                {showStalenessBanner && staleness && (
                  <div
                    role="note"
                    className="mx-4 flex max-w-3xl flex-wrap items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200"
                  >
                    <span>
                      This diagram was generated at commit{" "}
                      <code>{staleness.commitSha.slice(0, 7)}</code> — the
                      repository has moved{" "}
                      {staleness.aheadBy.toLocaleString("en-US")} commit
                      {staleness.aheadBy === 1 ? "" : "s"} since. Use
                      “Regenerate Diagram” to refresh it.
                    </span>
                  </div>
                )}
                {viewedVersion && (
                  <div
                    role="note"
                    className="mx-4 flex max-w-3xl flex-wrap items-center gap-2 rounded-md border border-purple-300 bg-purple-50 px-3 py-2 text-sm text-purple-900 dark:border-purple-700 dark:bg-purple-950 dark:text-purple-200"
                  >
                    <span>
                      Viewing the version generated on{" "}
                      {new Date(viewedVersion.generatedAt).toLocaleString()}
                      {viewedVersion.commitSha ? (
                        <>
                          {" "}
                          at commit{" "}
                          <code>{viewedVersion.commitSha.slice(0, 7)}</code>
                        </>
                      ) : null}
                      .
                    </span>
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => setViewedVersion(null)}
                    >
                      Back to latest
                    </button>
                  </div>
                )}
                <div className="flex w-full max-w-3xl flex-wrap items-center gap-4">
                  <VersionHistory
                    username={normalizedUsername}
                    repo={normalizedRepo}
                    diagramRef={diagramRef}
                    subdir={subdir}
                    activeVersionId={viewedVersion?.id ?? null}
                    onSelectVersion={setViewedVersion}
                  />
                  {!viewedVersion && (
                    <button
                      type="button"
                      onClick={() => setEditorOpen((prev) => !prev)}
                      aria-expanded={editorOpen}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-gray-700 hover:bg-purple-100 dark:text-neutral-300 dark:hover:bg-purple-950"
                    >
                      <Pencil size={15} />
                      {editorOpen ? "Close editor" : "Edit diagram"}
                    </button>
                  )}
                </div>
                {editorOpen && !viewedVersion && (
                  <MermaidEditor
                    value={editedDiagram ?? diagram}
                    onApply={(next) =>
                      setEditedDiagram(next === diagram ? null : next)
                    }
                    onReset={() => setEditedDiagram(null)}
                    isEdited={Boolean(editedDiagram)}
                  />
                )}
                <div className="flex w-full justify-center px-4">
                  <MermaidChart
                    chart={displayedDiagram}
                    zoomingEnabled={zoomingEnabled}
                    onRenderError={handleDiagramRenderError}
                    onRenderComplete={handleDiagramRenderComplete}
                    onNodeLinkClick={handleNodeLinkClick}
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

      {drillTarget && (
        <DrillDownMenu
          target={drillTarget}
          onDrillDown={handleDrillDown}
          onDismiss={() => setDrillTarget(null)}
        />
      )}

      <ApiKeyDialog
        isOpen={showApiKeyDialog}
        onClose={handleCloseApiKeyDialog}
        onSubmit={handleApiKeySubmit}
      />
    </div>
  );
}
