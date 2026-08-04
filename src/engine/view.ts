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
  /**
   * Repaint this canvas in another day's palette; null for its own.
   *
   * Named by day rather than by the colours themselves: a day is a stable
   * identifier, the palette is in the committed index, and a link stays short.
   */
  paletteDay: number | null;
}

export const WHOLE_CANVAS: View = {
  until: null,
  peel: 0,
  solo: null,
  muted: new Set(),
  paletteDay: null,
};

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
 * Whether any control has changed which paint is showing.
 *
 * This decides how never-painted pixels are drawn: as absent, because in a
 * partial view palette colour 0 is not deliberate paint. A palette remix is
 * deliberately excluded — it is still the whole canvas, just in other colours,
 * so its untouched pixels stay as opaque as they are in the minted artwork.
 *
 * For "did a link open this page", ask whether the recipe is empty instead;
 * that question does include the palette.
 */
export function isAltered(view: View): boolean {
  return view.until !== null || view.peel > 0 || view.solo !== null || view.muted.size > 0;
}

/** A decoded recipe, and whether it named artists this canvas no longer has. */
export interface DecodedView {
  view: View;
  /**
   * The recipe named artists under a different cast size, so those indices no
   * longer mean who they meant and were dropped.
   */
  stale: boolean;
}

const isIndex = (n: number, cast: number) => Number.isInteger(n) && n >= 0 && n < cast;

/**
 * A View as URL query parameters — the recipe a shared link carries.
 *
 * Only controls that are off their default appear, so an untouched canvas has
 * a clean address bar and the same view always produces the same string. Muted
 * artists are sorted for that reason too.
 *
 * `solo` and `muted` are indices into the replay's artist list, which is built
 * in order of first appearance. That is deterministic for a settled canvas,
 * whose strokes never change, but it is not self-describing: if the cast ever
 * shifts, an old index silently points at a different person. `n` records the
 * cast the link was made under so `decodeView` can refuse rather than lie.
 */
export function encodeView(view: View, artistCount: number): string {
  const parts: string[] = [];

  if (view.until !== null) parts.push(`t=${view.until}`);
  if (view.peel > 0) parts.push(`p=${view.peel}`);
  if (view.paletteDay !== null) parts.push(`c=${view.paletteDay}`);
  if (view.solo !== null) parts.push(`s=${view.solo}`);
  if (view.muted.size > 0) {
    parts.push(`m=${[...view.muted].sort((a, b) => a - b).join(".")}`);
  }
  if (view.solo !== null || view.muted.size > 0) parts.push(`n=${artistCount}`);

  return parts.join("&");
}

/**
 * Read a recipe back, discarding anything that does not describe this canvas.
 *
 * Every field is treated as hostile: a link is a string a stranger typed. A
 * control that cannot be parsed falls back to its default rather than throwing,
 * because a mangled link should still open the canvas.
 */
export function decodeView(search: string, artistCount: number): DecodedView {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);

  const view: View = { ...WHOLE_CANVAS, muted: new Set() };
  let stale = false;

  const until = Number(params.get("t"));
  if (params.has("t") && params.get("t") !== "" && Number.isFinite(until)) view.until = until;

  const peel = Number(params.get("p"));
  if (params.has("p") && Number.isInteger(peel) && peel >= 0) view.peel = peel;

  // Day 1 is the first canvas, so a palette day is always positive. An unknown
  // day is left to the caller, which has the index and can fall back quietly.
  const paletteDay = Number(params.get("c"));
  if (params.has("c") && Number.isInteger(paletteDay) && paletteDay > 0) {
    view.paletteDay = paletteDay;
  }

  // A recipe made under a different cast cannot be trusted about who is who.
  const named = params.has("s") || params.has("m");
  const guard = params.get("n");
  if (named && guard !== null && Number(guard) !== artistCount) {
    return { view, stale: true };
  }

  const solo = Number(params.get("s"));
  if (params.has("s") && isIndex(solo, artistCount)) view.solo = solo;

  const muted = params.get("m");
  if (muted) {
    const keep = new Set<number>();
    for (const part of muted.split(".")) {
      const i = Number(part);
      if (part !== "" && isIndex(i, artistCount)) keep.add(i);
    }
    view.muted = keep;
  }

  return { view, stale };
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
