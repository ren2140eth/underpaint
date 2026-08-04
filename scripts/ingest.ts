/**
 * Precompute the canvas index.
 *
 * Walks every completed canvas, replays it, and writes one row per canvas to
 * `data/index.json` — the static file the index UI reads. No backend.
 *
 *   npm run ingest                      # all completed canvases, resuming from cache
 *   npm run ingest -- --refresh         # ignore the cache and refetch
 *   npm run ingest -- --to 400 --out /tmp/partial.json   # a slice, elsewhere
 *   npm run ingest -- --cache-strokes   # keep raw strokes for metric iteration
 *
 * What is cached and what is not
 * ------------------------------
 * Only the replay half is cached, under `.cache/canvas/` keyed by
 * STATS_VERSION. Mint counts and earnings keep moving for 24h after painting
 * closes, so canvas metadata is refetched on every run and never cached —
 * otherwise a canvas ingested during its sale would keep its partial economics
 * forever, and it would top "most overlooked" for being half-sold rather than
 * overlooked. Rows still inside their sale window are marked `mintWindowOpen`
 * and left out of the effort-per-mint ranking.
 *
 * Protecting the committed index
 * ------------------------------
 * `data/index.json` is only replaced by a complete, fully successful run. A
 * partial range needs an explicit `--out`, failures abort the write, and the
 * file is rewritten only when something actually changed, so a no-op rerun
 * leaves the working tree clean.
 */

import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { DAY1_START, DAY_SECONDS, type Stroke, fetchCanvas, fetchStrokes } from "../src/engine/basepaint.js";
import { replay } from "../src/engine/replay.js";
import { type CanvasStats, type ReplayStats, canvasStats, replayStats } from "../src/engine/stats.js";

/** Bump when a replay-derived metric changes, to invalidate cached rows. */
const STATS_VERSION = 4;

const ROW_CACHE = ".cache/canvas";
const STROKE_CACHE = "data/strokes";
const OUT = "data/index.json";

interface Options {
  from: number;
  to: number | null;
  refresh: boolean;
  cacheStrokes: boolean;
  concurrency: number;
  out: string | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    from: 1,
    to: null,
    refresh: false,
    cacheStrokes: false,
    concurrency: 6,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const num = () => {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new Error(`${arg} needs a positive integer`);
      return v;
    };
    if (arg === "--from") opts.from = num();
    else if (arg === "--to") opts.to = num();
    else if (arg === "--concurrency") opts.concurrency = num();
    else if (arg === "--refresh") opts.refresh = true;
    else if (arg === "--cache-strokes") opts.cacheStrokes = true;
    else if (arg === "--out") opts.out = argv[++i];
    else throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

/**
 * The last canvas that has finished. Today's canvas is still being painted, so
 * including it would bake a half-finished row into the index.
 */
function lastCompletedDay(now = Date.now() / 1000): number {
  return Math.floor((now - DAY1_START) / DAY_SECONDS);
}

const pad = (day: number) => String(day).padStart(4, "0");

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function strokesFor(day: number, opts: Options): Promise<Stroke[]> {
  const path = `${STROKE_CACHE}/${pad(day)}.json.gz`;
  if (opts.cacheStrokes && !opts.refresh) {
    try {
      return JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as Stroke[];
    } catch {
      // not cached yet
    }
  }

  const strokes = await fetchStrokes(day);
  if (opts.cacheStrokes) {
    await mkdir(STROKE_CACHE, { recursive: true });
    await writeFile(path, gzipSync(Buffer.from(JSON.stringify(strokes))));
  }
  return strokes;
}

interface CachedRow {
  version: number;
  row: ReplayStats;
}

/**
 * Metadata is always refetched; only the replay half comes from cache. The
 * canvas size is needed to replay at all, so a cache hit still costs one small
 * query — but not the stroke pagination, which is the expensive part.
 */
async function rowFor(day: number, opts: Options): Promise<CanvasStats> {
  const path = `${ROW_CACHE}/${pad(day)}.json`;
  const meta = await fetchCanvas(day);

  if (!opts.refresh) {
    const cached = await readJson<CachedRow>(path);
    if (cached?.version === STATS_VERSION) return canvasStats(cached.row, meta);
  }

  const strokes = await strokesFor(day, opts);
  const stats = replayStats(replay(strokes, meta.size), day);

  await mkdir(ROW_CACHE, { recursive: true });
  await writeFile(path, JSON.stringify({ version: STATS_VERSION, row: stats }));
  return canvasStats(stats, meta);
}

/** Run `work` over `days` with a fixed number of requests in flight. */
async function pool<T>(days: number[], limit: number, work: (day: number) => Promise<T>) {
  const results = new Map<number, T>();
  const failures: { day: number; error: string }[] = [];
  let next = 0;
  let done = 0;

  const runner = async () => {
    for (;;) {
      const i = next++;
      if (i >= days.length) return;
      const day = days[i];
      try {
        results.set(day, await work(day));
      } catch (err) {
        failures.push({ day, error: (err as Error).message });
      }
      done++;
      if (done % 50 === 0 || done === days.length) {
        process.stdout.write(`  ${done}/${days.length} canvases\n`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, days.length) }, runner));
  return { results, failures };
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function spread(label: string, values: number[], fmt: (x: number) => string) {
  const s = [...values].sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(16)} min ${fmt(s[0])}  p25 ${fmt(quantile(s, 0.25))}  ` +
      `median ${fmt(quantile(s, 0.5))}  p75 ${fmt(quantile(s, 0.75))}  max ${fmt(s[s.length - 1])}`,
  );
}

function sanityPass(rows: CanvasStats[]) {
  const placed = rows.reduce((n, r) => n + r.placed, 0);
  const distinct = rows.reduce((n, r) => n + r.distinctPlaced, 0);
  const visible = rows.reduce((n, r) => n + r.visible, 0);

  console.log(`\n${rows.length} canvases, days ${rows[0].day}–${rows[rows.length - 1].day}`);
  console.log(
    `  ${placed.toLocaleString()} placements, ${(placed - distinct).toLocaleString()} of them repeats ` +
      `inside a single stroke, leaving ${distinct.toLocaleString()} that put paint somewhere`,
  );
  console.log(
    `  ${visible.toLocaleString()} survived — ` +
      `${pct((distinct - visible) / distinct)} of all painting in BasePaint history is buried\n`,
  );

  spread("buried share", rows.map((r) => r.buriedShare), pct);
  spread("coverage", rows.map((r) => r.coverage), pct);
  spread("mean depth", rows.map((r) => r.meanDepth), (x) => x.toFixed(2));
  spread("max depth", rows.map((r) => r.maxDepth), (x) => String(x));
  spread("artists", rows.map((r) => r.artists), (x) => String(Math.round(x)));
  spread("visible artists", rows.map((r) => r.artistsVisible), (x) => String(Math.round(x)));
  spread("top-artist share", rows.map((r) => r.topShare), pct);
  spread("late surge", rows.map((r) => r.lateSurge), pct);
  spread("mints", rows.map((r) => r.mints), (x) => String(Math.round(x)));
  spread("off-grid px", rows.map((r) => r.offGrid), (x) => String(Math.round(x)));
  spread("self-overlap px", rows.map((r) => r.selfOverlap), (x) => String(Math.round(x)));
  spread("max distinct depth", rows.map((r) => r.maxDistinctDepth), (x) => String(Math.round(x)));

  const top = (label: string, key: (r: CanvasStats) => number, fmt: (x: number) => string) => {
    console.log(`\n  ${label}`);
    for (const r of [...rows].sort((a, b) => key(b) - key(a)).slice(0, 5)) {
      console.log(`    day ${String(r.day).padStart(4)}  ${fmt(key(r))}  ${r.name}`);
    }
  };
  top("most buried labour", (r) => r.buriedShare, pct);
  // Canvases still on sale are excluded: a half-sold canvas is not overlooked.
  const settled = rows.filter((r) => !r.mintWindowOpen);
  console.log(`\n  most overlooked (pixels per mint, ${rows.length - settled.length} still on sale excluded)`);
  for (const r of [...settled].sort((a, b) => (b.effortPerMint ?? 0) - (a.effortPerMint ?? 0)).slice(0, 5)) {
    console.log(`    day ${String(r.day).padStart(4)}  ${Math.round(r.effortPerMint ?? 0).toLocaleString()}  ${r.name}`);
  }
  top("most concentrated (HHI)", (r) => r.hhi, (x) => x.toFixed(3));
  top("most within-stroke repetition", (r) => r.selfOverlap, (x) => Math.round(x).toLocaleString());

  const offGrid = rows.filter((r) => r.offGrid > 0);
  const impossible = rows.filter((r) => r.offGrid < 0);
  const outside = rows.filter((r) => r.strokesOutsideWindow > 0);
  const unminted = rows.filter((r) => r.mints === 0);
  const offGridTotal = rows.reduce((n, r) => n + Math.max(0, r.offGrid), 0);
  const lastOffGrid = offGrid.length ? offGrid[offGrid.length - 1].day : null;

  console.log(`\n  data quality`);
  console.log(
    `    off-grid pixels: ${offGridTotal.toLocaleString()} across ${offGrid.length} canvases` +
      (lastOffGrid ? `, last on day ${lastOffGrid}` : ""),
  );
  // placed > submitted would mean we invented paint, which the PNG proof rules
  // out — but it is worth failing loudly rather than assuming.
  if (impossible.length) {
    console.log(`    IMPOSSIBLE: replayed more than was submitted on days ${impossible.map((r) => r.day).join(", ")}`);
  }
  console.log(
    `    strokes outside the scheduled 24h window: ${outside.length} canvases` +
      (outside.length ? ` — days ${outside.map((r) => r.day).join(", ")}` : ""),
  );
  console.log(`    unminted canvases (no effort-per-mint): ${unminted.length}`);
  const unaccounted = rows.filter((r) => r.unaccounted !== 0);
  const malformed = rows.filter((r) => r.malformed > 0);
  console.log(
    `    submitted pixels the decode cannot account for: ${unaccounted.length} canvases` +
      (unaccounted.length ? ` — days ${unaccounted.map((r) => `${r.day} (${r.unaccounted})`).join(", ")}` : ""),
  );
  console.log(
    `    malformed triplets: ${malformed.length} canvases` +
      (malformed.length ? ` — days ${malformed.map((r) => `${r.day} (${r.malformed})`).join(", ")}` : ""),
  );
  console.log(`    still inside their 24h sale window: ${rows.filter((r) => r.mintWindowOpen).length}`);
  console.log(
    `    indexer gaps filled from the theme API: ${rows.filter((r) => r.filledFromTheme).length} canvases`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const last = opts.to ?? lastCompletedDay();
  const days = [];
  for (let day = opts.from; day <= last; day++) days.push(day);

  console.log(
    `ingesting canvases ${opts.from}–${last} (${days.length}), ` +
      `concurrency ${opts.concurrency}${opts.refresh ? ", ignoring cache" : ""}\n`,
  );

  const started = Date.now();
  const { results, failures } = await pool(days, opts.concurrency, (day) => rowFor(day, opts));
  const rows = days.filter((d) => results.has(d)).map((d) => results.get(d)!);

  if (failures.length) {
    console.log(`\n${failures.length} canvases failed:`);
    for (const f of failures.slice(0, 20)) console.log(`  day ${f.day}: ${f.error}`);
    console.log("  rerun to retry — completed canvases are cached");
  }
  if (rows.length === 0) throw new Error("no canvases ingested");

  sanityPass(rows);

  const partial = opts.from !== 1 || opts.to !== null;
  const target = opts.out ?? OUT;

  // The committed index is the app's whole data layer, so it is only replaced
  // by a complete, fully successful run. Anything else needs its own --out.
  if (!opts.out && partial) {
    console.log(
      `\nrefusing to replace ${OUT} with days ${opts.from}–${last}: ` +
        "pass --out <path> to write a partial range somewhere else",
    );
    process.exit(1);
  }
  if (failures.length) {
    console.log(`\nrefusing to write ${target}: ${failures.length} canvases failed`);
    process.exit(1);
  }

  const body = { statsVersion: STATS_VERSION, fromDay: rows[0].day, toDay: last, count: rows.length, canvases: rows };
  const existing = await readJson<typeof body & { generatedAt: string }>(target);

  // Rewriting an identical file would only churn generatedAt and dirty the
  // working tree, which makes reruns look like changes in review.
  if (existing && JSON.stringify({ ...existing, generatedAt: undefined }) === JSON.stringify({ ...body, generatedAt: undefined })) {
    console.log(`\n${target} is already up to date (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    return;
  }

  await mkdir("data", { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify({ generatedAt: new Date().toISOString(), ...body }, null, 1));
  await rename(tmp, target);

  console.log(`\nwrote ${target} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main();
