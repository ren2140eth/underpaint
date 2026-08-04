"use client";

import { useMemo, useState } from "react";
import { dayWindow } from "../../../src/engine/basepaint";
import type { Replay } from "../../../src/engine/replay";
import type { CanvasStats } from "../../../src/engine/stats";
import { WHOLE_CANVAS, type RosterEntry, type View } from "../../../src/engine/view";
import styles from "./xray.module.css";

interface Props {
  replay: Replay | null;
  row: CanvasStats;
  view: View;
  setView: (v: View) => void;
  roster: RosterEntry[];
}

/**
 * How many artists the list shows before you ask for more. Canvases run to 870
 * participants; rendering them all on every slider tick is wasted work, and a
 * wall of addresses is not a control. Search and "show all" reach the rest.
 */
const SHOWN = 30;

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

export default function Panel({ replay, row, view, setView, roster }: Props) {
  const { start } = useMemo(() => dayWindow(row.day), [row.day]);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [buriedOnly, setBuriedOnly] = useState(false);

  // Coats, not paint events: `maxDepth` counts a brush dragged over its own
  // path, which runs into the thousands and makes the slider unusable.
  const maxPeel = Math.max(0, row.maxDistinctDepth - 1);

  const patch = (next: Partial<View>) => setView({ ...view, ...next });

  const hour = view.until === null ? 24 : Math.round((view.until - start) / 3600);
  const disabled = !replay;

  const toggleMute = (artist: number) => {
    const muted = new Set(view.muted);
    if (muted.has(artist)) muted.delete(artist);
    else muted.add(artist);
    patch({ muted, solo: null });
  };

  const visibleNow = useMemo(() => roster.filter((e) => e.visible > 0).length, [roster]);
  const buried = roster.length - visibleNow;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let matches = roster;
    if (needle) matches = matches.filter((e) => e.artist.toLowerCase().includes(needle));
    if (buriedOnly) matches = matches.filter((e) => e.visible === 0);

    const keep = new Set(
      (showAll || needle ? matches : matches.slice(0, SHOWN)).map((e) => e.index),
    );

    // An artist you have soloed or muted keeps their row whatever the filters
    // say. Muting removes their paint, so deriving this list from what is
    // rendered would delete the only button that undoes the mute.
    for (const e of roster) {
      if (e.index === view.solo || view.muted.has(e.index)) keep.add(e.index);
    }

    return { rows: roster.filter((e) => keep.has(e.index)), total: matches.length };
  }, [roster, query, showAll, buriedOnly, view.solo, view.muted]);

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
          Underpainting promotes the coat directly beneath the surface. A coat is a run of paint
          in one colour from one hand, so repainting the same pixel does not count twice. Pixels
          painted only once fall away — nothing was buried there.
        </p>
      </section>

      <section className={styles.control}>
        <div className={styles.controlHead}>
          <span className="label">Artists</span>
          <span className={styles.controlValue}>
            {visibleNow} of {roster.length} visible
          </span>
        </div>
        <p className={styles.controlNote}>
          Everyone who painted here, ranked by what they own right now. Solo an artist to see
          everything they painted, including work that got covered.
          {buried > 0 && ` ${buried} finished with nothing visible.`}
        </p>

        {roster.length > 0 && (
          <div className={styles.filters}>
            <input
              type="search"
              value={query}
              placeholder="Search address"
              aria-label="Search artists by address"
              className={styles.search}
              onChange={(e) => setQuery(e.target.value)}
            />
            {buried > 0 && (
              <button
                type="button"
                aria-pressed={buriedOnly}
                className={buriedOnly ? styles.presetOn : styles.preset}
                onClick={() => setBuriedOnly((b) => !b)}
              >
                Buried only
              </button>
            )}
          </div>
        )}

        <ol className={styles.split}>
          {shown.rows.map((entry) => {
            const soloed = view.solo === entry.index;
            const muted = view.muted.has(entry.index);
            return (
              <li key={entry.index} className={styles.splitRow}>
                <button
                  type="button"
                  className={soloed ? styles.splitNameOn : styles.splitName}
                  aria-pressed={soloed}
                  title={`${entry.artist} — painted ${entry.everPainted.toLocaleString()} pixels, ${entry.visible.toLocaleString()} visible in this view. Click to show only their paint.`}
                  onClick={() =>
                    patch({ solo: soloed ? null : entry.index, muted: new Set() })
                  }
                >
                  <span className={styles.splitBar} style={{ width: pct(entry.share) }} />
                  <span className={styles.splitLabel}>{shortAddress(entry.artist)}</span>
                  <span className={entry.visible === 0 ? styles.splitBuried : styles.splitShare}>
                    {entry.visible === 0 ? `${entry.everPainted} buried` : pct(entry.share)}
                  </span>
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

        {!showAll && !query.trim() && shown.total > SHOWN && (
          <button
            type="button"
            className={styles.preset}
            onClick={() => setShowAll(true)}
          >
            Show all {shown.total}
          </button>
        )}
        {shown.rows.length === 0 && !disabled && (
          <p className={styles.controlNote}>No artist here matches that address.</p>
        )}
      </section>
    </aside>
  );
}
