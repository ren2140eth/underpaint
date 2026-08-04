"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layer, Replay } from "../../../src/engine/replay";
import { brushPixels, linePixels } from "../../../src/engine/paint";
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
  /** while painting, the canvas is a surface rather than a specimen */
  painting: boolean;
  brush: number;
  /** a drag begins; the caller snapshots for undo */
  onStrokeStart: () => void;
  onPaint: (pixels: [number, number][]) => void;
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

export default function CanvasStage({
  replay,
  layer,
  palette,
  transparent,
  dayStart,
  painting,
  brush,
  onStrokeStart,
  onPaint,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [pinned, setPinned] = useState(false);
  /** last grid position while a drag is in flight, so the gap can be filled */
  const stroking = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rgba = toRGBA(layer, palette, replay.area, transparent ? "transparent" : "background");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), replay.size, replay.size), 0, 0);
  }, [layer, palette, replay.area, replay.size, transparent]);

  const locate = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      const x = Math.min(replay.size - 1, Math.max(0, Math.floor(fx * replay.size)));
      const y = Math.min(replay.size - 1, Math.max(0, Math.floor(fy * replay.size)));
      return { x, y, left: fx * 100, top: fy * 100 };
    },
    [replay.size],
  );

  /** One dab, widened by the brush and clipped to the grid. */
  const dab = useCallback(
    (x: number, y: number) => brushPixels(x, y, brush, replay.size),
    [brush, replay.size],
  );

  const startStroke = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!painting) return;
      // Capture, so a drag that leaves the canvas keeps painting and, more
      // importantly, still ends when the button comes up outside it.
      event.currentTarget.setPointerCapture(event.pointerId);
      const { x, y } = locate(event);
      stroking.current = { x, y };
      onStrokeStart();
      onPaint(dab(x, y));
    },
    [painting, locate, onStrokeStart, onPaint, dab],
  );

  const continueStroke = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const from = stroking.current;
      if (!painting || !from) return;
      const { x, y } = locate(event);
      if (x === from.x && y === from.y) return;

      // A pointer dragged at speed skips pixels; joining the reported positions
      // is the difference between a stroke and a row of dots.
      const pixels: [number, number][] = [];
      for (const [lx, ly] of linePixels(from.x, from.y, x, y)) pixels.push(...dab(lx, ly));
      stroking.current = { x, y };
      onPaint(pixels);
    },
    [painting, locate, onPaint, dab],
  );

  const endStroke = useCallback(() => {
    stroking.current = null;
  }, []);

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

  /** Put the probe on a grid coordinate, keeping the tooltip's placement in step. */
  const probeAt = useCallback(
    (x: number, y: number) => {
      const cx = Math.min(replay.size - 1, Math.max(0, x));
      const cy = Math.min(replay.size - 1, Math.max(0, y));
      // Centre of the cell, so the tooltip sits where the cursor would be.
      const left = ((cx + 0.5) / replay.size) * 100;
      const top = ((cy + 0.5) / replay.size) * 100;
      setProbe({ x: cx, y: cy, left, top });
    },
    [replay.size],
  );

  /**
   * The core sample by keyboard.
   *
   * A canvas is opaque to assistive technology, so without this the inspector
   * is reachable only by pointer. Arrows walk the grid — a whole row or column
   * with shift, since stepping one pixel across 256 is not a journey anyone
   * will make — and Enter pins, matching the click.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      if (painting) return;

      const step = event.shiftKey ? 10 : 1;
      const here = probe ?? { x: Math.floor(replay.size / 2), y: Math.floor(replay.size / 2) };

      switch (event.key) {
        case "ArrowLeft":
          probeAt(here.x - step, here.y);
          break;
        case "ArrowRight":
          probeAt(here.x + step, here.y);
          break;
        case "ArrowUp":
          probeAt(here.x, here.y - step);
          break;
        case "ArrowDown":
          probeAt(here.x, here.y + step);
          break;
        case "Enter":
        case " ":
          if (probe) setPinned((p) => !p);
          else probeAt(here.x, here.y);
          break;
        case "Escape":
          setPinned(false);
          setProbe(null);
          break;
        default:
          return;
      }

      // Arrows would otherwise scroll the page out from under the canvas.
      event.preventDefault();
    },
    [painting, probe, replay.size, probeAt],
  );

  /** What a screen reader is told about the pixel currently under inspection. */
  const spoken = !probe
    ? ""
    : core.length === 0
      ? `Pixel ${probe.x}, ${probe.y}: never painted.`
      : `Pixel ${probe.x}, ${probe.y}: ${core.length} ${core.length === 1 ? "coat" : "coats"}, ` +
        `${core.length - 1} buried. Surface painted by ${shortAddress(replay.artists[core[0].artist])}.`;

  return (
    <div className={styles.stage}>
      <canvas
        ref={canvasRef}
        width={replay.size}
        height={replay.size}
        className={painting ? `${styles.canvas} ${styles.canvasPainting}` : styles.canvas}
        tabIndex={0}
        role={painting ? "application" : "img"}
        aria-label={
          painting
            ? `Painting surface, ${replay.size} by ${replay.size} pixels. Drag to paint.`
            : `The canvas, ${replay.size} by ${replay.size} pixels. Arrow keys inspect a pixel's coats, shift for ten at a time, Enter to pin.`
        }
        onKeyDown={onKeyDown}
        // Painting and probing are different intents on the same surface, so
        // only one is live at a time.
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onMouseMove={(e) => !painting && !pinned && setProbe(locate(e))}
        onMouseLeave={() => !painting && !pinned && setProbe(null)}
        onClick={(e) => {
          if (painting) return;
          setProbe(locate(e));
          setPinned((p) => !p);
        }}
      />

      {/* The tooltip is a canvas overlay and unreadable to a screen reader, so
          the same finding is announced in text. */}
      <p className={styles.spoken} aria-live="polite">
        {spoken}
      </p>

      {!painting && probe && (
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
