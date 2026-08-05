import type { Metadata } from "next";
import { archiveTotals, indexTable } from "../../src/engine/index-data";
import CanvasIndex from "./CanvasIndex";

export const metadata: Metadata = {
  title: "Every BasePaint canvas, by what's underneath | Underpaint",
  description:
    "All 1,089 settled BasePaint canvases, sorted by buried paint, coverage, concentration and what they earned. Every figure is derived from the strokes.",
};

export default function CanvasesPage() {
  const rows = indexTable();

  // Totals come from the full index rather than the trimmed rows, so the
  // headline is counted the same way the Buried column is.
  const { placed, visible } = archiveTotals();

  return <CanvasIndex rows={rows} placed={placed} visible={visible} />;
}
