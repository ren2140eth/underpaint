import type { Metadata } from "next";
import { indexTable } from "../../src/engine/index-data";
import CanvasIndex from "./CanvasIndex";

export const metadata: Metadata = {
  title: "Every BasePaint canvas, by what it buried | Underpaint",
  description:
    "All 1,089 settled BasePaint canvases, sorted by buried labour, coverage, concentration and what they earned. Numbers nobody else computes.",
};

export default function CanvasesPage() {
  const rows = indexTable();

  // Archive-wide totals, computed here so the client never sees the full index.
  const placed = rows.reduce((n, r) => n + r.placed, 0);
  const visible = rows.reduce((n, r) => n + r.visible, 0);

  return <CanvasIndex rows={rows} placed={placed} visible={visible} />;
}
