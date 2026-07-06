import { useCallback } from "react";

import {
  exportMermaidSvg,
  exportMermaidSvgAsPng,
} from "~/features/diagram/export";

export function useDiagramExport(diagram: string) {
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(diagram);
  }, [diagram]);

  const handleExportImage = useCallback(() => {
    const svgElement = document.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return;

    exportMermaidSvgAsPng(svgElement);
  }, []);

  const handleExportSvg = useCallback(() => {
    const svgElement = document.querySelector(".mermaid svg");
    if (!(svgElement instanceof SVGSVGElement)) return;

    exportMermaidSvg(svgElement);
  }, []);

  return {
    handleCopy,
    handleExportImage,
    handleExportSvg,
  };
}
