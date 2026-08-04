/**
 * Unit tests for per-canvas statistics.
 *
 * The fixture is a 4x4 canvas placed inside day 1's real 24h window, so the
 * late-surge cutoff is exercised against the same clock the index uses.
 *
 *   (0,0)  A colour 0 @ +1h, B colour 2 @ +2h, A colour 3 @ +23h   (survives: A)
 *   (1,0)  A colour 1 @ +1h                                        (survives: A)
 *   (2,1)  C colour 4 @ +2h                                        (survives: C)
 *
 * 5 placements, 3 visible, 2 buried. Two of the three surviving pixels landed
 * before the final quarter; only (0,0)'s +23h coat is a late surge.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { CanvasMeta, Stroke } from "../src/engine/basepaint.js";
import { dayWindow, mintWindowOpen } from "../src/engine/basepaint.js";
import { replay } from "../src/engine/replay.js";
import { canvasStats, replayStats } from "../src/engine/stats.js";

const SIZE = 4;
const DAY = 1;
const START = dayWindow(DAY).start;
const HOUR = 3600;

const A = "0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA";
const B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const C = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";

const byte = (n: number) => n.toString(16).padStart(2, "0");
const px = (x: number, y: number, c: number) => byte(x) + byte(y) + byte(c);

let nextId = 1;
const mk = (accountId: string, at: number, data: string): Stroke => ({
  id: String(nextId++),
  accountId,
  data,
  pixels: Math.floor(data.replace(/^0x/, "").length / 6),
  timestamp: String(START + at),
});

const meta = (over: Partial<CanvasMeta> = {}): CanvasMeta => ({
  id: DAY,
  size: SIZE,
  name: "Fixture",
  palette: "#000000,#111111,#222222,#333333,#444444",
  proposer: null,
  filledFromTheme: false,
  pixelsCount: 5,
  totalArtists: 3,
  totalMints: 10,
  totalEarned: "1500000000000000000",
  ...over,
});

const fixture = () => [
  mk(A, HOUR, "0x" + px(0, 0, 0) + px(1, 0, 1)),
  mk(B, 2 * HOUR, "0x" + px(0, 0, 2)),
  mk(C, 2 * HOUR, "0x" + px(2, 1, 4)),
  mk(A, 23 * HOUR, "0x" + px(0, 0, 3)),
];

/** Long past day 1's mint window, so economics are final in these fixtures. */
const NOW = START + 30 * 86400;

const statsFor = (strokes: Stroke[], over?: Partial<CanvasMeta>) =>
  canvasStats(replayStats(replay(strokes, SIZE), DAY), meta(over), NOW);

const stats = (over?: Partial<CanvasMeta>) => statsFor(fixture(), over);

describe("dayWindow", () => {
  it("is a 24h window anchored on the first canvas", () => {
    const one = dayWindow(1);
    assert.equal(one.start, 1691599315);
    assert.equal(one.end, 1691599315 + 86400);
    assert.equal(dayWindow(2).start, one.end);
  });

  it("rejects a day before the first canvas", () => {
    assert.throws(() => dayWindow(0), /day/);
    assert.throws(() => dayWindow(1.5), /day/);
  });

  it("keeps the mint window open for 24h after painting closes", () => {
    const { end } = dayWindow(1);
    assert.equal(mintWindowOpen(1, end - 1), true); // still being painted
    assert.equal(mintWindowOpen(1, end + 3600), true); // painted, still on sale
    assert.equal(mintWindowOpen(1, end + 86400), false);
  });
});

describe("canvasStats", () => {
  it("separates placed, visible and buried labour", () => {
    const s = stats();
    assert.equal(s.placed, 5);
    assert.equal(s.visible, 3);
    assert.equal(s.buried, 2);
    assert.equal(s.buriedShare, 2 / 5);
  });

  it("measures coverage against the whole grid, depth against painted pixels", () => {
    const s = stats();
    assert.equal(s.coverage, 3 / 16);
    assert.equal(s.meanDepth, 5 / 3);
    assert.equal(s.maxDepth, 3);
  });

  it("counts artists who took part and artists still visible", () => {
    const s = stats();
    assert.equal(s.artists, 3);
    assert.equal(s.artistsVisible, 2); // B was painted over entirely
  });

  it("measures concentration over visible pixels", () => {
    const s = stats();
    assert.equal(s.topShare, 2 / 3);
    // HHI = sum of squared shares: A 2/3, C 1/3.
    assert.ok(Math.abs(s.hhi - ((2 / 3) ** 2 + (1 / 3) ** 2)) < 1e-12);
  });

  it("counts surviving paint laid down in the final quarter of the day", () => {
    const s = stats();
    assert.equal(s.lateSurge, 1 / 3);
  });

  it("carries the indexer's mint economics through", () => {
    const s = stats();
    assert.equal(s.mints, 10);
    assert.equal(s.earnedWei, "1500000000000000000");
    assert.equal(s.earnedEth, 1.5);
    assert.equal(s.effortPerMint, 0.5); // 5 distinct placements / 10 mints
  });

  it("reports effort per mint as null when nobody minted", () => {
    assert.equal(stats({ totalMints: 0 }).effortPerMint, null);
  });

  it("separates submitted pixels from the ones that landed on the grid", () => {
    assert.equal(stats().submitted, 5);
    assert.equal(stats().offGrid, 0);
    assert.equal(stats().unaccounted, 0);
  });

  it("excludes within-stroke repetition from buried labour", () => {
    // One stroke naming (3,3) four times: one new pixel, three repeats. Without
    // this the canvas would look like three more pixels of buried work.
    const strokes = [...fixture(), mk(A, 3 * HOUR, "0x" + px(3, 3, 1).repeat(4))];
    const s = statsFor(strokes, { pixelsCount: 9 });

    assert.equal(s.placed, 9);
    assert.equal(s.selfOverlap, 3);
    assert.equal(s.distinctPlaced, 6);
    assert.equal(s.visible, 4);
    assert.equal(s.buried, 2); // still just the two coats under (0,0)
    assert.equal(s.buriedShare, 2 / 6);
    assert.equal(s.meanDepth, 6 / 4);
  });

  it("measures off-grid pixels during decode rather than inferring them", () => {
    // (200, 1) encodes fine in a byte but cannot land on a 4x4 grid.
    const strokes = [...fixture(), mk(A, 3 * HOUR, "0x" + px(200, 1, 3))];
    const s = statsFor(strokes, { pixelsCount: 6 });
    assert.equal(s.placed, 5);
    assert.equal(s.offGrid, 1);
    assert.equal(s.unaccounted, 0);
  });

  it("counts malformed triplets separately from off-grid ones", () => {
    const strokes = [...fixture(), mk(A, 3 * HOUR, "0x" + px(200, 1, 3) + "zzzzzz")];
    const s = statsFor(strokes, { pixelsCount: 7 });
    assert.equal(s.offGrid, 1);
    assert.equal(s.malformed, 1);
    assert.equal(s.unaccounted, 0);
  });

  it("flags a submitted count the decode cannot account for", () => {
    // Nothing in the blobs explains the extra pixel the indexer claims.
    assert.equal(stats({ pixelsCount: 6 }).unaccounted, 1);
  });

  it("reports raw and distinct depth separately", () => {
    // One stroke naming (3,3) four times is four coats of literal event stack
    // but a single stroke touching the pixel.
    const s = statsFor([...fixture(), mk(A, 3 * HOUR, "0x" + px(3, 3, 1).repeat(4))]);
    assert.equal(s.maxDepth, 4);
    assert.equal(s.maxDistinctDepth, 3); // (0,0), touched by three separate strokes
  });

  it("marks a canvas whose mint window is still open", () => {
    // Mints and earnings keep moving for 24h after painting closes.
    const open = canvasStats(replayStats(replay(fixture(), SIZE), DAY), meta(), START + 86400 + 3600);
    assert.equal(open.mintWindowOpen, true);
    assert.equal(stats().mintWindowOpen, false);
  });

  it("flags strokes landing outside the scheduled window", () => {
    const strokes = [...fixture(), mk(A, 40 * HOUR, "0x" + px(3, 3, 1))];
    const s = statsFor(strokes);
    assert.equal(s.strokesOutsideWindow, 1);
    assert.equal(stats().strokesOutsideWindow, 0);
  });

  it("is all zeroes for an untouched canvas rather than NaN", () => {
    const s = statsFor([], { pixelsCount: 0, totalMints: 0 });
    assert.equal(s.placed, 0);
    assert.equal(s.visible, 0);
    assert.equal(s.buriedShare, 0);
    assert.equal(s.coverage, 0);
    assert.equal(s.meanDepth, 0);
    assert.equal(s.hhi, 0);
    assert.equal(s.lateSurge, 0);
    assert.equal(s.artistsVisible, 0);
    assert.equal(s.effortPerMint, null);
  });
});
