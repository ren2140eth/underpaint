"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Stroke, dayWindow, fetchStrokes, parsePalette } from "../../../src/engine/basepaint";
import { type Replay, replay } from "../../../src/engine/replay";
import type { CanvasStats } from "../../../src/engine/stats";
import { WHOLE_CANVAS, type View, renderView, roster } from "../../../src/engine/view";
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

  const palette = useMemo(
    () => (row.palette ? parsePalette(row.palette) : []),
    [row.palette],
  );

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

  /** Touching any control takes the canvas off the intro immediately. */
  const changeView = useCallback(
    (next: View) => {
      stopIntro();
      setView(next);
    },
    [stopIntro],
  );

  useEffect(() => {
    if (!r) return;
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
  }, [r, row.maxDistinctDepth, stopIntro]);

  const layer = useMemo(() => (r ? renderView(r, view) : null), [r, view]);
  const cast = useMemo(() => (r && layer ? roster(r, layer) : []), [r, layer]);

  // Untouched pixels are palette colour 0 in the published artwork, but in any
  // altered view they should read as absent rather than as deliberate paint.
  const altered =
    view.until !== null || view.peel > 0 || view.solo !== null || view.muted.size > 0;

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
        </div>

        <Panel replay={r} row={row} view={view} setView={changeView} roster={cast} />
      </div>
    </div>
  );
}
