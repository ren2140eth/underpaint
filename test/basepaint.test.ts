/**
 * Unit tests for the pure parts of the BasePaint client. The query functions
 * hit the live indexer and are covered by `npm run verify`.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  LAST_144_DAY,
  artworkUrl,
  canvasSize,
  parsePalette,
  remapPalette,
} from "../src/engine/basepaint";

describe("remapPalette", () => {
  const rgb = (n: number): [number, number, number] => [n, n, n];
  const ramp = (n: number) => Array.from({ length: n }, (_, i) => rgb(i));

  it("returns one colour per index of the canvas being repainted", () => {
    // The result stands in for the canvas's own palette, so downstream code
    // that looks up colour N keeps working unchanged.
    assert.equal(remapPalette(16, ramp(4)).length, 16);
    assert.equal(remapPalette(4, ramp(16)).length, 4);
  });

  it("is the target palette unchanged when the sizes match", () => {
    assert.deepEqual(remapPalette(4, ramp(4)), ramp(4));
  });

  it("anchors the ends, so the darkest stays darkest", () => {
    // Palettes are mostly ordered ramps; keeping the extremes in place is what
    // preserves the artwork's tonal structure through a recolour.
    const out = remapPalette(16, ramp(4));
    assert.deepEqual(out[0], rgb(0));
    assert.deepEqual(out[15], rgb(3));
  });

  it("spreads a small canvas across a larger palette", () => {
    const out = remapPalette(4, ramp(16));
    assert.deepEqual(
      out.map((c) => c[0]),
      [0, 5, 10, 15],
    );
  });

  it("never moves backwards down the ramp", () => {
    // A mapping that is not monotonic would shuffle tones and destroy the image.
    for (const [from, to] of [
      [16, 4],
      [4, 16],
      [24, 2],
      [7, 5],
      [2, 24],
    ] as const) {
      const out = remapPalette(from, ramp(to)).map((c) => c[0]);
      for (let i = 1; i < out.length; i++) {
        assert.ok(out[i] >= out[i - 1], `from ${from} to ${to} dipped at ${i}`);
      }
    }
  });

  it("keeps every colour inside the target palette", () => {
    for (const [from, to] of [
      [16, 4],
      [24, 2],
      [3, 21],
    ] as const) {
      const target = ramp(to);
      for (const c of remapPalette(from, target)) {
        assert.ok(
          target.some((t) => t[0] === c[0]),
          `from ${from} to ${to} invented ${c[0]}`,
        );
      }
    }
  });

  it("collapses onto a single-colour palette without dividing by zero", () => {
    assert.deepEqual(remapPalette(5, [rgb(9)]), Array.from({ length: 5 }, () => rgb(9)));
  });

  it("handles a one-colour canvas", () => {
    assert.deepEqual(remapPalette(1, ramp(8)), [rgb(0)]);
  });

  it("rejects an empty target or a non-positive size", () => {
    assert.throws(() => remapPalette(4, []), /palette/);
    assert.throws(() => remapPalette(0, ramp(4)), /size/);
    assert.throws(() => remapPalette(1.5, ramp(4)), /size/);
  });
});

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
