import { Code2, FileCode, Image } from "lucide-react";
import { toast } from "sonner";

import { SITE_URL } from "~/lib/site";
import { CopyButton } from "./copy-button";
import { ActionButton } from "./action-button";

interface ExportDropdownProps {
  onCopy: () => void;
  lastGenerated?: Date;
  actualCost?: string;
  onExportImage: () => void;
  onExportSvg?: () => void;
  username?: string;
  repo?: string;
}

function buildBadgeMarkdown(username: string, repo: string): string {
  const badgeUrl = `${SITE_URL}/api/badge?username=${encodeURIComponent(username)}&repo=${encodeURIComponent(repo)}`;
  const pageUrl = `${SITE_URL}/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`;
  return `[![Architecture](${badgeUrl})](${pageUrl})`;
}

function buildEmbedHtml(username: string, repo: string): string {
  const embedUrl = `${SITE_URL}/embed/${encodeURIComponent(username)}/${encodeURIComponent(repo)}`;
  return `<iframe src="${embedUrl}" width="100%" height="500" style="border:1px solid #e5e7eb;border-radius:8px;" title="${username}/${repo} architecture diagram"></iframe>`;
}

async function copyWithToast(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("Could not copy to clipboard.");
  }
}

export function ExportDropdown({
  onCopy,
  lastGenerated,
  actualCost,
  onExportImage,
  onExportSvg,
  username,
  repo,
}: ExportDropdownProps) {
  const hasRepoContext = Boolean(username && repo);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
        <ActionButton
          onClick={onExportImage}
          icon={Image}
          tooltipText="Download diagram as high-quality PNG"
          text="Download PNG"
        />
        {onExportSvg && (
          <ActionButton
            onClick={onExportSvg}
            icon={FileCode}
            tooltipText="Download diagram as a scalable SVG"
            text="Download SVG"
          />
        )}
        <CopyButton onClick={onCopy} />
      </div>
      {hasRepoContext && (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
          <ActionButton
            onClick={() =>
              void copyWithToast(
                buildBadgeMarkdown(username!, repo!),
                "README badge markdown copied.",
              )
            }
            icon={Code2}
            tooltipText="Copy a markdown badge that links to this diagram"
            text="Copy README badge"
          />
          <ActionButton
            onClick={() =>
              void copyWithToast(
                buildEmbedHtml(username!, repo!),
                "Embed HTML copied.",
              )
            }
            icon={Code2}
            tooltipText="Copy an <iframe> snippet that embeds this diagram"
            text="Copy embed HTML"
          />
        </div>
      )}

      {lastGenerated ? (
        <div className="flex items-center">
          <span className="text-sm text-gray-700 dark:text-neutral-300">
            Last generated: {lastGenerated.toLocaleString()}
          </span>
        </div>
      ) : null}
      {actualCost ? (
        <div className="flex items-center">
          <span className="text-sm text-gray-700 dark:text-neutral-300">
            Actual cost: {actualCost}
          </span>
        </div>
      ) : null}
    </div>
  );
}
