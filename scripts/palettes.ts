/**
 * Write the palette lookup the remix control fetches.
 *
 * Every canvas's palette is already in `data/index.json`, but that file is 978
 * KB and server-only. Remixing needs *other* canvases' palettes in the browser,
 * and putting all 1,090 into every canvas page would add 43 KB gzipped to 1,090
 * pages for a control most visitors never touch. One lazily-fetched file costs
 * nothing until it is used.
 *
 * Generated, not committed — it is a projection of the committed index, and a
 * stale copy would quietly disagree with it.
 *
 *   npm run palettes      # or automatically, via prebuild
 */

import { mkdir, writeFile } from "node:fs/promises";
import index from "../data/index.json" with { type: "json" };
import type { CanvasStats } from "../src/engine/stats";

/** [day, name, palette] — an array rather than objects, to halve the bytes. */
export type PaletteRow = [number, string, string];

const OUT = "public/palettes.json";

async function main() {
  const canvases = index.canvases as unknown as CanvasStats[];

  const rows: PaletteRow[] = [];
  for (const c of canvases) {
    // A canvas with no palette cannot be worn; the index has none today, but
    // dropping rather than emitting null keeps the client free of the case.
    if (!c.palette) continue;
    rows.push([c.day, c.name, c.palette.replace(/#/g, "")]);
  }

  await mkdir("public", { recursive: true });
  await writeFile(OUT, JSON.stringify(rows));

  const kb = (JSON.stringify(rows).length / 1024).toFixed(0);
  console.log(`${OUT}: ${rows.length} palettes, ${kb} KB`);

  if (rows.length !== canvases.length) {
    console.log(`  ${canvases.length - rows.length} canvases have no palette and were skipped`);
  }
}

main();
