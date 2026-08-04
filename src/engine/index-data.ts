/**
 * Reader for the precomputed canvas index.
 *
 * `data/index.json` is committed, so every page that needs a canvas's headline
 * numbers gets them without a request. Strokes are still fetched on demand —
 * the index is 777 KB, the archive's strokes are hundreds of megabytes.
 *
 * Server-side only: importing this from a client component would ship the whole
 * index to the browser.
 */

import index from "../../data/index.json";
import { type IndexRow, indexRows } from "./index-table";
import type { CanvasStats } from "./stats";

const canvases = index.canvases as unknown as CanvasStats[];

export function allCanvases(): CanvasStats[] {
  return canvases;
}

/**
 * The browse table's payload: settled canvases, trimmed to what renders.
 *
 * This one *is* meant to reach the browser — the index page sorts client-side
 * because a statically exported site has no server to sort on.
 */
export function indexTable(): IndexRow[] {
  return indexRows(canvases);
}

export function canvasRow(day: number): CanvasStats | undefined {
  return canvases.find((c) => c.day === day);
}

/**
 * The newest canvas whose sale has closed. The very latest canvas has
 * provisional mint numbers, so it is not what the front page should open on.
 */
export function latestSettledDay(): number {
  for (let i = canvases.length - 1; i >= 0; i--) {
    if (!canvases[i].mintWindowOpen) return canvases[i].day;
  }
  return canvases[canvases.length - 1].day;
}

export function neighbours(day: number): { prev: number | null; next: number | null } {
  const i = canvases.findIndex((c) => c.day === day);
  return {
    prev: i > 0 ? canvases[i - 1].day : null,
    next: i >= 0 && i < canvases.length - 1 ? canvases[i + 1].day : null,
  };
}
