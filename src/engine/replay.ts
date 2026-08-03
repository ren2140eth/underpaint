/**
 * Stroke replay.
 *
 * A BasePaint canvas is a shared grid painted over 24 hours. Artists paint over
 * each other, and the minted artwork is only what survived. Replaying strokes in
 * order reconstructs not just the final image but every layer beneath it.
 *
 * Every view in the app is a pure function of the Replay produced here.
 */

import type { Stroke } from "./basepaint.js";

/** A single pixel placement. */
export interface PaintEvent {
  artist: number;
  color: number;
  time: number;
}

export const UNPAINTED = -1;

/** One pixel: XXYYCC. Anything else in a blob is not paint. */
const TRIPLET = /^[0-9a-fA-F]{6}$/;

/** Stroke blobs are hex, normally 0x-prefixed. Both forms decode the same. */
function hexBody(data: string): string {
  return /^0x/i.test(data) ? data.slice(2) : data;
}

function requireInt(label: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${label} must be an integer in [${min}, ${max}], got ${v}`);
  }
}

export interface Replay {
  size: number;
  area: number;
  /** artist index -> address, in order of first appearance */
  artists: string[];
  /** per pixel: palette index of the surviving paint, or UNPAINTED */
  color: Int16Array;
  /** per pixel: artist index of the surviving paint, or UNPAINTED */
  owner: Int16Array;
  /** per pixel: how many times it was painted */
  depth: Uint16Array;
  /** per pixel: indices into the event arrays, oldest first */
  stacks: number[][];
  evArtist: Int32Array;
  evColor: Uint8Array;
  evTime: Float64Array;
  totalPlaced: number;
  firstTime: number;
  lastTime: number;
}

/**
 * Replay strokes onto a size x size grid.
 *
 * Strokes must already be in chronological order (fetchStrokes sorts them).
 * Pixels outside the grid, truncated tails and non-hex triplets are skipped
 * rather than throwing — a malformed blob should not take down a whole canvas.
 */
export function replay(strokes: Stroke[], size: number): Replay {
  // Coordinates are one byte each, so a grid past 256 is unaddressable.
  requireInt("replay: size", size, 1, 256);
  const area = size * size;

  const color = new Int16Array(area).fill(UNPAINTED);
  const owner = new Int16Array(area).fill(UNPAINTED);
  const depth = new Uint16Array(area);
  const stacks: number[][] = Array.from({ length: area }, () => []);

  const artists: string[] = [];
  const artistIndex = new Map<string, number>();

  // Upper bound on events, so the arrays are allocated once. Must be derived
  // from the same normalisation the decode loop uses, or the arrays come up
  // short and the histories silently lose their tail.
  const capacity = strokes.reduce((n, s) => n + Math.floor(hexBody(s.data).length / 6), 0);
  const evArtist = new Int32Array(capacity);
  const evColor = new Uint8Array(capacity);
  const evTime = new Float64Array(capacity);

  let n = 0;
  let firstTime = Infinity;
  let lastTime = -Infinity;

  for (const stroke of strokes) {
    const key = stroke.accountId.toLowerCase();
    let artist = artistIndex.get(key);
    if (artist === undefined) {
      artist = artists.length;
      artistIndex.set(key, artist);
      artists.push(stroke.accountId);
    }

    const time = Number(stroke.timestamp);
    if (time < firstTime) firstTime = time;
    if (time > lastTime) lastTime = time;

    const hex = hexBody(stroke.data);

    for (let i = 0; i + 6 <= hex.length; i += 6) {
      const triplet = hex.slice(i, i + 6);
      if (!TRIPLET.test(triplet)) continue;

      const x = parseInt(triplet.slice(0, 2), 16);
      const y = parseInt(triplet.slice(2, 4), 16);
      const c = parseInt(triplet.slice(4, 6), 16);
      if (x >= size || y >= size) continue;

      const p = y * size + x;
      evArtist[n] = artist;
      evColor[n] = c;
      evTime[n] = time;

      stacks[p].push(n);
      depth[p]++;
      color[p] = c;
      owner[p] = artist;
      n++;
    }
  }

  return {
    size,
    area,
    artists,
    color,
    owner,
    depth,
    stacks,
    evArtist,
    evColor,
    evTime,
    totalPlaced: n,
    firstTime: firstTime === Infinity ? 0 : firstTime,
    lastTime: lastTime === -Infinity ? 0 : lastTime,
  };
}

/** The paint events on one pixel, oldest first. */
export function pixelHistory(r: Replay, x: number, y: number): PaintEvent[] {
  // Unchecked, x = size would quietly read the first pixel of the next row.
  requireInt("pixelHistory: x coordinate", x, 0, r.size - 1);
  requireInt("pixelHistory: y coordinate", y, 0, r.size - 1);

  const stack = r.stacks[y * r.size + x];
  return stack.map((i) => ({ artist: r.evArtist[i], color: r.evColor[i], time: r.evTime[i] }));
}

/** A rendered variation: palette index per pixel, plus who owns each one. */
export interface Layer {
  color: Int16Array;
  owner: Int16Array;
}

/** The canvas as minted. */
export function renderFinal(r: Replay): Layer {
  return { color: r.color, owner: r.owner };
}

/** The canvas as it stood at a unix timestamp. */
export function renderAtTime(r: Replay, time: number): Layer {
  if (!Number.isFinite(time)) throw new RangeError(`renderAtTime: time must be finite, got ${time}`);
  return renderTopmost(r, (i) => r.evTime[i] <= time);
}

/**
 * Strip the top `n` paint layers from every pixel.
 *
 * n = 0 is the final image; n = 1 shows what was under the last coat. Pixels
 * painted fewer than n+1 times fall back to unpainted.
 */
export function renderPeel(r: Replay, n: number): Layer {
  requireInt("renderPeel: depth", n, 0, Number.MAX_SAFE_INTEGER);

  const color = new Int16Array(r.area).fill(UNPAINTED);
  const owner = new Int16Array(r.area).fill(UNPAINTED);

  for (let p = 0; p < r.area; p++) {
    const stack = r.stacks[p];
    const idx = stack.length - 1 - n;
    if (idx < 0) continue;
    const e = stack[idx];
    color[p] = r.evColor[e];
    owner[p] = r.evArtist[e];
  }
  return { color, owner };
}

/** Only this artist's surviving pixels; everything else unpainted. */
export function renderSolo(r: Replay, artist: number): Layer {
  requireInt("renderSolo: artist", artist, 0, r.artists.length - 1);

  const color = new Int16Array(r.area).fill(UNPAINTED);
  const owner = new Int16Array(r.area).fill(UNPAINTED);

  for (let p = 0; p < r.area; p++) {
    if (r.owner[p] !== artist) continue;
    color[p] = r.color[p];
    owner[p] = artist;
  }
  return { color, owner };
}

/** The canvas with these artists removed, revealing whatever was beneath. */
export function renderWithout(r: Replay, muted: ReadonlySet<number>): Layer {
  for (const artist of muted) requireInt("renderWithout: artist", artist, 0, r.artists.length - 1);
  return renderTopmost(r, (i) => !muted.has(r.evArtist[i]));
}

/**
 * Everything that was ever painted and then covered — the buried layer promoted
 * to the surface. Pixels painted only once are left unpainted, since nothing
 * was buried there.
 */
export function renderUnderpainting(r: Replay): Layer {
  const color = new Int16Array(r.area).fill(UNPAINTED);
  const owner = new Int16Array(r.area).fill(UNPAINTED);

  for (let p = 0; p < r.area; p++) {
    const stack = r.stacks[p];
    if (stack.length < 2) continue;
    const e = stack[stack.length - 2];
    color[p] = r.evColor[e];
    owner[p] = r.evArtist[e];
  }
  return { color, owner };
}

/** Topmost event per pixel satisfying `keep`. */
function renderTopmost(r: Replay, keep: (eventIndex: number) => boolean): Layer {
  const color = new Int16Array(r.area).fill(UNPAINTED);
  const owner = new Int16Array(r.area).fill(UNPAINTED);

  for (let p = 0; p < r.area; p++) {
    const stack = r.stacks[p];
    for (let i = stack.length - 1; i >= 0; i--) {
      const e = stack[i];
      if (!keep(e)) continue;
      color[p] = r.evColor[e];
      owner[p] = r.evArtist[e];
      break;
    }
  }
  return { color, owner };
}

/**
 * Visible pixel count per artist for a variation — this is the split.
 * Returned descending, with the share as a fraction of visible pixels.
 */
export function attribution(
  r: Replay,
  layer: Layer,
): { artist: string; index: number; pixels: number; share: number }[] {
  const counts = new Map<number, number>();
  let visible = 0;

  for (let p = 0; p < r.area; p++) {
    const a = layer.owner[p];
    if (a === UNPAINTED) continue;
    counts.set(a, (counts.get(a) ?? 0) + 1);
    visible++;
  }

  return [...counts.entries()]
    .map(([index, pixels]) => ({
      index,
      artist: r.artists[index],
      pixels,
      share: visible === 0 ? 0 : pixels / visible,
    }))
    .sort((a, b) => b.pixels - a.pixels);
}

/**
 * How to draw pixels that no stroke ever touched.
 *
 * BasePaint canvases start filled with palette colour 0, so the published
 * artwork is fully opaque — "background" reproduces it. The x-ray views want
 * untouched pixels to read as absent instead, which is "transparent".
 */
export type Background = "background" | "transparent";

/** Palette indices -> RGBA bytes. */
export function toRGBA(
  layer: Layer,
  palette: [number, number, number][],
  area: number,
  background: Background = "background",
): Uint8Array {
  if (palette.length === 0) throw new RangeError("toRGBA: palette is empty");

  const out = new Uint8Array(area * 4);
  const base = background === "background" ? palette[0] : undefined;

  for (let p = 0; p < area; p++) {
    const c = layer.color[p];
    // A colour index past the end of the palette is bad data from the chain,
    // not a caller error, so it is left transparent rather than guessed at —
    // one stray pixel must not fail a whole canvas.
    const rgb = c === UNPAINTED ? base : palette[c];
    if (!rgb) continue;
    out[p * 4] = rgb[0];
    out[p * 4 + 1] = rgb[1];
    out[p * 4 + 2] = rgb[2];
    out[p * 4 + 3] = 255;
  }
  return out;
}
