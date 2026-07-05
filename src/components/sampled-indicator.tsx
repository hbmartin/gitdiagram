import type { DiagramSampleInfo } from "~/features/diagram/graph";

interface SampledIndicatorProps {
  sampled?: DiagramSampleInfo | null;
}

export function SampledIndicator({ sampled }: SampledIndicatorProps) {
  if (!sampled) {
    return null;
  }

  const included = sampled.includedPaths.toLocaleString("en-US");
  const total = sampled.totalPaths.toLocaleString("en-US");

  return (
    <div
      role="note"
      className="mx-4 flex max-w-3xl items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <span aria-hidden>⚠️</span>
      <span>
        Partial view: this repository is large, so {included} of {total} file
        paths were considered when generating this diagram.
      </span>
    </div>
  );
}
