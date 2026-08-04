/**
 * Painting on top of a canvas.
 *
 * Three things have teeth here. A brush dragged quickly fires pointer events
 * several pixels apart, so the line between them has to be filled or the stroke
 * comes out as dots. Paint is stored as palette *indices*, so that remixing
 * recolours the visitor's work along with everyone else's. And it survives in
 * a link as a BasePaint-format blob, which must round-trip exactly or a shared
 * painting is not the painting that was shared.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { UNPAINTED } from "../src/engine/replay";
import {
  type Paint,
  YOURS,
  applyPaint,
  brushPixels,
  decodePaint,
  encodePaint,
  linePixels,
} from "../src/engine/paint";

const SIZE = 16;
const paint = (...entries: [number, number][]): Paint => new Map(entries);

describe("linePixels", () => {
  const chebyshev = (a: [number, number], b: [number, number]) =>
    Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

  it("is a single pixel when the ends meet", () => {
    assert.deepEqual(linePixels(3, 4, 3, 4), [[3, 4]]);
  });

  it("fills a horizontal run", () => {
    assert.deepEqual(linePixels(1, 2, 4, 2), [
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
    ]);
  });

  it("fills a vertical run", () => {
    assert.deepEqual(linePixels(2, 1, 2, 3), [
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
  });

  it("fills a diagonal", () => {
    assert.deepEqual(linePixels(0, 0, 3, 3), [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("leaves no gaps on any slope", () => {
    // This is the whole point: a fast drag reports distant points, and a line
    // with gaps renders as a dotted stroke.
    for (const [x0, y0, x1, y1] of [
      [0, 0, 15, 3],
      [15, 3, 0, 0],
      [2, 14, 13, 1],
      [7, 0, 8, 15],
      [0, 9, 15, 9],
    ] as const) {
      const px = linePixels(x0, y0, x1, y1);
      for (let i = 1; i < px.length; i++) {
        assert.equal(chebyshev(px[i - 1], px[i]), 1, `gap in ${x0},${y0}->${x1},${y1} at ${i}`);
      }
      assert.deepEqual(px[0], [x0, y0]);
      assert.deepEqual(px[px.length - 1], [x1, y1]);
    }
  });

  it("draws the same number of pixels in either direction", () => {
    // Not the same *pixels*: Bresenham breaks ties toward the direction of
    // travel, so a drag back along its own path can sit one pixel off. That is
    // invisible in a brush stroke and does not affect what gets encoded, since
    // a painting is stored as its resulting pixels, sorted. The length is the
    // real invariant — a mismatch there means a dropped or doubled step.
    for (const [x0, y0, x1, y1] of [
      [1, 2, 11, 7],
      [0, 0, 15, 15],
      [3, 14, 12, 1],
    ] as const) {
      assert.equal(
        linePixels(x0, y0, x1, y1).length,
        linePixels(x1, y1, x0, y0).length,
        `${x0},${y0} <-> ${x1},${y1}`,
      );
    }
  });
});

describe("brushPixels", () => {
  it("is one pixel at size 1", () => {
    assert.deepEqual(brushPixels(5, 5, 1, SIZE), [[5, 5]]);
  });

  it("is a square block centred on the cursor at larger sizes", () => {
    const px = brushPixels(5, 5, 3, SIZE);
    assert.equal(px.length, 9);
    assert.ok(px.some(([x, y]) => x === 4 && y === 4));
    assert.ok(px.some(([x, y]) => x === 6 && y === 6));
  });

  it("clips at the edges rather than wrapping to the next row", () => {
    // Unclipped, x = -1 would land on the previous row's last pixel.
    for (const [x, y] of [
      [0, 0],
      [SIZE - 1, SIZE - 1],
      [0, SIZE - 1],
    ] as const) {
      for (const [px, py] of brushPixels(x, y, 3, SIZE)) {
        assert.ok(px >= 0 && px < SIZE && py >= 0 && py < SIZE, `${px},${py} escaped`);
      }
    }
    assert.equal(brushPixels(0, 0, 3, SIZE).length, 4);
  });
});

describe("applyPaint", () => {
  const layer = () => ({
    color: new Int16Array(SIZE * SIZE).fill(UNPAINTED),
    owner: new Int16Array(SIZE * SIZE).fill(UNPAINTED),
  });

  it("puts the visitor's colour on top", () => {
    const base = layer();
    base.color[5] = 2;
    base.owner[5] = 7;

    const out = applyPaint(base, paint([5, 9]), SIZE * SIZE);
    assert.equal(out.color[5], 9);
    assert.equal(out.owner[5], YOURS);
  });

  it("leaves the canvas alone where nothing was painted", () => {
    const base = layer();
    base.color[3] = 4;
    base.owner[3] = 1;

    const out = applyPaint(base, paint([5, 9]), SIZE * SIZE);
    assert.equal(out.color[3], 4);
    assert.equal(out.owner[3], 1);
  });

  it("marks the visitor apart from every real artist and from bare canvas", () => {
    // Negative so it can never collide with an artist index, and distinct from
    // UNPAINTED so a visitor's pixel is never mistaken for untouched canvas.
    // The literal types make this a compile-time guarantee too; widening here
    // keeps it an assertion rather than a tautology tsc rejects.
    const yours: number = YOURS;
    const unpainted: number = UNPAINTED;
    assert.ok(yours < 0);
    assert.notEqual(yours, unpainted);
  });

  it("does not mutate the layer it was given", () => {
    const base = layer();
    applyPaint(base, paint([5, 9]), SIZE * SIZE);
    assert.equal(base.color[5], UNPAINTED);
    assert.equal(base.owner[5], UNPAINTED);
  });

  it("returns an equal layer for empty paint", () => {
    const base = layer();
    base.color[1] = 3;
    const out = applyPaint(base, new Map(), SIZE * SIZE);
    assert.deepEqual([...out.color], [...base.color]);
  });

  it("ignores pixels outside the canvas", () => {
    const base = layer();
    assert.doesNotThrow(() => applyPaint(base, paint([9999, 4], [-1, 4]), SIZE * SIZE));
  });
});

describe("encodePaint / decodePaint", () => {
  it("writes BasePaint's own blob format, six hex characters per pixel", () => {
    // x=1, y=2, colour=3 on a 16-wide grid is pixel 2*16+1 = 33.
    assert.equal(encodePaint(paint([33, 3]), SIZE), "010203");
  });

  it("round-trips", () => {
    const original = paint([33, 3], [0, 0], [255, 15]);
    const back = decodePaint(encodePaint(original, SIZE), SIZE);
    assert.deepEqual([...back.entries()].sort((a, b) => a[0] - b[0]), [
      [0, 0],
      [33, 3],
      [255, 15],
    ]);
  });

  it("orders by pixel so the same painting is always the same string", () => {
    const a = encodePaint(paint([200, 1], [5, 2], [77, 3]), SIZE);
    const b = encodePaint(paint([77, 3], [200, 1], [5, 2]), SIZE);
    assert.equal(a, b);
  });

  it("is empty for empty paint", () => {
    assert.equal(encodePaint(new Map(), SIZE), "");
    assert.equal(decodePaint("", SIZE).size, 0);
  });

  it("drops triplets that are not six hex characters", () => {
    assert.equal(decodePaint("01020", SIZE).size, 0);
    assert.equal(decodePaint("zzzzzz", SIZE).size, 0);
    // A good triplet followed by a truncated tail keeps the good one.
    assert.equal(decodePaint("010203ab", SIZE).size, 1);
  });

  it("drops pixels outside this canvas", () => {
    // x = 200 does not exist on a 16-wide grid; unchecked it would wrap rows.
    assert.equal(decodePaint("c80203", SIZE).size, 0);
    assert.equal(decodePaint("02c803", SIZE).size, 0);
  });

  it("survives a re-encode unchanged", () => {
    const blob = "000000010203ff0f05";
    assert.equal(encodePaint(decodePaint(blob, 256), 256), blob);
  });
});
