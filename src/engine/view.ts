/**
 * One composed variation of a canvas.
 *
 * The individual renderers in replay.ts each answer one question. The x-ray
 * needs them combined — "hour 14, two coats down, without these three artists"
 * is a single image, not three. Every control is a filter or an offset applied
 * to the same per-pixel event stack, so they compose in one pass.
 *
 * A View is also the whole state of the x-ray, which is what gets encoded into
 * the URL in Phase 5: a recipe, not a file.
 */

import { type Layer, type Replay, UNPAINTED } from "./replay";

/** One artist's standing in a rendered view: their whole contribution, and what is left of it. */
export interface RosterEntry {
  /** index into Replay.artists — what `solo` and `muted` are expressed in */
  index: number;
  artist: string;
  /** distinct pixels this artist ever placed paint on, however often they repainted them */
  everPainted: number;
  /** pixels they own in the current view */
  visible: number;
  /** their fraction of everything visible in the current view */
  share: number;
}

export interface View {
  /** show only paint placed at or before this unix time; null for the whole day */
  until: number | null;
  /**
   * Strip this many coats off the top of every pixel.
   *
   * A coat is a run of paint leaving one colour from one hand, not one paint
   * event: a brush dragged back over its own path repaints a coordinate
   * without laying down anything new, and 310 of the 1,090 canvases contain
   * runs like that. Counting events instead would make peel 1 return the
   * surface unchanged on exactly those pixels. `maxDistinctDepth` in the
   * canvas stats is the matching upper bound.
   */
  peel: number;
  /** show only this artist's paint; null for everyone */
  solo: number | null;
  /** hide these artists, revealing whatever was under them */
  muted: ReadonlySet<number>;
}

export const WHOLE_CANVAS: View = { until: null, peel: 0, solo: null, muted: new Set() };

/**
 * Underpainting is peel 1 — the coat directly beneath the surface, with
 * single-coat pixels dropped because nothing was buried there.
 */
export const UNDERPAINTING: View = { ...WHOLE_CANVAS, peel: 1 };

export function renderView(r: Replay, view: View): Layer {
  const { until, peel, solo, muted } = view;
  if (!Number.isInteger(peel) || peel < 0) {
    throw new RangeError(`renderView: peel must be a non-negative integer, got ${peel}`);
  }
  if (until !== null && !Number.isFinite(until)) {
    throw new RangeError(`renderView: until must be finite or null, got ${until}`);
  }

  const color = new Int16Array(r.area).fill(UNPAINTED);
  const owner = new Int16Array(r.area).fill(UNPAINTED);

  for (let p = 0; p < r.area; p++) {
    const stack = r.stacks[p];
    let skipped = 0;
    // The coat currently being stepped over, so a run of events that all leave
    // the same colour from the same hand costs one peel rather than many.
    let runArtist = -1;
    let runColor = -1;
    let started = false;

    // Walk down from the surviving coat, ignoring paint the filters exclude,
    // then step past `peel` more coats before taking one.
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      const artist = r.evArtist[e];
      const c = r.evColor[e];

      if (until !== null && r.evTime[e] > until) continue;
      if (solo !== null && artist !== solo) continue;
      if (muted.has(artist)) continue;

      // Coats are counted among the events that survive the filters, so muting
      // an artist removes their coat rather than leaving a gap to step over.
      const sameCoat = started && artist === runArtist && c === runColor;
      if (!sameCoat) {
        if (started) skipped++;
        started = true;
        runArtist = artist;
        runColor = c;
      }

      if (skipped < peel) continue;

      color[p] = c;
      owner[p] = artist;
      break;
    }
  }

  return { color, owner };
}

/**
 * Every artist on the canvas, joined to what they own in a rendered view.
 *
 * `attribution` answers "whose paint am I looking at", so it can only name
 * artists who still own a pixel. The panel needs the other question — who is
 * on this canvas at all — because the artists worth soloing are exactly the
 * ones with nothing left to see, and because an artist you have just muted
 * must keep the row carrying the button that unmutes them.
 */
export function roster(r: Replay, layer: Layer): RosterEntry[] {
  // A pixel counts once per artist however many times they repainted it, so
  // a blob that hammers one coordinate does not out-rank real coverage.
  const everPainted = new Int32Array(r.artists.length);
  const seenOn = new Int32Array(r.artists.length).fill(-1);

  for (let p = 0; p < r.area; p++) {
    for (const e of r.stacks[p]) {
      const a = r.evArtist[e];
      if (seenOn[a] === p) continue;
      seenOn[a] = p;
      everPainted[a]++;
    }
  }

  const visible = new Int32Array(r.artists.length);
  let total = 0;
  for (let p = 0; p < r.area; p++) {
    const a = layer.owner[p];
    if (a === UNPAINTED) continue;
    visible[a]++;
    total++;
  }

  return r.artists
    .map((artist, index) => ({
      index,
      artist,
      everPainted: everPainted[index],
      visible: visible[index],
      share: total === 0 ? 0 : visible[index] / total,
    }))
    .sort((a, b) => b.visible - a.visible || b.everPainted - a.everPainted);
}
