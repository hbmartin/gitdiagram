import { getPublicDiagramPreview } from "~/server/storage/artifact-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAR_WIDTH = 6.5;
const HORIZONTAL_PADDING = 10;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function segmentWidth(text: string): number {
  return Math.ceil(text.length * CHAR_WIDTH + HORIZONTAL_PADDING);
}

/**
 * Shields-style SVG badge for embedding in READMEs. The right segment shows
 * whether a diagram exists for the repository.
 */
function renderBadge(label: string, value: string, valueColor: string): string {
  const labelWidth = segmentWidth(label);
  const valueWidth = segmentWidth(value);
  const width = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${escapeXml(value)}</text>
  </g>
</svg>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username")?.trim().toLowerCase();
  const repo = url.searchParams.get("repo")?.trim().toLowerCase();

  if (!username || !repo) {
    return new Response(renderBadge("gitdiagram", "invalid", "#e05d44"), {
      status: 400,
      headers: { "Content-Type": "image/svg+xml" },
    });
  }

  let hasDiagram = false;
  try {
    hasDiagram = Boolean(await getPublicDiagramPreview({ username, repo }));
  } catch {
    hasDiagram = false;
  }

  const svg = hasDiagram
    ? renderBadge("gitdiagram", "architecture", "#8b5cf6")
    : renderBadge("gitdiagram", "not generated", "#9f9f9f");

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
