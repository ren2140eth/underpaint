"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Stroke,
  dayWindow,
  fetchStrokes,
  parsePalette,
  remapPalette,
} from "../../../src/engine/basepaint";
import { type Paint, applyPaint, decodePaint, encodePaint } from "../../../src/engine/paint";
import { type Replay, replay, scalePixels, toRGBA } from "../../../src/engine/replay";
import type { CanvasStats } from "../../../src/engine/stats";
import {
  WHOLE_CANVAS,
  type View,
  decodeView,
  encodeView,
  isAltered,
  isComposed,
  renderView,
  roster,
} from "../../../src/engine/view";
import CanvasStage from "./CanvasStage";
import Panel from "./Panel";
import styles from "./xray.module.css";

interface Props {
  row: CanvasStats;
  prev: number | null;
  next: number | null;
}

/**
 * How much paint a link will carry, in hex characters — six per pixel in
 * BasePaint's own `XXYYCC` format, so about 1,300 pixels.
 *
 * Past that the painting stays on screen and in the export but drops out of the
 * URL, said plainly rather than silently truncating someone's work into a
 * different picture. A run-length format would fit several times more, since
 * brush strokes are contiguous; the raw blob is kept for now because it is
 * exactly the format the chain stores.
 */
const MAX_PAINT_CHARS = 8_000;

export default function XRay({ row, prev, next }: Props) {
  const [strokes, setStrokes] = useState<Stroke[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(WHOLE_CANVAS);
  /** Bumped by "try again". The fetch is an effect, so retrying means re-running it. */
  const [attempt, setAttempt] = useState(0);
  /** Set when a shared link named artists this canvas no longer has. */
  const [staleRecipe, setStaleRecipe] = useState(false);

  /**
   * The recipe the page was opened with, captured once. Reading it later would
   * pick up whatever the address bar has been rewritten to since.
   */
  const [recipe] = useState(() =>
    typeof window === "undefined" ? "" : window.location.search,
  );

  useEffect(() => {
    let live = true;
    setStrokes(null);
    setError(null);
    setView(WHOLE_CANVAS);

    fetchStrokes(row.day)
      .then((s) => live && setStrokes(s))
      .catch((e: Error) => live && setError(e.message));

    return () => {
      live = false;
    };
  }, [row.day, attempt]);

  const r: Replay | null = useMemo(
    () => (strokes ? replay(strokes, row.size) : null),
    [strokes, row.size],
  );

  const ownPalette = useMemo(
    () => (row.palette ? parsePalette(row.palette) : []),
    [row.palette],
  );

  /**
   * Every canvas's palette, fetched only when someone remixes or arrives on a
   * link that already names one. Putting all 1,090 into every page would cost
   * 43 KB gzipped on 1,090 pages for a control most visitors never touch.
   */
  const [palettes, setPalettes] = useState<Map<number, { name: string; colours: string }> | null>(
    null,
  );
  const [remixing, setRemixing] = useState(false);
  /** The palette index would not load, so a remix cannot be honoured. */
  const [paletteError, setPaletteError] = useState(false);
  /** A link named a palette day that has no canvas; the day it named. */
  const [unknownPalette, setUnknownPalette] = useState<number | null>(null);

  /**
   * Every failure here is a lie if it passes silently: without the index a
   * remix renders the canvas's *own* colours, which looks like a canvas that
   * happens to resemble itself rather than like something that went wrong. So
   * the shape is checked as well as the status, and both callers report.
   */
  const loadPalettes = useCallback(async () => {
    if (palettes) return palettes;

    const response = await fetch("/palettes.json");
    if (!response.ok) throw new Error(`palettes.json: HTTP ${response.status}`);

    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error("palettes.json: not a list");

    const map = new Map(
      (rows as [number, string, string][]).map(([day, name, colours]) => [
        day,
        { name, colours },
      ]),
    );
    setPalettes(map);
    return map;
  }, [palettes]);

  const worn = view.paletteDay === null ? null : (palettes?.get(view.paletteDay) ?? null);
  const brushWorn = view.brushDay === null ? null : (palettes?.get(view.brushDay) ?? null);

  /**
   * The canvas's own colours, or another day's stretched to fit. Indexed by
   * this canvas's own colour numbers either way, so nothing downstream changes.
   */
  const palette = useMemo(() => {
    if (!worn || ownPalette.length === 0) return ownPalette;
    return remapPalette(ownPalette.length, parsePalette(worn.colours));
  }, [ownPalette, worn]);

  /**
   * What the visitor's own coat is wearing. Falls back to the canvas's palette,
   * so a brush that has not been sent anywhere behaves exactly as before —
   * including following a remix that arrived by link rather than by button.
   */
  const brushPalette = useMemo(() => {
    if (!brushWorn || ownPalette.length === 0) return palette;
    return remapPalette(ownPalette.length, parsePalette(brushWorn.colours));
  }, [ownPalette, brushWorn, palette]);

  /**
   * On load the canvas assembles itself out of its own buried coats: start
   * several layers down and rise to the surface. It states the thesis before
   * any control is touched, and it ends on the real artwork, so nothing is
   * misrepresented. Skipped entirely for reduced-motion, and any interaction
   * cancels it.
   */
  const intro = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopIntro = useCallback(() => {
    if (intro.current === null) return;
    clearInterval(intro.current);
    intro.current = null;
  }, []);

  /**
   * Touching any control takes the canvas off the intro, and rewrites the
   * address bar so the view can be linked to. Replace rather than push: a
   * slider drag is one thought, not forty history entries.
   */
  const changeView = useCallback(
    (next: View) => {
      stopIntro();
      setView(next);
    },
    [stopIntro],
  );

  /** The view the page was opened on, once the cast is known well enough to check it. */
  const opening = useMemo(() => {
    if (!r) return null;
    const decoded = decodeView(recipe, r.artists.length);
    // A link asking the brush to wear this canvas's own palette is asking for
    // nothing: it renders identically, and carrying it would put a note on
    // screen about colours that are already the ones being used.
    if (decoded.view.brushDay !== row.day) return decoded;
    return { ...decoded, view: { ...decoded.view, brushDay: null } };
  }, [r, recipe, row.day]);
  /**
   * Did a link put us here? That is "is the recipe non-empty", not "is the
   * paint altered" — a palette remix leaves every pixel where it was but is
   * still a specific thing someone was sent, so the intro must not animate
   * away from it.
   */
  const openedFromLink = useMemo(() => {
    if (opening === null || r === null) return false;
    if (encodeView(opening.view, r.artists.length) !== "") return true;
    return (new URLSearchParams(recipe).get("d") ?? "") !== "";
  }, [opening, r, recipe]);

  useEffect(() => {
    if (!opening) return;
    setStaleRecipe(opening.stale);
    if (openedFromLink) setView(opening.view);
  }, [opening, openedFromLink]);

  // A link can carry a painting; it arrives with the canvas, not before it.
  useEffect(() => {
    if (!r) return;
    const blob = new URLSearchParams(recipe).get("d");
    if (blob) setPaint(decodePaint(blob, r.size));
  }, [r, recipe]);

  useEffect(() => {
    if (!r) return;
    // A link was sent to show a particular variation; animating away from it
    // would show the recipient something other than what was shared.
    if (openedFromLink) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const depth = Math.min(5, Math.max(0, row.maxDistinctDepth - 1));
    if (depth === 0) return;

    let coat = depth;
    setView({ ...WHOLE_CANVAS, peel: coat });
    intro.current = setInterval(() => {
      coat -= 1;
      setView({ ...WHOLE_CANVAS, peel: Math.max(0, coat) });
      if (coat <= 0) stopIntro();
    }, 150);

    return stopIntro;
  }, [r, openedFromLink, row.maxDistinctDepth, stopIntro]);

  /**
   * The visitor's own coat, over whatever variation they composed. It is not
   * part of the View: the View is the controls, and this is content.
   */
  const [paint, setPaint] = useState<Paint>(() => new Map());
  const [painting, setPainting] = useState(false);
  const [brush, setBrush] = useState(1);
  const [colour, setColour] = useState(0);
  /** Snapshots taken at the start of each drag, so undo is one stroke. */
  const [undoStack, setUndoStack] = useState<Paint[]>([]);

  const base = useMemo(() => (r ? renderView(r, view) : null), [r, view]);
  const layer = useMemo(
    () => (base && r ? applyPaint(base, paint, r.area) : base),
    [base, r, paint],
  );
  const cast = useMemo(() => (r && layer ? roster(r, layer) : []), [r, layer]);

  const addPaint = useCallback(
    (pixels: [number, number][]) => {
      if (!r) return;
      setPaint((prev) => {
        const next = new Map(prev);
        for (const [x, y] of pixels) next.set(y * r.size + x, colour);
        return next;
      });
    },
    [r, colour],
  );

  const beginStroke = useCallback(() => {
    setUndoStack((s) => [...s.slice(-19), paint]);
  }, [paint]);

  const undo = useCallback(() => {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      setPaint(s[s.length - 1]);
      return s.slice(0, -1);
    });
  }, []);

  const clearPaint = useCallback(() => {
    setUndoStack((s) => [...s.slice(-19), paint]);
    setPaint(new Map());
  }, [paint]);

  // Untouched pixels are palette colour 0 in the published artwork, but in any
  // altered view they should read as absent rather than as deliberate paint.
  const altered = isAltered(view);

  // What the page claims out loud, which is a wider question than how the
  // untouched pixels are drawn: a remix and the visitor's own coat both count.
  const composed = isComposed(view, paint.size);

  const paintBlob = useMemo(() => (r ? encodePaint(paint, r.size) : ""), [paint, r]);
  const paintShareable = paintBlob.length <= MAX_PAINT_CHARS;

  /**
   * The whole state as a query string. Both the address bar and the copied link
   * are built from this rather than from each other: the address bar is written
   * on a timer, so a link read back off it is whatever the page looked like a
   * moment ago — the slider just moved would not be in it.
   */
  const query = useMemo(() => {
    if (!r) return "";
    const parts = [encodeView(view, r.artists.length)];
    if (paintBlob && paintShareable) parts.push(`d=${paintBlob}`);
    return parts.filter(Boolean).join("&");
  }, [r, view, paintBlob, paintShareable]);

  /**
   * The address bar follows the whole state, written once things have settled
   * rather than on every dab — a drag is thousands of events and re-encoding a
   * painting on each one would be the slowest thing on the page. Skipped while
   * the intro is animating, which would otherwise flicker a peel through it.
   */
  useEffect(() => {
    if (!r || intro.current !== null) return;
    const timer = setTimeout(() => {
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    }, 250);
    return () => clearTimeout(timer);
  }, [r, query]);

  const [copied, setCopied] = useState(false);

  /**
   * A random other canvas's palette. The roll happens here and the result is a
   * fixed day in the URL — a link that re-rolled on open would not be a recipe.
   */
  const remix = useCallback(async () => {
    setRemixing(true);
    try {
      const map = await loadPalettes();
      const days = [...map.keys()].filter((d) => d !== row.day && d !== view.paletteDay);
      if (days.length === 0) return;
      setPaletteError(false);
      // The roll lands on the canvas and the brush together: a remix recolours
      // the visitor's coat along with everyone else's, as it always has.
      const rolled = days[Math.floor(Math.random() * days.length)];
      changeView({ ...view, paletteDay: rolled, brushDay: rolled });
    } catch {
      setPaletteError(true);
    } finally {
      setRemixing(false);
    }
  }, [loadPalettes, row.day, view, changeView]);

  // A link can arrive already wearing a palette — on the canvas, on the brush,
  // or on both — before anything is loaded.
  useEffect(() => {
    if ((view.paletteDay === null && view.brushDay === null) || palettes) return;
    let live = true;
    loadPalettes().then(
      () => live && setPaletteError(false),
      () => live && setPaletteError(true),
    );
    return () => {
      live = false;
    };
  }, [view.paletteDay, view.brushDay, palettes, loadPalettes]);

  /**
   * A recipe is a string a stranger typed, and `decodeView` deliberately leaves
   * "is this a real day" to whoever holds the index. This is that check: a day
   * with no canvas is dropped once the index is in hand, because keeping it
   * would caption the canvas's own colours as another day's and link to a page
   * that does not exist.
   */
  useEffect(() => {
    if (!palettes) return;
    const missing = (d: number | null) => d !== null && !palettes.has(d);
    if (!missing(view.paletteDay) && !missing(view.brushDay)) return;

    setUnknownPalette(missing(view.paletteDay) ? view.paletteDay : view.brushDay);
    setView((v) => ({
      ...v,
      paletteDay: missing(v.paletteDay) ? null : v.paletteDay,
      brushDay: missing(v.brushDay) ? null : v.brushDay,
    }));
  }, [view.paletteDay, view.brushDay, palettes]);

  const copyLink = useCallback(() => {
    const { origin, pathname } = window.location;
    navigator.clipboard.writeText(`${origin}${pathname}${query ? `?${query}` : ""}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  }, [query]);

  /**
   * The variation as a PNG, rebuilt at an integer scale rather than by
   * stretching what is on screen — a browser resampling pixel art blurs it.
   * The filename carries the recipe, so a downloaded image can be traced back
   * to the link that made it.
   */
  const download = useCallback(() => {
    if (!r || !layer) return;

    const scale = Math.max(1, Math.round(1024 / r.size));
    const wide = r.size * scale;
    const rgba = toRGBA(
      layer,
      palette,
      r.area,
      altered ? "transparent" : "background",
      brushPalette,
    );

    const canvas = document.createElement("canvas");
    canvas.width = wide;
    canvas.height = wide;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(scalePixels(rgba, r.size, scale)), wide, wide),
      0,
      0,
    );

    const q = encodeView(view, r.artists.length);
    const name = `underpaint-day-${row.day}${q ? `-${q.replace(/&/g, "_")}` : ""}.png`;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      // Revoking in the same tick races the browser's own read of the blob.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, "image/png");
  }, [r, layer, palette, brushPalette, altered, view, row.day]);

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.identity}>
          <p className="label">
            Day {row.day}
            {row.filledFromTheme && " · metadata from theme API"}
          </p>
          <h1 className={styles.title}>{row.name}</h1>
        </div>

        <div className={styles.thesis}>
          <p className={styles.thesisNumber}>
            <span className="readout">{Math.round(100 * row.buriedShare)}%</span>
            <span className="label">of this canvas is buried</span>
          </p>
          <p className={styles.thesisBody}>
            {row.artists.toLocaleString()} artists placed{" "}
            <span className="tabular">{row.distinctPlaced.toLocaleString()}</span> pixels here.{" "}
            <span className="tabular">{row.visible.toLocaleString()}</span> of them are in the
            finished artwork; the rest are under later coats.
          </p>
        </div>

        <nav className={styles.dayNav}>
          {prev ? (
            <Link href={`/canvas/${prev}`} className={styles.dayLink}>
              ← {prev}
            </Link>
          ) : (
            <span className={styles.dayLinkOff}>←</span>
          )}
          <a
            href={`https://basepaint.xyz/canvas/${row.day}`}
            className={styles.dayLink}
            title="This canvas on BasePaint"
          >
            on basepaint ↗
          </a>
          {next ? (
            <Link href={`/canvas/${next}`} className={styles.dayLink}>
              {next} →
            </Link>
          ) : (
            <span className={styles.dayLinkOff}>→</span>
          )}
        </nav>
      </header>

      <div className={styles.instrument}>
        <div className={styles.stageColumn}>
          {error && (
            <div className={styles.state}>
              <p className={styles.stateTitle}>Couldn't load this canvas</p>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className={styles.retry}
              >
                Try again
              </button>
            </div>
          )}
          {!error && !r && (
            <div className={styles.state}>
              <p className={styles.stateTitle}>Replaying day {row.day}</p>
              <p>
                Fetching every stroke, then replaying{" "}
                <span className="tabular">{row.placed.toLocaleString()}</span> pixel placements.
              </p>
            </div>
          )}
          {r && layer && (
            <CanvasStage
              replay={r}
              layer={layer}
              palette={palette}
              brushPalette={brushPalette}
              transparent={altered}
              dayStart={dayWindow(row.day).start}
              painting={painting}
              brush={brush}
              onStrokeStart={beginStroke}
              onPaint={addPaint}
            />
          )}
          <p className={styles.hint}>
            {!r
              ? " "
              : painting
                ? "Drag on the canvas to paint, or move the brush with the arrow keys and press Enter to put the pen down. Your coat sits on top of whatever you have composed."
                : "Hover or tap the canvas to pull a core sample. Click again to pin it."}
          </p>

          {r && painting && (
            <div className={styles.studio}>
              <div
                className={styles.swatches}
                role="group"
                aria-label={
                  view.brushDay === null ? "Colour" : `Colour, from day ${view.brushDay}'s palette`
                }
              >
                {brushPalette.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Colour ${i + 1} of ${brushPalette.length}`}
                    aria-pressed={colour === i}
                    className={colour === i ? styles.swatchOn : styles.swatch}
                    style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
                    onClick={() => setColour(i)}
                  />
                ))}
              </div>

              <div className={styles.studioRow}>
                {[1, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={brush === n}
                    className={brush === n ? styles.presetOn : styles.preset}
                    onClick={() => setBrush(n)}
                  >
                    {n}px
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.preset}
                  disabled={undoStack.length === 0}
                  onClick={undo}
                >
                  Undo
                </button>
                <button
                  type="button"
                  className={styles.preset}
                  disabled={paint.size === 0}
                  onClick={clearPaint}
                >
                  Clear
                </button>
                {/* Without this a remix would be one-way: the canvas can be put
                    back into its own colours, and the brush needs the same. */}
                {view.brushDay !== null && (
                  <button
                    type="button"
                    className={styles.preset}
                    onClick={() => changeView({ ...view, brushDay: null })}
                  >
                    Brush: own colours
                  </button>
                )}
              </div>
            </div>
          )}

          {r && (
            <div className={styles.actions}>
              <button type="button" className={styles.action} onClick={copyLink}>
                {copied ? "link copied" : "copy link"}
              </button>
              <button type="button" className={styles.action} onClick={download}>
                download png
              </button>
              <button
                type="button"
                className={styles.action}
                onClick={remix}
                disabled={remixing}
              >
                {remixing ? "remixing…" : "remix palette"}
              </button>
              {view.paletteDay !== null && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => changeView({ ...view, paletteDay: null })}
                >
                  own colours
                </button>
              )}
              <button
                type="button"
                aria-pressed={painting}
                className={painting ? styles.actionOn : styles.action}
                onClick={() => setPainting((p) => !p)}
              >
                {painting ? "done painting" : "paint"}
              </button>
            </div>
          )}

          {r && paint.size > 0 && (
            <p className={styles.yours}>
              Your coat: <span className="tabular">{paint.size.toLocaleString()}</span> pixels,{" "}
              {((100 * paint.size) / r.area).toFixed(1)}% of the canvas.
              {!paintShareable &&
                " Past what a link can carry — the canvas and the download keep every pixel, the URL does not. Undo a stroke or switch to a thinner brush to make it shareable."}
            </p>
          )}

          {/* Only once the palette is in hand: until then the canvas is still
              showing its own colours, and a caption saying otherwise would be
              describing an image that is not on screen yet. */}
          {r && view.paletteDay !== null && worn && (
            <p className={styles.remixed}>
              Repainted in the palette of{" "}
              <Link href={`/canvas/${view.paletteDay}`} className={styles.remixLink}>
                day {view.paletteDay}, {worn.name}
              </Link>
              . Same paint, same hands, {ownPalette.length} colours mapped onto{" "}
              {worn.colours.split(",").length}.
            </p>
          )}

          {/* Only worth saying when the brush has gone its own way — while the
              two agree, the remix caption above has already said it. */}
          {r && view.brushDay !== null && view.brushDay !== view.paletteDay && brushWorn && (
            <p className={styles.remixed}>
              Painting in the colours of{" "}
              <Link href={`/canvas/${view.brushDay}`} className={styles.remixLink}>
                day {view.brushDay}, {brushWorn.name}
              </Link>
              . The canvas keeps its own; your coat does not.
            </p>
          )}

          {r && paletteError && (
            <p className={styles.stale}>
              The list of palettes didn't load, so this canvas is still in its own colours. The
              strokes are unaffected — everything else on this page is what it says it is.
            </p>
          )}

          {r && unknownPalette !== null && (
            <p className={styles.stale}>
              That link asked for the palette of day {unknownPalette}, and there is no such
              canvas. The colours here are this canvas's own.
            </p>
          )}

          {r && (
            <p className={styles.actionNote}>
              {composed
                ? "The link is a recipe: it names the controls, and the canvas is replayed from the strokes."
                : "The canvas as it was minted."}
            </p>
          )}

          {staleRecipe && (
            <p className={styles.stale}>
              That link named artists by their place in this canvas's stroke order, and the
              order has changed since. Time and peel were kept; the artists were dropped rather
              than showing you the wrong ones.
            </p>
          )}
        </div>

        <Panel replay={r} row={row} view={view} setView={changeView} roster={cast} />
      </div>
    </div>
  );
}
