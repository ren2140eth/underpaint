/**
 * Composed views must agree with the single-purpose renderers where they
 * overlap, and behave sensibly where they combine.
 *
 * Same 4x4 fixture as replay.test.ts:
 *   (0,0)  A c0 @100, B c2 @200, A c3 @300
 *   (1,0)  A c1 @100
 *   (2,1)  C c4 @400
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { Stroke } from "../src/engine/basepaint";
import {
  UNPAINTED,
  renderFinal,
  renderPeel,
  renderSolo,
  renderUnderpainting,
  renderWithout,
  replay,
} from "../src/engine/replay";
import { UNDERPAINTING, WHOLE_CANVAS, type View, renderView } from "../src/engine/view";

const SIZE = 4;
const A = "0xAAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaA";
const B = "0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb";
const C = "0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc";

const byte = (n: number) => n.toString(16).padStart(2, "0");
const px = (x: number, y: number, c: number) => byte(x) + byte(y) + byte(c);

let nextId = 1;
const mk = (accountId: string, timestamp: number, data: string): Stroke => ({
  id: String(nextId++),
  accountId,
  data,
  pixels: Math.floor(data.replace(/^0x/, "").length / 6),
  timestamp: String(timestamp),
});

const r = replay(
  [
    mk(A, 100, "0x" + px(0, 0, 0) + px(1, 0, 1)),
    mk(B, 200, "0x" + px(0, 0, 2)),
    mk(A, 300, "0x" + px(0, 0, 3)),
    mk(C, 400, "0x" + px(2, 1, 4)),
  ],
  SIZE,
);

const painted = (layer: { color: Int16Array; owner: Int16Array }) => {
  const out: Record<string, [number, number]> = {};
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (layer.color[p] === UNPAINTED && layer.owner[p] === UNPAINTED) continue;
    out[`${p % SIZE},${Math.floor(p / SIZE)}`] = [layer.color[p], layer.owner[p]];
  }
  return out;
};

const view = (over: Partial<View> = {}): View => ({ ...WHOLE_CANVAS, ...over });

describe("renderView", () => {
  it("with no filters is the final image", () => {
    assert.deepEqual(painted(renderView(r, WHOLE_CANVAS)), painted(renderFinal(r)));
  });

  it("matches renderPeel at every depth", () => {
    for (let n = 0; n <= 3; n++) {
      assert.deepEqual(painted(renderView(r, view({ peel: n }))), painted(renderPeel(r, n)), `peel ${n}`);
    }
  });

  it("solos everything an artist painted, not just what survived", () => {
    // renderSolo answers "which pixels does B still own" — none, B was covered.
    assert.deepEqual(painted(renderSolo(r, 1)), {});

    // The x-ray asks the more useful question: what did B paint at all? Half
    // the artists on a busy canvas finish with nothing visible, and their work
    // is the whole subject here.
    assert.deepEqual(painted(renderView(r, view({ solo: 1 }))), { "0,0": [2, 1] });
  });

  it("agrees with renderSolo for artists whose paint survived", () => {
    // Where nothing was covered the two questions have the same answer.
    assert.deepEqual(painted(renderView(r, view({ solo: 2 }))), painted(renderSolo(r, 2)));
  });

  it("matches renderWithout", () => {
    const muted = new Set([0]);
    assert.deepEqual(painted(renderView(r, view({ muted }))), painted(renderWithout(r, muted)));
  });

  it("matches renderUnderpainting", () => {
    assert.deepEqual(painted(renderView(r, UNDERPAINTING)), painted(renderUnderpainting(r)));
  });

  it("scrubs time like renderAtTime", () => {
    assert.deepEqual(painted(renderView(r, view({ until: 250 }))), {
      "0,0": [2, 1],
      "1,0": [1, 0],
    });
  });

  it("combines time and peel", () => {
    // At t=250 the stack on (0,0) is [A c0, B c2]; one coat down is A's c0.
    assert.deepEqual(painted(renderView(r, view({ until: 250, peel: 1 }))), { "0,0": [0, 0] });
  });

  it("combines mute and peel", () => {
    // Muting B leaves [A c0, A c3] on (0,0); one coat down is c0.
    assert.deepEqual(painted(renderView(r, view({ muted: new Set([1]), peel: 1 }))), {
      "0,0": [0, 0],
    });
  });

  it("peels past the bottom of a pixel rather than wrapping", () => {
    assert.deepEqual(painted(renderView(r, view({ peel: 99 }))), {});
  });

  it("solo and mute of the same artist cancel to nothing", () => {
    assert.deepEqual(painted(renderView(r, view({ solo: 0, muted: new Set([0]) }))), {});
  });

  it("rejects a negative or fractional peel", () => {
    assert.throws(() => renderView(r, view({ peel: -1 })), /peel/);
    assert.throws(() => renderView(r, view({ peel: 1.5 })), /peel/);
    assert.throws(() => renderView(r, view({ until: Number.NaN })), /until/);
  });
});
