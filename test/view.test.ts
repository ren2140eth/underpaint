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
import { applyPaint } from "../src/engine/paint";
import { UNDERPAINTING, WHOLE_CANVAS, type View, renderView, roster } from "../src/engine/view";

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

  it("matches renderPeel at every depth where no pixel was repainted in place", () => {
    // renderPeel steps one paint event at a time; renderView steps one coat.
    // On this fixture nobody repaints a coordinate, so a coat is an event and
    // the two agree. See "peels whole coats" below for where they diverge.
    for (let n = 0; n <= 3; n++) {
      assert.deepEqual(painted(renderView(r, view({ peel: n }))), painted(renderPeel(r, n)), `peel ${n}`);
    }
  });

  it("peels whole coats, not paint events", () => {
    // A brush dragged back over its own path, then covered by B doing the
    // same. 310 of the 1,090 canvases contain repeats like this.
    const repeated = replay(
      [
        mk(A, 100, "0x" + px(0, 0, 1) + px(0, 0, 1)),
        mk(B, 200, "0x" + px(0, 0, 2) + px(0, 0, 2)),
      ],
      SIZE,
    );

    // Event-based peel lands on B's own second event: one coat off shows the
    // surface again, so "Underpainting" silently does nothing on these pixels.
    assert.deepEqual(painted(renderPeel(repeated, 1)), { "0,0": [2, 1] });

    // Coat-based peel steps past the whole run and reveals A underneath.
    assert.deepEqual(painted(renderView(repeated, view({ peel: 1 }))), { "0,0": [1, 0] });
  });

  it("counts a repainted run as one coat when peeling past the bottom", () => {
    const repeated = replay([mk(A, 100, "0x" + px(0, 0, 1) + px(0, 0, 1) + px(0, 0, 1))], SIZE);
    assert.deepEqual(painted(renderView(repeated, view({ peel: 0 }))), { "0,0": [1, 0] });
    assert.deepEqual(painted(renderView(repeated, view({ peel: 1 }))), {});
  });

  it("starts a new coat when an artist returns to a colour after being covered", () => {
    // A, B, A on one pixel is three coats even though A's colour repeats.
    const returned = replay(
      [
        mk(A, 100, "0x" + px(0, 0, 1)),
        mk(B, 200, "0x" + px(0, 0, 2)),
        mk(A, 300, "0x" + px(0, 0, 1)),
      ],
      SIZE,
    );
    assert.deepEqual(painted(renderView(returned, view({ peel: 1 }))), { "0,0": [2, 1] });
    assert.deepEqual(painted(renderView(returned, view({ peel: 2 }))), { "0,0": [1, 0] });
  });

  it("counts coats after the filters, not before", () => {
    // Muting B must not leave B's run behind as a coat to step over: with B
    // gone the pixel is one A coat, so peel 1 empties it.
    const repeated = replay(
      [
        mk(A, 100, "0x" + px(0, 0, 1) + px(0, 0, 1)),
        mk(B, 200, "0x" + px(0, 0, 2) + px(0, 0, 2)),
      ],
      SIZE,
    );
    const muted = new Set([1]);
    assert.deepEqual(painted(renderView(repeated, view({ muted }))), { "0,0": [1, 0] });
    assert.deepEqual(painted(renderView(repeated, view({ muted, peel: 1 }))), {});
  });

  it("solos everything an artist painted, not just what survived", () => {
    // renderSolo answers "which pixels does B still own" — none, B was covered.
    assert.deepEqual(painted(renderSolo(r, 1)), {});

    // The x-ray asks the more useful question: what did B paint at all? On a
    // busy canvas about half the artists have all their paint under later
    // coats, and that work is the whole subject here.
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

describe("roster", () => {
  const by = (entries: ReturnType<typeof roster>) =>
    Object.fromEntries(entries.map((e) => [e.artist, e]));

  it("lists every artist on the canvas, not only the visible ones", () => {
    const entries = roster(r, renderView(r, WHOLE_CANVAS));
    assert.equal(entries.length, r.artists.length);
    assert.deepEqual(
      entries.map((e) => e.artist).sort(),
      [A, B, C].sort(),
    );
  });

  it("reports pixels ever painted alongside the current visible share", () => {
    const entries = by(roster(r, renderView(r, WHOLE_CANVAS)));

    // A painted (0,0) and (1,0); both survive — (0,0) because A repainted over B.
    assert.deepEqual(
      { everPainted: entries[A].everPainted, visible: entries[A].visible, share: entries[A].share },
      { everPainted: 2, visible: 2, share: 2 / 3 },
    );

    // B painted one pixel and A covered it. The row is the point of the site.
    assert.deepEqual(
      { everPainted: entries[B].everPainted, visible: entries[B].visible, share: entries[B].share },
      { everPainted: 1, visible: 0, share: 0 },
    );
  });

  it("counts a pixel once however many times an artist repainted it", () => {
    // A touched (0,0) twice, at t=100 and t=300. That is one pixel of labour.
    assert.equal(by(roster(r, renderView(r, WHOLE_CANVAS)))[A].everPainted, 2);
  });

  it("keeps a muted artist listed so the control that muted them survives", () => {
    // The bug this guards: deriving the list from the render drops muted
    // artists, and with them the only button that can unmute.
    const muted = new Set([1]);
    const entries = by(roster(r, renderView(r, view({ muted }))));
    assert.equal(entries[B].everPainted, 1);
    assert.equal(entries[B].visible, 0);
  });

  it("keeps a soloed artist's rivals listed", () => {
    const entries = roster(r, renderView(r, view({ solo: 1 })));
    assert.equal(entries.length, 3);
    assert.equal(by(entries)[A].visible, 0);
    assert.equal(by(entries)[B].visible, 1);
  });

  it("orders by what is visible now, then by total work", () => {
    const entries = roster(r, renderView(r, WHOLE_CANVAS));
    assert.deepEqual(
      entries.map((e) => e.artist),
      [A, C, B],
    );
  });

  it("shares sum to one while anything is visible", () => {
    const total = roster(r, renderView(r, WHOLE_CANVAS)).reduce((n, e) => n + e.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-12, `shares summed to ${total}`);
  });

  it("reports zero shares rather than dividing by zero on an empty view", () => {
    const entries = roster(r, renderView(r, view({ peel: 99 })));
    assert.equal(entries.length, 3);
    assert.ok(entries.every((e) => e.share === 0 && e.visible === 0));
    assert.ok(entries.every((e) => e.everPainted > 0));
  });

  it("counts the visitor's own paint against the total without crediting an artist", () => {
    // Painting covers a pixel A owned. A's share must fall, because the share
    // is "of what is visible" — but the visitor is not one of the canvas's
    // artists and must never appear in their ranking.
    const layer = renderView(r, WHOLE_CANVAS);
    const painted = applyPaint(layer, new Map([[0, 5]]), r.area);

    const before = roster(r, layer);
    const after = roster(r, painted);

    assert.equal(after.length, before.length, "no artist was added");
    assert.ok(after.every((e) => e.index >= 0));

    const a = after.find((e) => e.artist === A);
    if (!a) throw new Error("A missing");
    // A owned 2 of 3 visible pixels; one is now the visitor's, so 1 of 3.
    assert.equal(a.visible, 1);
    assert.ok(Math.abs(a.share - 1 / 3) < 1e-12, `share was ${a.share}`);
  });

  it("carries the artist index the view filters speak in", () => {
    for (const e of roster(r, renderView(r, WHOLE_CANVAS))) {
      assert.equal(r.artists[e.index], e.artist);
    }
  });
});
