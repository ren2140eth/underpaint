/**
 * A shared x-ray link is a recipe, not a file: the URL names the controls and
 * the canvas is re-derived from the strokes. Two things have to hold for that
 * to mean anything.
 *
 * The same view must always produce the same string, or the link is not a
 * stable identifier. And a recipe that names artists must fail loudly if the
 * canvas's cast has changed, because `solo` and `muted` are indices into the
 * replay's artist list — if that list shifts, an old link keeps working while
 * quietly showing a different artist.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { WHOLE_CANVAS, type View, decodeView, encodeView, isAltered } from "../src/engine/view";

const CAST = 68;
const view = (over: Partial<View> = {}): View => ({ ...WHOLE_CANVAS, ...over });

describe("isAltered", () => {
  it("is false for the untouched canvas", () => {
    assert.equal(isAltered(WHOLE_CANVAS), false);
  });

  it("is true when any single control is off its default", () => {
    assert.equal(isAltered(view({ peel: 1 })), true);
    assert.equal(isAltered(view({ until: 1784850000 })), true);
    assert.equal(isAltered(view({ solo: 0 })), true);
    assert.equal(isAltered(view({ muted: new Set([0]) })), true);
  });

  it("agrees with the recipe being empty", () => {
    // The two are the same question — an untouched canvas has a clean URL —
    // and the x-ray relies on that to decide whether a link opened the page.
    for (const v of [WHOLE_CANVAS, view({ peel: 1 }), view({ solo: 3 }), view({ until: 1 })]) {
      assert.equal(isAltered(v), encodeView(v, CAST) !== "", JSON.stringify(v.peel));
    }
  });
});

describe("encodeView", () => {
  it("encodes the untouched canvas as nothing", () => {
    // The default view should leave the address bar clean.
    assert.equal(encodeView(WHOLE_CANVAS, CAST), "");
  });

  it("omits controls that are at their default", () => {
    assert.equal(encodeView(view({ peel: 2 }), CAST), "p=2");
    assert.equal(encodeView(view({ until: 1784850000 }), CAST), "t=1784850000");
  });

  it("carries the artist count whenever it names an artist", () => {
    assert.equal(encodeView(view({ solo: 4 }), CAST), "s=4&n=68");
    assert.equal(encodeView(view({ muted: new Set([2]) }), CAST), "m=2&n=68");
  });

  it("does not carry the artist count when no artist is named", () => {
    // Nothing to go stale, so nothing to guard.
    assert.equal(encodeView(view({ peel: 1 }), CAST), "p=1");
  });

  it("orders muted artists so the same view is always the same link", () => {
    const a = encodeView(view({ muted: new Set([9, 2, 7]) }), CAST);
    const b = encodeView(view({ muted: new Set([7, 9, 2]) }), CAST);
    assert.equal(a, b);
    assert.equal(a, "m=2.7.9&n=68");
  });

  it("combines every control in a fixed order", () => {
    const encoded = encodeView(
      view({ until: 1784850000, peel: 2, muted: new Set([3, 1]) }),
      CAST,
    );
    assert.equal(encoded, "t=1784850000&p=2&m=1.3&n=68");
  });
});

describe("decodeView", () => {
  const decode = (s: string, cast = CAST) => decodeView(s, cast);

  it("returns the untouched canvas for an empty recipe", () => {
    assert.deepEqual(decode(""), { view: WHOLE_CANVAS, stale: false });
  });

  it("round-trips every control", () => {
    for (const v of [
      view({ peel: 3 }),
      view({ until: 1784850000 }),
      view({ solo: 12 }),
      view({ muted: new Set([1, 4, 9]) }),
      view({ until: 1784850000, peel: 2, muted: new Set([5]) }),
    ]) {
      const { view: out, stale } = decode(encodeView(v, CAST));
      assert.equal(stale, false);
      assert.deepEqual({ ...out, muted: [...out.muted].sort((a, b) => a - b) }, {
        ...v,
        muted: [...v.muted].sort((a, b) => a - b),
      });
    }
  });

  it("tolerates a leading question mark", () => {
    assert.equal(decode("?p=2").view.peel, 2);
  });

  it("ignores keys it does not know", () => {
    assert.equal(decode("p=2&utm_source=farcaster").view.peel, 2);
  });

  it("drops a peel that is not a non-negative integer", () => {
    for (const bad of ["p=-1", "p=1.5", "p=abc", "p="]) {
      assert.equal(decode(bad).view.peel, 0, bad);
    }
  });

  it("drops a time that is not a finite number", () => {
    for (const bad of ["t=abc", "t=", "t=NaN"]) {
      assert.equal(decode(bad).view.until, null, bad);
    }
  });

  it("drops an artist index outside the cast", () => {
    assert.equal(decode("s=999&n=68").view.solo, null);
    assert.equal(decode("s=-1&n=68").view.solo, null);
    assert.deepEqual([...decode("m=1.999.3&n=68").view.muted], [1, 3]);
  });

  it("reports a recipe whose cast has changed, and drops the artists", () => {
    // The link was made when the canvas had 68 artists. It now has 70, so the
    // indices no longer mean who they meant. Showing artist 4 anyway would be
    // silently wrong, which is the one outcome worth preventing.
    const { view: out, stale } = decode("p=2&s=4&n=68", 70);
    assert.equal(stale, true);
    assert.equal(out.solo, null);
    assert.equal(out.muted.size, 0);
    // Controls that do not name an artist survive.
    assert.equal(out.peel, 2);
  });

  it("does not report staleness when no artist was named", () => {
    assert.deepEqual(decode("p=2", 70), { view: view({ peel: 2 }), stale: false });
  });

  it("accepts a hand-written recipe with no guard", () => {
    // Nothing to check against, so it is honoured rather than refused.
    const { view: out, stale } = decode("s=4");
    assert.equal(out.solo, 4);
    assert.equal(stale, false);
  });

  it("survives being handed nonsense", () => {
    for (const junk of ["&&&", "=", "p", "%", "m=..", "m="]) {
      const { view: out } = decode(junk);
      assert.equal(out.peel, 0, junk);
      assert.equal(out.solo, null, junk);
      assert.equal(out.muted.size, 0, junk);
    }
  });

  it("is stable across a re-encode", () => {
    // Decoding then re-encoding must not drift, or a link changes each time it
    // is shared onward.
    const original = "t=1784850000&p=2&m=1.3&n=68";
    const { view: out } = decode(original);
    assert.equal(encodeView(out, CAST), original);
  });
});
