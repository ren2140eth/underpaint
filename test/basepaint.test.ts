/**
 * Unit tests for the pure parts of the BasePaint client. The query functions
 * hit the live indexer and are covered by `npm run verify`.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LAST_144_DAY, artworkUrl, canvasSize, parsePalette } from "../src/engine/basepaint";

describe("artworkUrl", () => {
  it("zero-pads the day to four digits", () => {
    // Unpadded paths 404. The index links 1,089 of these, and 999 of them are
    // under four digits, so getting this wrong breaks almost every thumbnail.
    assert.equal(artworkUrl(1), "https://basepaint.net/v3/0001.png");
    assert.equal(artworkUrl(214), "https://basepaint.net/v3/0214.png");
    assert.equal(artworkUrl(569), "https://basepaint.net/v3/0569.png");
  });

  it("leaves four-digit days alone", () => {
    assert.equal(artworkUrl(1080), "https://basepaint.net/v3/1080.png");
  });
});

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
