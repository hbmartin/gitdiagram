import { NextResponse } from "next/server";

import {
  getDiagramVersion,
  listDiagramVersions,
} from "~/server/storage/version-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readParams(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username")?.trim().toLowerCase();
  const repo = url.searchParams.get("repo")?.trim().toLowerCase();
  const ref = url.searchParams.get("ref")?.trim() || null;
  const subdir = url.searchParams.get("subdir")?.trim() || null;
  const id = url.searchParams.get("id")?.trim() || null;
  const githubPat = request.headers.get("x-github-pat")?.trim() || undefined;

  return { username, repo, ref, subdir, id, githubPat };
}

export async function GET(request: Request) {
  const { username, repo, ref, subdir, id, githubPat } = readParams(request);

  if (!username || !repo) {
    return NextResponse.json(
      { ok: false, error: "username and repo are required." },
      { status: 400 },
    );
  }

  try {
    if (id) {
      const artifact = await getDiagramVersion({
        username,
        repo,
        githubPat,
        variant: { ref, subdir },
        id,
      });
      if (!artifact) {
        return NextResponse.json(
          { ok: false, error: "Version not found." },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        version: {
          diagram: artifact.diagram,
          explanation: artifact.explanation,
          generatedAt: artifact.generatedAt,
          commitSha: artifact.commitSha ?? null,
          ref: artifact.ref ?? null,
          subdir: artifact.subdir ?? null,
        },
      });
    }

    const entries = await listDiagramVersions({
      username,
      repo,
      githubPat,
      variant: { ref, subdir },
    });
    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to load versions.",
      },
      { status: 500 },
    );
  }
}
