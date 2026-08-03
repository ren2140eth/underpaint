/**
 * Correctness proof for the replay engine.
 *
 * Re-derives each canvas's final image from its strokes and compares it
 * pixel-for-pixel against the artwork BasePaint published at
 * basepaint.net/v3/XXXX.png. If the replay is right, they match exactly.
 *
 *   npm run verify            # a spread of days across the whole history
 *   npm run verify 1080 1081  # specific days
 */

import { PNG } from "pngjs";
import { fetchCanvas, fetchStrokes, parsePalette } from "../src/engine/basepaint.js";
import { replay, renderFinal, toRGBA, UNPAINTED } from "../src/engine/replay.js";
import { canvasStats } from "../src/engine/stats.js";

/**
 * Headline numbers measured by hand when the project was scoped. They are
 * quoted in the README and the design doc, so a definition change that moves
 * them should fail here rather than quietly making the writing wrong.
 */
const GROUND_TRUTH: Record<number, Record<string, number>> = {
  1080: {
    placed: 139618,
    visible: 59546,
    buried: 80072,
    artists: 68,
    artistsVisible: 36,
    maxDepth: 7,
    coverage: 0.909,
    buriedShare: 0.574,
    meanDepth: 2.34,
    lateSurge: 0.365,
  },
};

/** Numbers agree to the precision the docs quote them at. */
function checkGroundTruth(day: number, stats: Record<string, unknown>): string[] {
  const expected = GROUND_TRUTH[day];
  if (!expected) return [];

  const bad: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = stats[key] as number;
    const places = String(want).split(".")[1]?.length ?? 0;
    if (Number(got.toFixed(places)) !== want) bad.push(`${key} expected ${want}, got ${got}`);
  }
  return bad;
}

const OFFICIAL = (day: number) => `https://basepaint.net/v3/${String(day).padStart(4, "0")}.png`;

interface Result {
  day: number;
  size: number;
  ok: boolean;
  mismatches: number;
  note: string;
}

async function officialImage(day: number): Promise<PNG> {
  const res = await fetch(OFFICIAL(day));
  if (!res.ok) throw new Error(`official png ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return PNG.sync.read(buf);
}

async function verifyDay(day: number): Promise<Result> {
  const [canvas, strokes] = await Promise.all([fetchCanvas(day), fetchStrokes(day)]);
  const r = replay(strokes, canvas.size);
  if (canvas.palette === null) throw new Error("no palette from the indexer or the theme API");
  const palette = parsePalette(canvas.palette);
  const ours = toRGBA(renderFinal(r), palette, r.area);

  const png = await officialImage(day);
  if (png.width !== canvas.size || png.height !== canvas.size) {
    return {
      day,
      size: canvas.size,
      ok: false,
      mismatches: -1,
      note:
        `size mismatch: official ${png.width}x${png.height}, canvas ${canvas.size}` +
        (canvas.filledFromTheme ? " (size came from the theme API)" : ""),
    };
  }

  let mismatches = 0;
  let firstBad = "";
  let transparentInOfficial = 0;
  let unpaintedInOurs = 0;

  for (let p = 0; p < r.area; p++) {
    const oa = png.data[p * 4 + 3];
    const ua = ours[p * 4 + 3];
    if (oa === 0) transparentInOfficial++;
    if (r.color[p] === UNPAINTED) unpaintedInOurs++;

    // Fully transparent pixels have undefined RGB; only alpha must agree.
    const same =
      oa === 0 || ua === 0
        ? oa === ua
        : png.data[p * 4] === ours[p * 4] &&
          png.data[p * 4 + 1] === ours[p * 4 + 1] &&
          png.data[p * 4 + 2] === ours[p * 4 + 2] &&
          oa === ua;

    if (!same) {
      mismatches++;
      if (!firstBad) {
        const x = p % r.size;
        const y = Math.floor(p / r.size);
        firstBad =
          `first at (${x},${y}) official rgba=` +
          `${png.data[p * 4]},${png.data[p * 4 + 1]},${png.data[p * 4 + 2]},${oa} ` +
          `ours=${ours[p * 4]},${ours[p * 4 + 1]},${ours[p * 4 + 2]},${ua} ` +
          `depth=${r.depth[p]} colorIdx=${r.color[p]}`;
      }
    }
  }

  const badStats = checkGroundTruth(day, canvasStats(r, canvas) as unknown as Record<string, unknown>);

  const pct = ((100 * mismatches) / r.area).toFixed(4);
  return {
    day,
    size: canvas.size,
    ok: mismatches === 0 && badStats.length === 0,
    mismatches,
    note:
      `${strokes.length} strokes, ${r.totalPlaced.toLocaleString()} px placed, ` +
      `${r.artists.length} artists, transparent official/ours ` +
      `${transparentInOfficial}/${unpaintedInOurs}` +
      (canvas.filledFromTheme ? ", indexer gaps filled from the theme API and confirmed by the PNG" : "") +
      (GROUND_TRUTH[day] && !badStats.length ? ", headline stats match" : "") +
      (mismatches ? ` — ${pct}% differ, ${firstBad}` : "") +
      (badStats.length ? ` — stats drift: ${badStats.join("; ")}` : ""),
  };
}

async function main() {
  const args = process.argv.slice(2).map(Number).filter(Boolean);
  // A spread across the history: early 144px canvases, the 366 size change,
  // recent 256px ones, and three canvases the indexer has no size for (458,
  // 569, 1079) so the inferred-size rule is proven against the real PNGs.
  const days = args.length
    ? args
    : [1, 7, 100, 131, 364, 365, 366, 367, 458, 569, 700, 1000, 1079, 1080, 1088];

  console.log(`verifying ${days.length} canvases against basepaint.net\n`);

  let failed = 0;
  for (const day of days) {
    try {
      const res = await verifyDay(day);
      if (!res.ok) failed++;
      const mark = res.ok ? "PASS" : "FAIL";
      console.log(`  ${mark}  day ${String(day).padStart(4)} (${res.size}px)  ${res.note}`);
    } catch (err) {
      failed++;
      console.log(`  ERR   day ${String(day).padStart(4)}  ${(err as Error).message}`);
    }
  }

  console.log(
    `\n${days.length - failed}/${days.length} canvases reproduced exactly` +
      (failed ? " — replay is WRONG, do not build on it" : ""),
  );
  process.exit(failed ? 1 : 0);
}

main();
