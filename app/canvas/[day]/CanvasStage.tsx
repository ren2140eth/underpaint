"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Replay } from "../../../src/engine/replay";
import { coats, pixelHistory, toRGBA } from "../../../src/engine/replay";
import styles from "./xray.module.css";

interface Props {
  replay: Replay;
  layer: Layer;
  palette: [number, number, number][];
  /** untouched pixels read as absent in the x-ray, opaque in the final image */
  transparent: boolean;
  /** start of the canvas's 24h window, for elapsed-time readouts */
  dayStart: number;
}

interface Probe {
  x: number;
  y: number;
  /** position within the stage, in percent, so the core follows the cursor */
  left: number;
  top: number;
}

const hex = (rgb: [number, number, number] | undefined) =>
  rgb ? `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}` : "transparent";

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Hours and minutes into the canvas's own day. A BasePaint day starts in the
 * afternoon and runs across midnight, so a wall clock reading of "02:49" looks
 * earlier than "13:07" while actually being later.
 */
const intoDay = (t: number, dayStart: number) => {
  const mins = Math.max(0, Math.round((t - dayStart) / 60));
  return `+${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
};

export default function CanvasStage({ replay, layer, palette, transparent, dayStart }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgba = toRGBA(layer, palette, replay.area, transparent ? "transparent" : "background");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), replay.size, replay.size), 0, 0);
  }, [layer, palette, replay.area, replay.size, transparent]);

  const locate = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      const x = Math.min(replay.size - 1, Math.max(0, Math.floor(fx * replay.size)));
      const y = Math.min(replay.size - 1, Math.max(0, Math.floor(fy * replay.size)));
      return { x, y, left: fx * 100, top: fy * 100 };
    },
    [replay.size],
  );

  // Newest first, so the column reads like a real core sample: surviving paint
  // at the top, first coat at the bottom. Reversed here rather than with
  // column-reverse so that a column tall enough to scroll still opens on the
  // surviving coat instead of at the bottom of the borehole.
  //
  // Grouped into coats rather than raw events: the deepest pixel on day 131
  // carries 8,104 events, which is 85 coats. One row per event would build
  // 8,104 DOM nodes to say the same thing.
  const core = useMemo(
    () => (probe ? coats(pixelHistory(replay, probe.x, probe.y)).reverse() : []),
    [probe, replay],
  );
  const events = useMemo(() => core.reduce((n, c) => n + c.repeats, 0), [core]);

  const onLeft = probe !== null && probe.left > 55;
  // A tall column pinned to the cursor would hang off the top or bottom of the
  // stage. Past the halfway line it hangs upward from the cursor instead.
  const above = probe !== null && probe.top > 50;

  return (
    <div className={styles.stage}>
      <canvas
        ref={canvasRef}
        width={replay.size}
        height={replay.size}
        className={styles.canvas}
        onMouseMove={(e) => !pinned && setProbe(locate(e))}
        onMouseLeave={() => !pinned && setProbe(null)}
        onClick={(e) => {
          setProbe(locate(e));
          setPinned((p) => !p);
        }}
      />

      {probe && (
        <div
          // Pinned, the column takes the pointer so a deep core can be
          // scrolled. Unpinned it must not, or it would eat its own hover.
          className={pinned ? `${styles.core} ${styles.coreHeld}` : styles.core}
          style={{
            left: `${probe.left}%`,
            top: `${probe.top}%`,
            transform: `translate(${onLeft ? "-100%" : "0"}, ${above ? "-100%" : "0"})`,
            marginLeft: onLeft ? "-14px" : "14px",
            marginTop: above ? "-14px" : "14px",
          }}
        >
          <div className={styles.coreHead}>
            <span className="label">core</span>
            <span className="tabular">
              {probe.x},{probe.y}
            </span>
          </div>

          {core.length === 0 ? (
            <p className={styles.coreEmpty}>never painted</p>
          ) : (
            <>
              <ol className={styles.coreStack}>
                {core.map((coat, i) => (
                  <li key={`${coat.first}-${i}`} className={styles.coreCoat}>
                    <span
                      className={styles.coreSwatch}
                      style={{ background: hex(palette[coat.color]) }}
                    />
                    <span className={styles.coreArtist}>
                      {shortAddress(replay.artists[coat.artist])}
                      {coat.repeats > 1 && (
                        <span className={styles.coreRepeats} title="paint events in this coat">
                          ×{coat.repeats}
                        </span>
                      )}
                    </span>
                    <span className={styles.coreTime}>{intoDay(coat.first, dayStart)}</span>
                  </li>
                ))}
              </ol>
              <p className={styles.coreFoot}>
                {core.length} {core.length === 1 ? "coat" : "coats"}
                {core.length > 1 && `, ${core.length - 1} buried`}
                {events > core.length && ` · ${events.toLocaleString()} paint events`}
              </p>
            </>
          )}
          {pinned && <p className={styles.corePinned}>pinned — click the canvas to release</p>}
        </div>
      )}
    </div>
  );
}
