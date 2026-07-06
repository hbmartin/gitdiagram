"use client";

import { useCallback, useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";

export interface DiagramVersionSummary {
  id: string;
  generatedAt: string;
  commitSha: string | null;
  ref: string | null;
  subdir: string | null;
  model: string | null;
}

export interface DiagramVersionView {
  id: string;
  diagram: string;
  explanation: string | null;
  generatedAt: string;
  commitSha: string | null;
}

interface VersionHistoryProps {
  username: string;
  repo: string;
  diagramRef?: string | null;
  subdir?: string | null;
  activeVersionId: string | null;
  onSelectVersion: (version: DiagramVersionView | null) => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function buildQuery(params: VersionHistoryProps): string {
  const query = new URLSearchParams({
    username: params.username,
    repo: params.repo,
  });
  if (params.diagramRef) query.set("ref", params.diagramRef);
  if (params.subdir) query.set("subdir", params.subdir);
  return query.toString();
}

function versionRequestHeaders(): HeadersInit {
  const githubPat =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("github_pat")
      : null;
  return githubPat ? { "x-github-pat": githubPat } : {};
}

export function VersionHistory(props: VersionHistoryProps) {
  const { activeVersionId, onSelectVersion } = props;
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<DiagramVersionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/versions?${buildQuery(props)}`, {
        headers: versionRequestHeaders(),
      });
      const data = (await response.json()) as {
        ok: boolean;
        entries?: DiagramVersionSummary[];
        error?: string;
      };
      if (!data.ok) {
        throw new Error(data.error ?? "Failed to load versions.");
      }
      setEntries(data.entries ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load versions.",
      );
    } finally {
      setLoading(false);
    }
  }, [props]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && entries === null && !loading) {
        void loadEntries();
      }
      return next;
    });
  }, [entries, loadEntries, loading]);

  const handleSelect = useCallback(
    async (entry: DiagramVersionSummary) => {
      if (entry.id === activeVersionId) {
        onSelectVersion(null);
        return;
      }
      try {
        const response = await fetch(
          `/api/versions?${buildQuery(props)}&id=${encodeURIComponent(entry.id)}`,
          { headers: versionRequestHeaders() },
        );
        const data = (await response.json()) as {
          ok: boolean;
          version?: {
            diagram: string;
            explanation: string | null;
            generatedAt: string;
            commitSha: string | null;
          };
          error?: string;
        };
        if (!data.ok || !data.version) {
          throw new Error(data.error ?? "Failed to load version.");
        }
        onSelectVersion({
          id: entry.id,
          diagram: data.version.diagram,
          explanation: data.version.explanation,
          generatedAt: data.version.generatedAt,
          commitSha: data.version.commitSha,
        });
      } catch (selectError) {
        setError(
          selectError instanceof Error
            ? selectError.message
            : "Failed to load version.",
        );
      }
    },
    [activeVersionId, onSelectVersion, props],
  );

  return (
    <div className="w-full max-w-3xl text-sm">
      <button
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-gray-700 hover:bg-purple-100 dark:text-neutral-300 dark:hover:bg-purple-950"
        aria-expanded={expanded}
      >
        <History size={15} />
        Version history
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-gray-300 bg-white/70 p-2 dark:border-neutral-700 dark:bg-neutral-900/70">
          {loading && (
            <div className="px-2 py-1 text-gray-500">Loading versions…</div>
          )}
          {error && <div className="px-2 py-1 text-red-600">{error}</div>}
          {entries !== null && !entries.length && !loading && (
            <div className="px-2 py-1 text-gray-500">
              No stored versions yet. New generations are recorded from now on.
            </div>
          )}
          {entries?.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => void handleSelect(entry)}
              className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-purple-100 dark:hover:bg-purple-950 ${
                entry.id === activeVersionId
                  ? "bg-purple-100 font-semibold dark:bg-purple-950"
                  : ""
              }`}
            >
              <span>{formatDate(entry.generatedAt)}</span>
              <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-neutral-400">
                {entry.commitSha ? (
                  <code>{entry.commitSha.slice(0, 7)}</code>
                ) : null}
                {entry.model}
              </span>
            </button>
          ))}
          {activeVersionId && (
            <button
              type="button"
              onClick={() => onSelectVersion(null)}
              className="mt-1 w-full rounded border border-purple-400 px-2 py-1 font-medium text-purple-800 hover:bg-purple-100 dark:text-purple-200 dark:hover:bg-purple-950"
            >
              Back to latest version
            </button>
          )}
        </div>
      )}
    </div>
  );
}
