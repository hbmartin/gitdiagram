"use client";

import { ExternalLink, FolderSearch } from "lucide-react";

export interface DrillDownTarget {
  x: number;
  y: number;
  githubUrl: string;
  subdir: string;
}

interface DrillDownMenuProps {
  target: DrillDownTarget;
  onDrillDown: () => void;
  onDismiss: () => void;
}

const MENU_WIDTH = 240;
const MENU_HEIGHT = 96;

export function DrillDownMenu({
  target,
  onDrillDown,
  onDismiss,
}: DrillDownMenuProps) {
  const left = Math.min(
    target.x,
    (typeof window !== "undefined" ? window.innerWidth : MENU_WIDTH) -
      MENU_WIDTH -
      8,
  );
  const top = Math.min(
    target.y,
    (typeof window !== "undefined" ? window.innerHeight : MENU_HEIGHT) -
      MENU_HEIGHT -
      8,
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-label={`Actions for ${target.subdir}`}
        className="fixed z-50 w-60 rounded-md border-2 border-black bg-white p-1 shadow-lg dark:border-neutral-600 dark:bg-neutral-900"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      >
        <div className="truncate px-2 py-1 text-xs font-semibold text-gray-500 dark:text-neutral-400">
          {target.subdir}/
        </div>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-purple-100 dark:hover:bg-purple-950"
          onClick={onDrillDown}
        >
          <FolderSearch size={16} />
          Diagram this directory
        </button>
        <a
          role="menuitem"
          href={target.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-purple-100 dark:hover:bg-purple-950"
          onClick={onDismiss}
        >
          <ExternalLink size={16} />
          Open on GitHub
        </a>
      </div>
    </>
  );
}
