"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Replay } from "../../../src/engine/replay";
import { pixelHistory, toRGBA } from "../../../src/engine/replay";
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

  // Oldest first, and the list is laid out bottom-up, so the column reads like
  // a real core sample: first coat at the bottom, surviving paint on top.
  const core = useMemo(
    () => (probe ? pixelHistory(replay, probe.x, probe.y) : []),
    [probe, replay],
  );
  const onLeft = probe !== null && probe.left > 55;

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
          className={styles.core}
          style={{
            left: `${probe.left}%`,
            top: `${probe.top}%`,
            transform: onLeft ? "translate(-100%, -50%)" : "translate(0, -50%)",
            marginLeft: onLeft ? "-14px" : "14px",
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
                {core.map((event, i) => (
                  <li key={`${event.time}-${i}`} className={styles.coreCoat}>
                    <span
                      className={styles.coreSwatch}
                      style={{ background: hex(palette[event.color]) }}
                    />
                    <span className={styles.coreArtist}>
                      {shortAddress(replay.artists[event.artist])}
                    </span>
                    <span className={styles.coreTime}>{intoDay(event.time, dayStart)}</span>
                  </li>
                ))}
              </ol>
              <p className={styles.coreFoot}>
                {core.length} {core.length === 1 ? "coat" : "coats"}
                {core.length > 1 && `, ${core.length - 1} buried`}
              </p>
            </>
          )}
          {pinned && <p className={styles.corePinned}>pinned — click the canvas to release</p>}
        </div>
      )}
    </div>
  );
}
