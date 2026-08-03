/**
 * Per-canvas statistics — the properties the index ranks on.
 *
 * All of it is derived from a Replay, so every number here inherits the
 * pixel-for-pixel proof in `npm run verify`. The one thing that is *not*
 * derived is mint economics, which comes from the indexer.
 *
 * Framing rule from the design: none of these are scores. Buried labour is a
 * fact about how a canvas was made, not a measure of who wasted their time.
 */

import { type CanvasMeta, dayWindow } from "./basepaint.js";
import { type Replay, UNPAINTED } from "./replay.js";

export interface CanvasStats {
  day: number;
  name: string;
  size: number;
  /** name, size and palette came from the theme API, not the indexer */
  filledFromTheme: boolean;

  /** every pixel placement that landed on the grid, including ones later covered */
  placed: number;
  /** placements the indexer recorded, which is what the day's ETH was split on */
  submitted: number;
  /**
   * Submitted pixels whose coordinates fell outside the grid, so they could
   * never appear. Coordinates are a byte each, so anything up to 255 encodes
   * fine while the 144px-era canvases only had 144 rows and columns. BasePaint's
   * own renderer discards them too — the pixel-for-pixel proof would fail
   * otherwise — but they were still paid for.
   */
  offGrid: number;
  /**
   * Placements that repainted a coordinate already covered earlier in the same
   * stroke, and `placed` with those removed. Some canvases carry blobs of a
   * hundred triplets all naming one coordinate, which the indexer counts and
   * pays out on but which puts no paint anywhere new; leaving them in `placed`
   * would inflate buried labour on exactly those canvases.
   */
  selfOverlap: number;
  distinctPlaced: number;
  /** grid slots holding paint at the end */
  visible: number;
  /** distinct placements that ended up under something else */
  buried: number;
  /** buried / distinctPlaced */
  buriedShare: number;
  /** visible / area — how much of the grid was ever reached */
  coverage: number;
  /** placements per painted slot: how many coats the average pixel took */
  meanDepth: number;
  maxDepth: number;

  artists: number;
  /** artists with at least one surviving pixel */
  artistsVisible: number;
  /** largest single artist's share of the visible image */
  topShare: number;
  /** Herfindahl index over visible shares: 1/artistsVisible (even) .. 1 (one artist) */
  hhi: number;
  /** share of the visible image laid down in the final quarter of the 24h window */
  lateSurge: number;

  mints: number;
  earnedWei: string;
  earnedEth: number;
  /** distinct placements per mint — high means a lot of work few people bought */
  effortPerMint: number | null;

  firstTime: number;
  lastTime: number;

  /** data-quality flag, surfaced by ingest rather than silently tolerated */
  strokesOutsideWindow: number;
}

export function canvasStats(r: Replay, meta: CanvasMeta): CanvasStats {
  const { start, end } = dayWindow(meta.id);
  const lateCutoff = start + 0.75 * (end - start);

  const perArtist = new Map<number, number>();
  let visible = 0;
  let late = 0;
  let maxDepth = 0;

  for (let p = 0; p < r.area; p++) {
    if (r.depth[p] > maxDepth) maxDepth = r.depth[p];
    if (r.color[p] === UNPAINTED) continue;

    visible++;
    const artist = r.owner[p];
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);

    // The surviving coat is the last event on the pixel.
    const stack = r.stacks[p];
    if (r.evTime[stack[stack.length - 1]] >= lateCutoff) late++;
  }

  let topPixels = 0;
  let hhi = 0;
  for (const pixels of perArtist.values()) {
    if (pixels > topPixels) topPixels = pixels;
    hhi += (pixels / visible) ** 2;
  }

  let outside = 0;
  for (let i = 0; i < r.totalPlaced; i++) {
    if (r.evTime[i] < start || r.evTime[i] >= end) outside++;
  }

  const mints = meta.totalMints;
  // Buried labour is measured against paint that actually went somewhere, so
  // repeated placements inside one stroke are excluded from the denominator.
  const distinct = r.totalPlaced - r.selfOverlap;

  return {
    day: meta.id,
    name: meta.name,
    size: meta.size,
    filledFromTheme: meta.filledFromTheme,

    placed: r.totalPlaced,
    submitted: meta.pixelsCount,
    offGrid: meta.pixelsCount - r.totalPlaced,
    selfOverlap: r.selfOverlap,
    distinctPlaced: r.totalPlaced - r.selfOverlap,
    visible,
    buried: distinct - visible,
    buriedShare: distinct === 0 ? 0 : (distinct - visible) / distinct,
    coverage: visible / r.area,
    meanDepth: visible === 0 ? 0 : distinct / visible,
    maxDepth,

    artists: r.artists.length,
    artistsVisible: perArtist.size,
    topShare: visible === 0 ? 0 : topPixels / visible,
    hhi: visible === 0 ? 0 : hhi,
    lateSurge: visible === 0 ? 0 : late / visible,

    mints,
    earnedWei: meta.totalEarned,
    earnedEth: Number(BigInt(meta.totalEarned)) / 1e18,
    effortPerMint: mints === 0 ? null : distinct / mints,

    firstTime: r.firstTime,
    lastTime: r.lastTime,

    strokesOutsideWindow: outside,
  };
}
