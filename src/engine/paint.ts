/**
 * The visitor's own coat.
 *
 * Underpaint is otherwise a reader: every image it shows is derived from
 * strokes someone else placed. Painting makes the visitor one of the hands —
 * they compose a variation, then finish it however they like, with the minted
 * artwork as the thing they are answering.
 *
 * Paint is stored as palette *indices*, not colours, for the same reason the
 * canvas is: a remix then recolours the visitor's work along with everyone
 * else's, because it is paint on the same canvas rather than a sticker on top.
 *
 * The palette those indices are read against is not always the canvas's own.
 * A remix hands the visitor the borrowed palette to paint with, and putting the
 * canvas back into its own colours leaves the brush where it was — so someone
 * can paint in one canvas's colours on top of another. The indices are the same
 * either way; `View.brushDay` decides which palette resolves them.
 *
 * It rides in a link as a BasePaint-format blob — the same `XXYYCC` triplets
 * the chain stores — so a shared painting stays a recipe.
 */

import { type Layer, YOURS } from "./replay";

/** Pixel index to palette colour index. Sparse: most of a canvas is untouched. */
export type Paint = ReadonlyMap<number, number>;

// The marker for the visitor's pixels is defined next to Layer, which owns the
// array it goes in, and re-exported here because this is where paint is made.
export { YOURS };

const TRIPLET = /^[0-9a-fA-F]{6}$/;
const byte = (n: number) => n.toString(16).padStart(2, "0");

/**
 * Every pixel on the line between two points, ends included.
 *
 * Bresenham, because a pointer dragged at speed reports positions several
 * pixels apart and joining them with nothing renders a stroke as dots.
 */
export function linePixels(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];

  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;

  let x = x0;
  let y = y0;
  let err = dx + dy;

  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) return out;

    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * The pixels one dab of the brush covers, clipped to the grid.
 *
 * Clipping matters rather than being tidy: an x of -1 on a flat pixel index
 * lands on the previous row's last pixel, so an unclipped brush at the left
 * edge paints a stray dot on the right.
 */
export function brushPixels(
  x: number,
  y: number,
  size: number,
  grid: number,
): [number, number][] {
  const out: [number, number][] = [];
  const reach = Math.floor((size - 1) / 2);

  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= grid || py >= grid) continue;
      out.push([px, py]);
    }
  }

  return out;
}

/** A copy of `layer` with the visitor's paint laid over it. */
export function applyPaint(layer: Layer, paint: Paint, area: number): Layer {
  if (paint.size === 0) return layer;

  const color = Int16Array.from(layer.color);
  const owner = Int16Array.from(layer.owner);

  for (const [pixel, colour] of paint) {
    if (pixel < 0 || pixel >= area) continue;
    color[pixel] = colour;
    owner[pixel] = YOURS;
  }

  return { color, owner };
}

/**
 * Paint as a blob of `XXYYCC` triplets, ordered by pixel.
 *
 * Ordering is what makes a painting a stable identifier — the same pixels must
 * always produce the same link, whatever order they were laid down in.
 */
export function encodePaint(paint: Paint, size: number): string {
  return [...paint.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pixel, colour]) => byte(pixel % size) + byte(Math.floor(pixel / size)) + byte(colour))
    .join("");
}

/**
 * Read a blob back, discarding anything that does not describe this canvas.
 *
 * A link is a string a stranger typed, so a bad triplet is skipped rather than
 * thrown on: a mangled painting should still open the canvas.
 */
export function decodePaint(blob: string, size: number): Map<number, number> {
  const out = new Map<number, number>();

  for (let i = 0; i + 6 <= blob.length; i += 6) {
    const triplet = blob.slice(i, i + 6);
    if (!TRIPLET.test(triplet)) continue;

    const x = parseInt(triplet.slice(0, 2), 16);
    const y = parseInt(triplet.slice(2, 4), 16);
    if (x >= size || y >= size) continue;

    out.set(y * size + x, parseInt(triplet.slice(4, 6), 16));
  }

  return out;
}
