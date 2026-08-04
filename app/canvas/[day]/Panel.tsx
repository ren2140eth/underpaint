"use client";

import { useMemo } from "react";
import { dayWindow } from "../../../src/engine/basepaint";
import type { Replay } from "../../../src/engine/replay";
import type { CanvasStats } from "../../../src/engine/stats";
import { WHOLE_CANVAS, type View } from "../../../src/engine/view";
import styles from "./xray.module.css";

interface Props {
  replay: Replay | null;
  row: CanvasStats;
  view: View;
  setView: (v: View) => void;
  split: { artist: string; index: number; pixels: number; share: number }[];
}

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export default function Panel({ replay, row, view, setView, split }: Props) {
  const { start, end } = useMemo(() => dayWindow(row.day), [row.day]);
  const maxPeel = Math.max(0, row.maxDepth - 1);

  const patch = (next: Partial<View>) => setView({ ...view, ...next });

  const hour = view.until === null ? 24 : Math.round((view.until - start) / 3600);
  const disabled = !replay;

  const toggleMute = (artist: number) => {
    const muted = new Set(view.muted);
    if (muted.has(artist)) muted.delete(artist);
    else muted.add(artist);
    patch({ muted, solo: null });
  };

  return (
    <aside className={styles.panel}>
      <section className={styles.control}>
        <div className={styles.controlHead}>
          <span className="label">Time</span>
          <span className={styles.controlValue}>
            {view.until === null ? "whole day" : `hour ${String(hour).padStart(2, "0")}`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={24}
          step={1}
          value={hour}
          disabled={disabled}
          aria-label="Hour of the day to show"
          onChange={(e) => {
            const h = Number(e.target.value);
            patch({ until: h >= 24 ? null : start + h * 3600 });
          }}
          className={styles.slider}
        />
        <p className={styles.controlNote}>
          The canvas as it stood partway through its 24 hours.
        </p>
      </section>

      <section className={styles.control}>
        <div className={styles.controlHead}>
          <span className="label">Peel</span>
          <span className={styles.controlValue}>
            {view.peel === 0 ? "surface" : `${view.peel} ${view.peel === 1 ? "coat" : "coats"} off`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={maxPeel}
          step={1}
          value={Math.min(view.peel, maxPeel)}
          disabled={disabled || maxPeel === 0}
          aria-label="Coats of paint to strip from every pixel"
          onChange={(e) => patch({ peel: Number(e.target.value) })}
          className={styles.slider}
        />
        <div className={styles.presets}>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={view.peel === 1}
            className={view.peel === 1 ? styles.presetOn : styles.preset}
            onClick={() => patch({ peel: view.peel === 1 ? 0 : 1 })}
          >
            Underpainting
          </button>
          <button
            type="button"
            disabled={disabled}
            className={styles.preset}
            onClick={() => setView(WHOLE_CANVAS)}
          >
            Reset
          </button>
        </div>
        <p className={styles.controlNote}>
          Underpainting promotes the coat directly beneath the surface. Pixels painted only
          once fall away — nothing was buried there.
        </p>
      </section>

      <section className={styles.control}>
        <div className={styles.controlHead}>
          <span className="label">Attribution</span>
          <span className={styles.controlValue}>
            {split.length} {split.length === 1 ? "artist" : "artists"} visible
          </span>
        </div>
        <p className={styles.controlNote}>
          Whose paint you are looking at right now. Change any control and the split changes.
          Solo an artist to see everything they painted, including work that got covered.
        </p>

        <ol className={styles.split}>
          {split.slice(0, 40).map((entry) => {
            const soloed = view.solo === entry.index;
            const muted = view.muted.has(entry.index);
            return (
              <li key={entry.index} className={styles.splitRow}>
                <button
                  type="button"
                  className={soloed ? styles.splitNameOn : styles.splitName}
                  aria-pressed={soloed}
                  title="Show only this artist's paint"
                  onClick={() =>
                    patch({ solo: soloed ? null : entry.index, muted: new Set() })
                  }
                >
                  <span className={styles.splitBar} style={{ width: pct(entry.share) }} />
                  <span className={styles.splitLabel}>{shortAddress(entry.artist)}</span>
                  <span className={styles.splitShare}>{pct(entry.share)}</span>
                </button>
                <button
                  type="button"
                  className={muted ? styles.muteOn : styles.mute}
                  aria-pressed={muted}
                  title="Hide this artist and reveal what was underneath"
                  onClick={() => toggleMute(entry.index)}
                >
                  {muted ? "muted" : "mute"}
                </button>
              </li>
            );
          })}
        </ol>

        {split.length > 40 && (
          <p className={styles.controlNote}>
            Showing the top 40 of {split.length}.
          </p>
        )}
        {split.length === 0 && !disabled && (
          <p className={styles.controlNote}>Nothing is visible in this variation.</p>
        )}
      </section>
    </aside>
  );
}
