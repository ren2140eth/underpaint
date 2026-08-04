/**
 * Unit tests for the replay engine.
 *
 * `npm run verify` proves the final image against published artwork, but it
 * only exercises one of six render modes. These fixtures cover the other five,
 * attribution, pixel histories and the malformed-input paths — deterministic,
 * offline, and small enough to reason about by hand.
 *
 * The fixture canvas is 4x4:
 *
 *   (0,0)  painted 3 times: A colour 0, then B colour 2, then A colour 3
 *   (1,0)  painted once:    A colour 1
 *   (2,1)  painted once:    C colour 4
 *   everything else untouched
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Stroke } from "../src/engine/basepaint";
import {
  UNPAINTED,
  attribution,
  pixelHistory,
  renderAtTime,
  renderFinal,
  renderPeel,
  renderSolo,
  renderUnderpainting,
  renderWithout,
  replay,
  toRGBA,
} from "../src/engine/replay";

const SIZE = 4;
const A = "0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA";
const B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const C = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";

const byte = (n: number) => n.toString(16).padStart(2, "0");
/** One pixel placement as its 6-char blob field. */
const px = (x: number, y: number, c: number) => byte(x) + byte(y) + byte(c);

let nextId = 1;
function mk(accountId: string, timestamp: number, data: string): Stroke {
  return {
    id: String(nextId++),
    accountId,
    data,
    pixels: Math.floor(data.replace(/^0x/, "").length / 6),
    timestamp: String(timestamp),
  };
}

/** The fixture, already in chronological order (as fetchStrokes returns them). */
function fixture(): Stroke[] {
  return [
    mk(A, 100, "0x" + px(0, 0, 0) + px(1, 0, 1)),
    mk(B, 200, "0x" + px(0, 0, 2)),
    mk(A, 300, "0x" + px(0, 0, 3)),
    mk(C, 400, "0x" + px(2, 1, 4)),
  ];
}

const at = (x: number, y: number) => y * SIZE + x;

/** Every pixel of a layer that is not UNPAINTED, as "x,y" -> [colour, owner]. */
function painted(layer: { color: Int16Array; owner: Int16Array }) {
  const out: Record<string, [number, number]> = {};
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (layer.color[p] === UNPAINTED && layer.owner[p] === UNPAINTED) continue;
    out[`${p % SIZE},${Math.floor(p / SIZE)}`] = [layer.color[p], layer.owner[p]];
  }
  return out;
}

describe("replay", () => {
  it("records artists in order of first appearance", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(r.artists, [A, B, C]);
  });

  it("counts every placement, including covered ones", () => {
    const r = replay(fixture(), SIZE);
    assert.equal(r.totalPlaced, 5);
    assert.equal(r.depth[at(0, 0)], 3);
    assert.equal(r.depth[at(1, 0)], 1);
    assert.equal(r.depth[at(3, 3)], 0);
  });

  it("keeps the last write per pixel", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderFinal(r)), {
      "0,0": [3, 0],
      "1,0": [1, 0],
      "2,1": [4, 2],
    });
  });

  it("spans first to last stroke time", () => {
    const r = replay(fixture(), SIZE);
    assert.equal(r.firstTime, 100);
    assert.equal(r.lastTime, 400);
  });

  it("distinguishes never-painted from painted colour 0", () => {
    const r = replay([mk(A, 100, "0x" + px(1, 1, 0))], SIZE);
    assert.equal(r.color[at(1, 1)], 0);
    assert.equal(r.depth[at(1, 1)], 1);
    assert.equal(r.color[at(2, 2)], UNPAINTED);
    assert.equal(r.depth[at(2, 2)], 0);
  });

  it("is empty but valid with no strokes", () => {
    const r = replay([], SIZE);
    assert.equal(r.totalPlaced, 0);
    assert.equal(r.firstTime, 0);
    assert.equal(r.lastTime, 0);
    assert.deepEqual(painted(renderFinal(r)), {});
  });

  it("decodes blobs with and without the 0x prefix identically", () => {
    const withPrefix = replay([mk(A, 100, "0x" + px(1, 1, 7))], SIZE);
    const without = replay([mk(A, 100, px(1, 1, 7))], SIZE);

    assert.equal(without.totalPlaced, withPrefix.totalPlaced);
    assert.deepEqual(painted(renderFinal(without)), painted(renderFinal(withPrefix)));
    // The event arrays must be populated too, not just the surviving colour.
    assert.deepEqual(pixelHistory(without, 1, 1), pixelHistory(withPrefix, 1, 1));
    assert.deepEqual(pixelHistory(without, 1, 1), [{ artist: 0, color: 7, time: 100 }]);
  });

  it("skips pixels outside the grid", () => {
    const r = replay([mk(A, 100, "0x" + px(9, 0, 1) + px(0, 9, 1) + px(3, 3, 5))], SIZE);
    assert.equal(r.totalPlaced, 1);
    assert.deepEqual(painted(renderFinal(r)), { "3,3": [5, 0] });
  });

  it("skips malformed triplets instead of throwing", () => {
    // A truncated tail and a non-hex triplet: neither should take down the canvas.
    const r = replay([mk(A, 100, "0x" + px(1, 1, 2) + "zzzzzz" + px(2, 2, 3) + "ab")], SIZE);
    assert.deepEqual(painted(renderFinal(r)), { "1,1": [2, 0], "2,2": [3, 0] });
    assert.equal(r.totalPlaced, 2);
  });

  it("counts placements that repeat a coordinate inside one stroke", () => {
    // Some canvases carry blobs of a hundred triplets all naming one pixel.
    const spam = replay([mk(A, 100, "0x" + px(0, 0, 1).repeat(4))], SIZE);
    assert.equal(spam.totalPlaced, 4);
    assert.equal(spam.selfOverlap, 3);
    assert.equal(spam.depth[at(0, 0)], 4);
  });

  it("does not count repainting across separate strokes as self-overlap", () => {
    // (0,0) is painted by three different strokes in the fixture — that is
    // ordinary painting over, not repetition within a stroke.
    assert.equal(replay(fixture(), SIZE).selfOverlap, 0);
  });

  it("rejects a non-positive or fractional size", () => {
    assert.throws(() => replay([], 0), /size/);
    assert.throws(() => replay([], -4), /size/);
    assert.throws(() => replay([], 4.5), /size/);
  });
});

describe("pixelHistory", () => {
  it("returns every event on a pixel, oldest first", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(pixelHistory(r, 0, 0), [
      { artist: 0, color: 0, time: 100 },
      { artist: 1, color: 2, time: 200 },
      { artist: 0, color: 3, time: 300 },
    ]);
  });

  it("returns nothing for an untouched pixel", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(pixelHistory(r, 3, 3), []);
  });

  it("rejects coordinates outside the grid rather than wrapping rows", () => {
    const r = replay(fixture(), SIZE);
    // x = SIZE would silently read (0, y+1) if unchecked.
    assert.throws(() => pixelHistory(r, SIZE, 0), /coordinate/);
    assert.throws(() => pixelHistory(r, 0, SIZE), /coordinate/);
    assert.throws(() => pixelHistory(r, -1, 0), /coordinate/);
    assert.throws(() => pixelHistory(r, 0.5, 0), /coordinate/);
  });
});

describe("renderAtTime", () => {
  it("shows the canvas as it stood mid-day", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderAtTime(r, 250)), { "0,0": [2, 1], "1,0": [1, 0] });
  });

  it("includes strokes landing exactly on the cutoff", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderAtTime(r, 200)), { "0,0": [2, 1], "1,0": [1, 0] });
  });

  it("is empty before the first stroke and final after the last", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderAtTime(r, 99)), {});
    assert.deepEqual(painted(renderAtTime(r, 9999)), painted(renderFinal(r)));
  });

  it("rejects a non-finite time", () => {
    const r = replay(fixture(), SIZE);
    assert.throws(() => renderAtTime(r, NaN), /time/);
    assert.throws(() => renderAtTime(r, Infinity), /time/);
  });
});

describe("renderPeel", () => {
  it("peels back coat by coat", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderPeel(r, 0)), painted(renderFinal(r)));
    // One coat off: (1,0) and (2,1) were painted once, so nothing is under them.
    assert.deepEqual(painted(renderPeel(r, 1)), { "0,0": [2, 1] });
    assert.deepEqual(painted(renderPeel(r, 2)), { "0,0": [0, 0] });
    assert.deepEqual(painted(renderPeel(r, 3)), {});
  });

  it("rejects a negative or fractional depth", () => {
    const r = replay(fixture(), SIZE);
    assert.throws(() => renderPeel(r, -1), /depth/);
    assert.throws(() => renderPeel(r, 1.5), /depth/);
    assert.throws(() => renderPeel(r, NaN), /depth/);
  });
});

describe("renderSolo", () => {
  it("keeps only that artist's surviving pixels", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderSolo(r, 0)), { "0,0": [3, 0], "1,0": [1, 0] });
    // B painted, but was covered — soloing B shows an empty canvas.
    assert.deepEqual(painted(renderSolo(r, 1)), {});
    assert.deepEqual(painted(renderSolo(r, 2)), { "2,1": [4, 2] });
  });

  it("rejects an unknown artist index", () => {
    const r = replay(fixture(), SIZE);
    assert.throws(() => renderSolo(r, 3), /artist/);
    assert.throws(() => renderSolo(r, -1), /artist/);
    assert.throws(() => renderSolo(r, 1.5), /artist/);
  });
});

describe("renderWithout", () => {
  it("reveals what a muted artist covered", () => {
    const r = replay(fixture(), SIZE);
    // Mute A: (0,0) falls back to B's coat, (1,0) had nothing beneath it.
    assert.deepEqual(painted(renderWithout(r, new Set([0]))), {
      "0,0": [2, 1],
      "2,1": [4, 2],
    });
  });

  it("muting nobody is the final image", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderWithout(r, new Set())), painted(renderFinal(r)));
  });

  it("muting everyone empties the canvas", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderWithout(r, new Set([0, 1, 2]))), {});
  });

  it("rejects an unknown artist index", () => {
    const r = replay(fixture(), SIZE);
    assert.throws(() => renderWithout(r, new Set([0, 9])), /artist/);
  });
});

describe("renderUnderpainting", () => {
  it("promotes the buried coat and drops single-coat pixels", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(painted(renderUnderpainting(r)), { "0,0": [2, 1] });
  });
});

describe("attribution", () => {
  it("splits visible pixels by artist, descending", () => {
    const r = replay(fixture(), SIZE);
    const split = attribution(r, renderFinal(r));
    assert.deepEqual(split, [
      { index: 0, artist: A, pixels: 2, share: 2 / 3 },
      { index: 2, artist: C, pixels: 1, share: 1 / 3 },
    ]);
    // B is invisible in the final image, so B is absent — not zero.
    assert.equal(
      split.reduce((s, a) => s + a.share, 0),
      1,
    );
  });

  it("follows the variation, not the final image", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(attribution(r, renderUnderpainting(r)), [
      { index: 1, artist: B, pixels: 1, share: 1 },
    ]);
  });

  it("is empty for an empty layer", () => {
    const r = replay(fixture(), SIZE);
    assert.deepEqual(attribution(r, renderPeel(r, 3)), []);
  });
});

describe("toRGBA", () => {
  const palette: [number, number, number][] = [
    [0, 0, 0],
    [17, 17, 17],
    [34, 34, 34],
    [51, 51, 51],
    [68, 68, 68],
  ];

  it("fills untouched pixels with palette colour 0 by default", () => {
    const r = replay(fixture(), SIZE);
    const out = toRGBA(renderFinal(r), palette, r.area);
    const p = at(3, 3) * 4;
    assert.deepEqual([...out.slice(p, p + 4)], [0, 0, 0, 255]);
  });

  it("leaves untouched pixels transparent in x-ray mode", () => {
    const r = replay(fixture(), SIZE);
    const out = toRGBA(renderFinal(r), palette, r.area, "transparent");
    const p = at(3, 3) * 4;
    assert.deepEqual([...out.slice(p, p + 4)], [0, 0, 0, 0]);

    // A pixel that survived is still opaque.
    const q = at(0, 0) * 4;
    assert.deepEqual([...out.slice(q, q + 4)], [51, 51, 51, 255]);
  });

  it("renders a pixel painted colour 0 opaque in x-ray mode", () => {
    const r = replay([mk(A, 100, "0x" + px(1, 1, 0))], SIZE);
    const out = toRGBA(renderFinal(r), palette, r.area, "transparent");
    const p = at(1, 1) * 4;
    assert.deepEqual([...out.slice(p, p + 4)], [0, 0, 0, 255]);
  });

  it("leaves a colour outside the palette transparent rather than guessing", () => {
    const r = replay([mk(A, 100, "0x" + px(1, 1, 99))], SIZE);
    const out = toRGBA(renderFinal(r), palette, r.area, "transparent");
    const p = at(1, 1) * 4;
    assert.deepEqual([...out.slice(p, p + 4)], [0, 0, 0, 0]);
  });

  it("rejects an empty palette", () => {
    const r = replay(fixture(), SIZE);
    assert.throws(() => toRGBA(renderFinal(r), [], r.area), /palette/);
  });
});
