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

export interface View {
  /** show only paint placed at or before this unix time; null for the whole day */
  until: number | null;
  /** strip this many coats off the top of every pixel */
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

    // Walk down from the surviving coat, ignoring paint the filters exclude,
    // then step past `peel` more coats before taking one.
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      const artist = r.evArtist[e];

      if (until !== null && r.evTime[e] > until) continue;
      if (solo !== null && artist !== solo) continue;
      if (muted.has(artist)) continue;

      if (skipped < peel) {
        skipped++;
        continue;
      }

      color[p] = r.evColor[e];
      owner[p] = artist;
      break;
    }
  }

  return { color, owner };
}
