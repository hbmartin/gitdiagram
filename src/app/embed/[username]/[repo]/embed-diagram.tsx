"use client";

import MermaidChart from "~/components/mermaid-diagram";

export default function EmbedDiagram({ chart }: { chart: string }) {
  return (
    <MermaidChart
      chart={chart}
      zoomingEnabled={false}
      fitToContainer
      containerClassName="h-full p-2"
    />
  );
}
