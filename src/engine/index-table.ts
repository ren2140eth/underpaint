/**
 * The browse surface's data model.
 *
 * `data/index.json` is 188 KB gzipped and carries palettes and data-quality
 * counters that nothing on the index renders. The table ships to every visitor,
 * so it gets a trimmed row — 96 KB gzipped — and the rest stays on the server.
 *
 * Sorting happens in the browser because the site is statically exported: there
 * is nowhere to sort. That makes the comparator part of the product rather than
 * an implementation detail, which is why it is here and tested.
 */

import type { CanvasStats } from "./stats";

/** One canvas as the index renders it. Everything here is displayed or sorted. */
export interface IndexRow {
  day: number;
  name: string;
  size: number;

  placed: number;
  visible: number;
  buriedShare: number;
  coverage: number;
  meanDepth: number;

  artists: number;
  artistsVisible: number;
  topShare: number;
  hhi: number;
  lateSurge: number;

  mints: number;
  earnedEth: number;
  /** null when a canvas has no mints — absent, not zero */
  effortPerMint: number | null;
}

export type SortKey = keyof IndexRow;
export type SortDirection = "asc" | "desc";

/**
 * Settled canvases only, trimmed to what the table shows.
 *
 * A canvas whose mint window is still open has provisional mints, earnings and
 * effort-per-mint, so ranking it beside finished canvases compares a number
 * that is still moving.
 */
export function indexRows(canvases: CanvasStats[]): IndexRow[] {
  return canvases
    .filter((c) => !c.mintWindowOpen)
    .map((c) => ({
      day: c.day,
      name: c.name,
      size: c.size,
      placed: c.placed,
      visible: c.visible,
      buriedShare: c.buriedShare,
      coverage: c.coverage,
      meanDepth: c.meanDepth,
      artists: c.artists,
      artistsVisible: c.artistsVisible,
      topShare: c.topShare,
      hhi: c.hhi,
      lateSurge: c.lateSurge,
      mints: c.mints,
      earnedEth: c.earnedEth,
      effortPerMint: c.effortPerMint,
    }));
}

/**
 * A copy of `rows` in the requested order.
 *
 * Ties break by day, so a given column and direction always produce the same
 * page — the index is meant to be linked to. Rows with no value sort last in
 * both directions rather than counting as zero.
 */
export function sortRows(rows: IndexRow[], key: SortKey, dir: SortDirection): IndexRow[] {
  const sign = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];

    if (x === null || y === null) {
      if (x === y) return a.day - b.day;
      return x === null ? 1 : -1;
    }

    if (typeof x === "string" && typeof y === "string") {
      return sign * x.localeCompare(y, "en", { sensitivity: "base" }) || a.day - b.day;
    }

    return sign * ((x as number) - (y as number)) || a.day - b.day;
  });
}
