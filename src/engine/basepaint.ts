/**
 * Thin client for BasePaint's public GraphQL indexer.
 *
 * Docs: https://basepaint.xyz/ai.txt — the schema is introspectable and the
 * upstream source is github.com/BasePaint/basepaint-ponder.
 */

const ENDPOINT = "https://graphql.basepaint.xyz";

/** Canvas 1 opened at this unix time; each canvas is open for exactly 24h. */
export const DAY1_START = 1691599315;
export const DAY_SECONDS = 86400;

/**
 * The 24h window a canvas was open for.
 *
 * Anchored on the schedule rather than on the day's first and last stroke: a
 * canvas painted in one ten-minute burst still has 24 hours in which it could
 * have been painted, and "late in the day" should mean the same thing on every
 * canvas. Verified against day 1080, whose first stroke lands 76s after the
 * scheduled start.
 */
export function dayWindow(day: number): { start: number; end: number } {
  if (!Number.isInteger(day) || day < 1) {
    throw new RangeError(`dayWindow: day must be an integer >= 1, got ${day}`);
  }
  const start = DAY1_START + (day - 1) * DAY_SECONDS;
  return { start, end: start + DAY_SECONDS };
}

/**
 * A canvas can still be minted for 24h after painting closes, so its mint count
 * and earnings are not final until then.
 *
 * Measured 2026-08-03: days 1085–1089, all past this cutoff, had not moved
 * since the previous ingest, while day 1090 was inside its sale window sitting
 * at 35 mints against a median of ~70 for its neighbours.
 */
export function mintWindowEnd(day: number): number {
  return dayWindow(day).end + DAY_SECONDS;
}

export function mintWindowOpen(day: number, now = Date.now() / 1000): boolean {
  return now < mintWindowEnd(day);
}

export interface Stroke {
  id: string;
  accountId: string;
  /** hex blob, 6 chars per pixel: XX YY CC (x, y, palette index) */
  data: string;
  pixels: number;
  timestamp: string;
}

/** The last canvas painted on the original 144x144 grid. */
export const LAST_144_DAY = 365;

/**
 * Canvas size for a day.
 *
 * The indexer is missing `size` on 81 scattered canvases between days 458 and
 * 1079, so it has to be filled in. Every one of the 1,010 canvases that does
 * report a size follows this rule exactly — 144 through day 365, 256 after —
 * and `npm run verify` proves it per canvas by comparing against the official
 * PNG's dimensions.
 */
export function canvasSize(day: number): number {
  return day <= LAST_144_DAY ? 144 : 256;
}

export interface CanvasMeta {
  id: number;
  size: number;
  name: string;
  /** comma-separated hex colours, e.g. "#DDCF99,#CCA87B,..." — null if unknown */
  palette: string | null;
  /**
   * The indexer had no name, size or palette for this canvas, so they came
   * from the theme API instead. True for 81 canvases between days 458 and 1079.
   */
  filledFromTheme: boolean;
  proposer: string | null;
  pixelsCount: number;
  totalArtists: number;
  totalMints: number;
  totalEarned: string;
}

async function query<T>(gql: string, attempts = 3): Promise<T> {
  let lastError: unknown;

  // The index walks ~1,090 canvases in one run, so a single blip must not lose
  // the whole pass. GraphQL-level errors are deterministic and not retried.
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: gql }),
      });
      if (!res.ok) throw new Error(`graphql ${res.status} ${res.statusText}`);
      const body = (await res.json()) as { data?: T; errors?: unknown };
      if (body.errors) throw new Error(`graphql errors: ${JSON.stringify(body.errors)}`);
      if (!body.data) throw new Error("graphql returned no data");
      return body.data;
    } catch (err) {
      lastError = err;
      if (String(err).includes("graphql errors")) break;
      if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The theme BasePaint's own site serves for a day — the gap-filler. */
interface Theme {
  theme: string;
  proposer: string | null;
  size: number;
  palette: string[];
}

/**
 * Retried like the GraphQL query: an ingest asks for 81 themes in one pass and
 * the endpoint intermittently refuses a couple under concurrency. Without this
 * a whole run is thrown away over two transient failures.
 */
async function fetchTheme(day: number, attempts = 4): Promise<Theme> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`https://basepaint.xyz/api/theme/${day}`, {
        headers: { "user-agent": "curl/8.5.0" },
      });
      if (!res.ok) throw new Error(`theme ${res.status} ${res.statusText}`);
      return (await res.json()) as Theme;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`day ${day}: theme lookup failed after ${attempts} attempts: ${lastError}`);
}

type RawCanvas = Omit<CanvasMeta, "filledFromTheme"> & { size: number | null; name: string | null };

export async function fetchCanvas(day: number): Promise<CanvasMeta> {
  const d = await query<{ canvas: RawCanvas | null }>(`{
    canvas(id: ${day}) {
      id size name palette proposer
      pixelsCount totalArtists totalMints totalEarned
    }
  }`);
  const raw = d.canvas;
  if (!raw) throw new Error(`no canvas for day ${day}`);

  if (raw.size !== null && raw.name !== null && raw.palette !== null) {
    return { ...raw, size: raw.size, name: raw.name, filledFromTheme: false };
  }

  // 81 canvases are missing all three in the indexer. The site's own theme
  // endpoint still has them. A failure here throws rather than fabricating a
  // name and guessing the size: a made-up row cached under the canvas's number
  // is worse than a canvas the next run retries.
  const theme = await fetchTheme(day);
  const size = raw.size ?? theme.size;

  // The era rule is a cross-check on the theme API, not a substitute for it.
  if (size !== canvasSize(day)) {
    throw new Error(
      `day ${day}: size ${size} contradicts the era rule (${canvasSize(day)}) — check LAST_144_DAY`,
    );
  }

  return {
    ...raw,
    size,
    name: raw.name ?? theme.theme,
    palette: raw.palette ?? theme.palette.join(","),
    proposer: raw.proposer ?? theme.proposer,
    filledFromTheme: true,
  };
}

/** All strokes for a day, oldest first. Paginates; some canvases exceed 1000. */
export async function fetchStrokes(day: number): Promise<Stroke[]> {
  const out: Stroke[] = [];
  let after: string | null = null;

  for (;;) {
    const cursor: string = after ? `, after: "${after}"` : "";
    const page = await query<{
      strokes: { items: Stroke[]; pageInfo: { hasNextPage: boolean; endCursor: string } };
    }>(`{
      strokes(where: { canvasId: ${day} }, limit: 1000${cursor}) {
        items { id accountId data pixels timestamp }
        pageInfo { hasNextPage endCursor }
      }
    }`);

    out.push(...page.strokes.items);
    if (!page.strokes.pageInfo.hasNextPage) break;
    after = page.strokes.pageInfo.endCursor;
  }

  // Stroke ids encode block + log index, so ascending id is chronological.
  // They exceed 2^53, so compare as BigInt rather than Number.
  out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  return out;
}

/** "#DDCF99,#CCA87B,..." -> [[221,207,153], ...] */
export function parsePalette(palette: string): [number, number, number][] {
  const colours = palette
    .split(",")
    .map((s) => s.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((h) => {
      // Silently producing NaN here would render as a black canvas and look
      // like a replay bug, so a malformed palette fails loudly instead.
      if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`palette: bad colour "${h}"`);
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ] as [number, number, number];
    });

  if (colours.length === 0) throw new Error("palette: no colours");
  return colours;
}
