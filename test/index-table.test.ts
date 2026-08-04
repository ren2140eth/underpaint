/**
 * The browse surface is a sort over the committed index, so the two things
 * worth testing are which canvases are allowed in and whether the order is
 * deterministic. Both have teeth: an open mint window makes a row's economics
 * provisional, and an unstable comparator makes a shareable link mean nothing.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { CanvasStats } from "../src/engine/stats";
import { type IndexRow, indexRows, sortRows } from "../src/engine/index-table";

/** A row with only the fields the index reads; the rest never leaves the server. */
const canvas = (over: Partial<CanvasStats> & { day: number }): CanvasStats =>
  ({
    name: `Day ${over.day}`,
    size: 256,
    palette: null,
    filledFromTheme: false,
    placed: 1000,
    selfOverlap: 0,
    distinctPlaced: 1000,
    offGrid: 0,
    malformed: 0,
    visible: 500,
    buried: 500,
    buriedShare: 0.5,
    coverage: 0.5,
    meanDepth: 2,
    maxDepth: 4,
    maxDistinctDepth: 4,
    artists: 10,
    artistsVisible: 5,
    topShare: 0.2,
    hhi: 0.1,
    lateSurge: 0.3,
    firstTime: 0,
    lastTime: 0,
    strokesOutsideWindow: 0,
    submitted: 1000,
    unaccounted: 0,
    mints: 50,
    earnedWei: "0",
    earnedEth: 0.1,
    effortPerMint: 20,
    mintWindowOpen: false,
    ...over,
  }) as CanvasStats;

describe("indexRows", () => {
  it("keeps canvases whose mint window has closed", () => {
    const rows = indexRows([canvas({ day: 1 }), canvas({ day: 2 })]);
    assert.deepEqual(
      rows.map((r) => r.day),
      [1, 2],
    );
  });

  it("drops a canvas that can still be minted", () => {
    // Its mints, earnings and effort-per-mint are still moving, so ranking it
    // against settled canvases would compare a part-finished number.
    const rows = indexRows([canvas({ day: 1 }), canvas({ day: 2, mintWindowOpen: true })]);
    assert.deepEqual(
      rows.map((r) => r.day),
      [1],
    );
  });

  it("carries the fields the table renders", () => {
    const [row] = indexRows([
      canvas({ day: 7, name: "Hawaii", buriedShare: 0.83, mints: 216, effortPerMint: 431 }),
    ]);
    assert.equal(row.day, 7);
    assert.equal(row.name, "Hawaii");
    assert.equal(row.buriedShare, 0.83);
    assert.equal(row.mints, 216);
    assert.equal(row.effortPerMint, 431);
  });

  it("does not leak the palette or the data-quality fields to the browser", () => {
    // The payload ships to every visitor; the index is 188 KB gzipped whole and
    // 96 KB trimmed, and none of this is rendered.
    const [row] = indexRows([canvas({ day: 1, palette: "#fff,#000" })]);
    for (const absent of ["palette", "earnedWei", "strokesOutsideWindow", "unaccounted"]) {
      assert.ok(!(absent in row), `${absent} should not be in the row payload`);
    }
  });

  it("returns nothing when every canvas is still open", () => {
    assert.deepEqual(indexRows([canvas({ day: 1, mintWindowOpen: true })]), []);
  });
});

describe("sortRows", () => {
  const rows = (...spec: [number, Partial<IndexRow>][]) =>
    indexRows(spec.map(([day, over]) => canvas({ day, ...(over as Partial<CanvasStats>) })));

  it("sorts descending by a numeric column", () => {
    const out = sortRows(
      rows([1, { buriedShare: 0.2 }], [2, { buriedShare: 0.9 }], [3, { buriedShare: 0.5 }]),
      "buriedShare",
      "desc",
    );
    assert.deepEqual(
      out.map((r) => r.day),
      [2, 3, 1],
    );
  });

  it("sorts ascending by a numeric column", () => {
    const out = sortRows(
      rows([1, { buriedShare: 0.2 }], [2, { buriedShare: 0.9 }], [3, { buriedShare: 0.5 }]),
      "buriedShare",
      "asc",
    );
    assert.deepEqual(
      out.map((r) => r.day),
      [1, 3, 2],
    );
  });

  it("breaks ties by day so the same sort always gives the same page", () => {
    const out = sortRows(
      rows([9, { buriedShare: 0.5 }], [3, { buriedShare: 0.5 }], [5, { buriedShare: 0.5 }]),
      "buriedShare",
      "desc",
    );
    assert.deepEqual(
      out.map((r) => r.day),
      [3, 5, 9],
    );
  });

  it("puts canvases with no value last in both directions", () => {
    // effortPerMint is null when a canvas has no mints. Absent is not zero and
    // must not win an ascending sort.
    const spec: [number, Partial<IndexRow>][] = [
      [1, { effortPerMint: 500 }],
      [2, { effortPerMint: null }],
      [3, { effortPerMint: 100 }],
    ];
    assert.deepEqual(
      sortRows(rows(...spec), "effortPerMint", "asc").map((r) => r.day),
      [3, 1, 2],
    );
    assert.deepEqual(
      sortRows(rows(...spec), "effortPerMint", "desc").map((r) => r.day),
      [1, 3, 2],
    );
  });

  it("sorts names alphabetically rather than by code unit", () => {
    const out = sortRows(
      rows([1, { name: "Zebra" }], [2, { name: "apple" }], [3, { name: "Mango" }]),
      "name",
      "asc",
    );
    assert.deepEqual(
      out.map((r) => r.name),
      ["apple", "Mango", "Zebra"],
    );
  });

  it("does not mutate the array it was given", () => {
    const input = rows([1, { buriedShare: 0.2 }], [2, { buriedShare: 0.9 }]);
    const before = input.map((r) => r.day);
    sortRows(input, "buriedShare", "desc");
    assert.deepEqual(
      input.map((r) => r.day),
      before,
    );
  });

  it("handles an empty table", () => {
    assert.deepEqual(sortRows([], "buriedShare", "desc"), []);
  });
});
