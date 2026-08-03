/**
 * Unit tests for the pure parts of the BasePaint client. The query functions
 * hit the live indexer and are covered by `npm run verify`.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LAST_144_DAY, canvasSize, parsePalette } from "../src/engine/basepaint.js";

describe("canvasSize", () => {
  it("switches from 144 to 256 after the first year", () => {
    assert.equal(canvasSize(1), 144);
    assert.equal(canvasSize(LAST_144_DAY), 144);
    assert.equal(canvasSize(LAST_144_DAY + 1), 256);
    assert.equal(canvasSize(1090), 256);
  });
});

describe("parsePalette", () => {
  it("parses the indexer's comma-separated hex", () => {
    assert.deepEqual(parsePalette("#DDCF99,#CCA87B,#000000"), [
      [221, 207, 153],
      [204, 168, 123],
      [0, 0, 0],
    ]);
  });

  it("tolerates whitespace, missing hashes and a trailing comma", () => {
    assert.deepEqual(parsePalette(" ddcf99 , CCA87B, "), [
      [221, 207, 153],
      [204, 168, 123],
    ]);
  });

  it("rejects entries that are not six hex digits", () => {
    assert.throws(() => parsePalette("#DDCF99,#GGGGGG"), /palette/);
    assert.throws(() => parsePalette("#DDCF99,#FFF"), /palette/);
    assert.throws(() => parsePalette(""), /palette/);
  });
});
