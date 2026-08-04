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
import { type Replay, replay, scalePixels, toRGBA } from "../../../src/engine/replay";
import type { CanvasStats } from "../../../src/engine/stats";
import {
  WHOLE_CANVAS,
  type View,
  decodeView,
  encodeView,
  isAltered,
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

  const loadPalettes = useCallback(async () => {
    if (palettes) return palettes;
    const rows: [number, string, string][] = await (await fetch("/palettes.json")).json();
    const map = new Map(rows.map(([day, name, colours]) => [day, { name, colours }]));
    setPalettes(map);
    return map;
  }, [palettes]);

  const worn = view.paletteDay === null ? null : (palettes?.get(view.paletteDay) ?? null);

  /**
   * The canvas's own colours, or another day's stretched to fit. Indexed by
   * this canvas's own colour numbers either way, so nothing downstream changes.
   */
  const palette = useMemo(() => {
    if (!worn || ownPalette.length === 0) return ownPalette;
    return remapPalette(ownPalette.length, parsePalette(worn.colours));
  }, [ownPalette, worn]);

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
      if (!r) return;
      const q = encodeView(next, r.artists.length);
      window.history.replaceState(null, "", q ? `?${q}` : window.location.pathname);
    },
    [stopIntro, r],
  );

  /** The view the page was opened on, once the cast is known well enough to check it. */
  const opening = useMemo(
    () => (r ? decodeView(recipe, r.artists.length) : null),
    [r, recipe],
  );
  /**
   * Did a link put us here? That is "is the recipe non-empty", not "is the
   * paint altered" — a palette remix leaves every pixel where it was but is
   * still a specific thing someone was sent, so the intro must not animate
   * away from it.
   */
  const openedFromLink = useMemo(
    () => (opening !== null && r !== null ? encodeView(opening.view, r.artists.length) !== "" : false),
    [opening, r],
  );

  useEffect(() => {
    if (!opening) return;
    setStaleRecipe(opening.stale);
    if (openedFromLink) setView(opening.view);
  }, [opening, openedFromLink]);

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

  const layer = useMemo(() => (r ? renderView(r, view) : null), [r, view]);
  const cast = useMemo(() => (r && layer ? roster(r, layer) : []), [r, layer]);

  // Untouched pixels are palette colour 0 in the published artwork, but in any
  // altered view they should read as absent rather than as deliberate paint.
  const altered = isAltered(view);

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
      changeView({ ...view, paletteDay: days[Math.floor(Math.random() * days.length)] });
    } finally {
      setRemixing(false);
    }
  }, [loadPalettes, row.day, view, changeView]);

  // A link can arrive already wearing a palette, before anything is loaded.
  useEffect(() => {
    if (view.paletteDay !== null && !palettes) void loadPalettes();
  }, [view.paletteDay, palettes, loadPalettes]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setCopied(false),
    );
  }, []);

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
    const rgba = toRGBA(layer, palette, r.area, altered ? "transparent" : "background");

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
  }, [r, layer, palette, altered, view, row.day]);

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
            <span className="tabular">{row.visible.toLocaleString()}</span> survived.{" "}
            {row.artists - row.artistsVisible > 0 && (
              <>
                {row.artists - row.artistsVisible} of them finished with nothing visible at all.
              </>
            )}
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
              transparent={altered}
              dayStart={dayWindow(row.day).start}
            />
          )}
          <p className={styles.hint}>
            {r ? "Hover or tap the canvas to pull a core sample. Click again to pin it." : " "}
          </p>

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
            </div>
          )}

          {r && view.paletteDay !== null && (
            <p className={styles.remixed}>
              Repainted in the palette of{" "}
              <Link href={`/canvas/${view.paletteDay}`} className={styles.remixLink}>
                day {view.paletteDay}
                {worn && `, ${worn.name}`}
              </Link>
              . Same paint, same hands, {ownPalette.length} colours mapped onto{" "}
              {worn ? worn.colours.split(",").length : "?"}.
            </p>
          )}

          {r && (
            <p className={styles.actionNote}>
              {altered
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
