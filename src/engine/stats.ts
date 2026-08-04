/**
 * Per-canvas statistics — the properties the index ranks on.
 *
 * Split in two on purpose:
 *
 *   replayStats()  everything derived from the strokes. Once a canvas's 24h
 *                  painting window closes this can never change, so ingest
 *                  caches it.
 *   canvasStats()  the above plus mint economics, which keep moving for another
 *                  24h after painting ends and are therefore never cached.
 *
 * Everything in the first half inherits the pixel-for-pixel proof in
 * `npm run verify`.
 *
 * Framing rule from the design: none of these are scores. Buried labour is a
 * fact about how a canvas was made — how deeply it was worked — and not a
 * judgement of anyone's painting, nor of the app the painting happened in.
 */

import { type CanvasMeta, dayWindow, mintWindowOpen } from "./basepaint";
import { type Replay, UNPAINTED } from "./replay";

/** Immutable once the painting window closes. */
export interface ReplayStats {
  day: number;

  /** every pixel placement that landed on the grid, including ones later covered */
  placed: number;
  /**
   * Placements that repainted a coordinate already covered earlier in the same
   * stroke, and `placed` with those removed. Some canvases carry blobs of a
   * hundred triplets all naming one coordinate, which the indexer counts and
   * pays out on but which puts no paint anywhere new; leaving them in `placed`
   * would inflate buried labour on exactly those canvases.
   */
  selfOverlap: number;
  distinctPlaced: number;
  /**
   * Triplets naming a coordinate outside the grid, so no paint could land.
   * Coordinates are a byte each, so anything up to 255 encodes fine while the
   * 144px-era canvases only had 144 rows and columns. BasePaint's own renderer
   * discards them too — the pixel-for-pixel proof would fail otherwise — but
   * they were still paid for. Counted during decode, not inferred.
   */
  offGrid: number;
  /** triplets that were not six hex characters at all */
  malformed: number;

  /** grid slots holding paint at the end */
  visible: number;
  /** distinct placements that ended up under something else */
  buried: number;
  /** buried / distinctPlaced */
  buriedShare: number;
  /** visible / area — how much of the grid was ever reached */
  coverage: number;
  /** distinct placements per painted slot: how many coats the average pixel took */
  meanDepth: number;
  /**
   * Deepest single pixel, counted two ways. `maxDepth` is the literal event
   * stack the x-ray peels through, so on canvases with repeated blobs it runs
   * into the thousands. `maxDistinctDepth` counts separate strokes touching a
   * pixel and is the one comparable across canvases — meanDepth uses the same
   * definition.
   */
  maxDepth: number;
  maxDistinctDepth: number;

  artists: number;
  /** artists with at least one surviving pixel */
  artistsVisible: number;
  /** largest single artist's share of the visible image */
  topShare: number;
  /** Herfindahl index over visible shares: 1/artistsVisible (even) .. 1 (one artist) */
  hhi: number;
  /** share of the visible image laid down in the final quarter of the 24h window */
  lateSurge: number;

  firstTime: number;
  lastTime: number;
  /** data-quality flag, surfaced by ingest rather than silently tolerated */
  strokesOutsideWindow: number;
}

/** A replay's statistics plus the economics that are still moving. */
export interface CanvasStats extends ReplayStats {
  name: string;
  size: number;
  /**
   * Comma-separated hex colours. Immutable per canvas, so it rides along in the
   * committed index and the browser never has to ask anyone for it.
   */
  palette: string | null;
  /** name, size and palette came from the theme API, not the indexer */
  filledFromTheme: boolean;

  /** placements the indexer recorded, which is what the day's ETH was split on */
  submitted: number;
  /** submitted minus what the decode accounted for; should always be 0 */
  unaccounted: number;

  mints: number;
  earnedWei: string;
  earnedEth: number;
  /** distinct placements per mint — high means a lot of work few people bought */
  effortPerMint: number | null;
  /**
   * The canvas can still be minted, so mints, earnedEth and effortPerMint are
   * provisional. Rankings must exclude these rather than cache them.
   */
  mintWindowOpen: boolean;
}

export function replayStats(r: Replay, day: number): ReplayStats {
  const { start, end } = dayWindow(day);
  const lateCutoff = start + 0.75 * (end - start);

  const perArtist = new Map<number, number>();
  let visible = 0;
  let late = 0;
  let maxDepth = 0;
  let maxDistinctDepth = 0;

  for (let p = 0; p < r.area; p++) {
    if (r.depth[p] > maxDepth) maxDepth = r.depth[p];
    if (r.distinctDepth[p] > maxDistinctDepth) maxDistinctDepth = r.distinctDepth[p];
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

  // Buried labour is measured against paint that actually went somewhere, so
  // repeated placements inside one stroke are excluded from the denominator.
  const distinct = r.totalPlaced - r.selfOverlap;

  return {
    day,

    placed: r.totalPlaced,
    selfOverlap: r.selfOverlap,
    distinctPlaced: distinct,
    offGrid: r.offGrid,
    malformed: r.malformed,

    visible,
    buried: distinct - visible,
    buriedShare: distinct === 0 ? 0 : (distinct - visible) / distinct,
    coverage: visible / r.area,
    meanDepth: visible === 0 ? 0 : distinct / visible,
    maxDepth,
    maxDistinctDepth,

    artists: r.artists.length,
    artistsVisible: perArtist.size,
    topShare: visible === 0 ? 0 : topPixels / visible,
    hhi: visible === 0 ? 0 : hhi,
    lateSurge: visible === 0 ? 0 : late / visible,

    firstTime: r.firstTime,
    lastTime: r.lastTime,
    strokesOutsideWindow: outside,
  };
}

export function canvasStats(stats: ReplayStats, meta: CanvasMeta, now?: number): CanvasStats {
  const mints = meta.totalMints;

  return {
    ...stats,
    name: meta.name,
    size: meta.size,
    palette: meta.palette,
    filledFromTheme: meta.filledFromTheme,

    submitted: meta.pixelsCount,
    unaccounted: meta.pixelsCount - (stats.placed + stats.offGrid + stats.malformed),

    mints,
    earnedWei: meta.totalEarned,
    earnedEth: Number(BigInt(meta.totalEarned)) / 1e18,
    effortPerMint: mints === 0 ? null : stats.distinctPlaced / mints,
    mintWindowOpen: mintWindowOpen(stats.day, now),
  };
}
