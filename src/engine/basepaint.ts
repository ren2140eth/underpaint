/**
 * Thin client for BasePaint's public GraphQL indexer.
 *
 * Docs: https://basepaint.xyz/ai.txt — the schema is introspectable and the
 * upstream source is github.com/BasePaint/basepaint-ponder.
 */

const ENDPOINT = "https://graphql.basepaint.xyz";

export interface Stroke {
  id: string;
  accountId: string;
  /** hex blob, 6 chars per pixel: XX YY CC (x, y, palette index) */
  data: string;
  pixels: number;
  timestamp: string;
}

export interface CanvasMeta {
  id: number;
  size: number;
  name: string;
  /** comma-separated hex colours, e.g. "#DDCF99,#CCA87B,..." */
  palette: string;
  proposer: string | null;
  pixelsCount: number;
  totalArtists: number;
  totalMints: number;
  totalEarned: string;
}

async function query<T>(gql: string): Promise<T> {
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
}

export async function fetchCanvas(day: number): Promise<CanvasMeta> {
  const d = await query<{ canvas: CanvasMeta | null }>(`{
    canvas(id: ${day}) {
      id size name palette proposer
      pixelsCount totalArtists totalMints totalEarned
    }
  }`);
  if (!d.canvas) throw new Error(`no canvas for day ${day}`);
  return d.canvas;
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
