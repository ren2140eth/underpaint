"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { artworkUrl } from "../../src/engine/basepaint";
import {
  type IndexRow,
  type SortDirection,
  type SortKey,
  sortRows,
} from "../../src/engine/index-table";
import styles from "./index.module.css";

interface Props {
  rows: IndexRow[];
  placed: number;
  visible: number;
}

interface Column {
  key: SortKey;
  label: string;
  /** what the number means, since each one is derived here rather than read off a feed */
  note: string;
  render: (r: IndexRow) => string;
  /** the direction a first click should use — for most metrics, biggest first */
  first: SortDirection;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const num = (x: number) => x.toLocaleString();

const COLUMNS: Column[] = [
  {
    key: "buriedShare",
    label: "Buried",
    note: "Share of the paint placed here that later coats cover.",
    render: (r) => pct(r.buriedShare),
    first: "desc",
  },
  {
    key: "placed",
    label: "Placed",
    note: "Pixel placements, which is what the day's ETH was split on.",
    render: (r) => num(r.placed),
    first: "desc",
  },
  {
    key: "coverage",
    label: "Coverage",
    note: "Share of the grid that got painted at all.",
    render: (r) => pct(r.coverage),
    first: "desc",
  },
  {
    key: "meanDepth",
    label: "Depth",
    note: "Coats on the average painted pixel.",
    render: (r) => r.meanDepth.toFixed(2),
    first: "desc",
  },
  {
    key: "artists",
    label: "Artists",
    note: "Everyone who painted here.",
    render: (r) => `${num(r.artists)}`,
    first: "desc",
  },
  {
    key: "artistsVisible",
    label: "Visible",
    note: "Artists with at least one pixel in the finished artwork.",
    render: (r) => `${num(r.artistsVisible)}`,
    first: "desc",
  },
  {
    key: "topShare",
    label: "Top hand",
    note: "The largest single artist's share of the finished image.",
    render: (r) => pct(r.topShare),
    first: "desc",
  },
  {
    key: "lateSurge",
    label: "Late",
    note: "Share of the finished image laid down in the final six hours.",
    render: (r) => pct(r.lateSurge),
    first: "desc",
  },
  {
    key: "mints",
    label: "Mints",
    note: "Editions sold.",
    render: (r) => num(r.mints),
    first: "desc",
  },
  {
    key: "earnedEth",
    label: "Earned",
    note: "ETH the canvas took, split among its artists by pixels placed.",
    render: (r) => r.earnedEth.toFixed(2),
    first: "desc",
  },
  {
    key: "effortPerMint",
    label: "Effort/mint",
    note: "Placements per edition sold. Effort and editions have moved independently over the years, so it compares poorly across eras.",
    render: (r) => (r.effortPerMint === null ? "—" : Math.round(r.effortPerMint).toLocaleString()),
    first: "desc",
  },
];

export default function CanvasIndex({ rows, placed, visible }: Props) {
  const [key, setKey] = useState<SortKey>("day");
  const [dir, setDir] = useState<SortDirection>("desc");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? rows.filter(
          (r) => r.name.toLowerCase().includes(needle) || String(r.day).includes(needle),
        )
      : rows;
    return sortRows(matches, key, dir);
  }, [rows, key, dir, query]);

  const sortBy = (col: SortKey, first: SortDirection) => {
    if (col === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setKey(col);
      setDir(first);
    }
  };

  const arrow = (col: SortKey) => (col === key ? (dir === "asc" ? "↑" : "↓") : "");
  const ariaSort = (col: SortKey): "ascending" | "descending" | "none" =>
    col === key ? (dir === "asc" ? "ascending" : "descending") : "none";

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div>
          <p className="label">The archive</p>
          <h1 className={styles.title}>Every canvas, by what it buried</h1>
        </div>
        <p className={styles.thesis}>
          <span className="readout">{pct(1 - visible / placed)}</span>
          <span className="label">of all painting in BasePaint history is buried</span>
          <span className={styles.thesisBody}>
            {num(rows.length)} settled canvases. <span className="tabular">{num(placed)}</span>{" "}
            pixel placements, <span className="tabular">{num(visible)}</span> of them still
            visible. Sort by any column — every figure here is derived from the strokes.
          </span>
        </p>
      </header>

      <div className={styles.tools}>
        <input
          type="search"
          value={query}
          placeholder="Search by name or day"
          aria-label="Search canvases by name or day"
          className={styles.search}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className={styles.count} aria-live="polite">
          {shown.length === rows.length
            ? `${num(rows.length)} canvases`
            : `${num(shown.length)} of ${num(rows.length)}`}
        </p>
      </div>

      {/* Eleven columns do not fit a phone; the table scrolls inside its own box. */}
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" aria-sort={ariaSort("day")} className={styles.canvasHead}>
                <button type="button" className={styles.sort} onClick={() => sortBy("day", "desc")}>
                  Canvas <span className={styles.arrow}>{arrow("day")}</span>
                </button>
              </th>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} aria-sort={ariaSort(c.key)}>
                  <button
                    type="button"
                    className={styles.sort}
                    title={c.note}
                    onClick={() => sortBy(c.key, c.first)}
                  >
                    {c.label} <span className={styles.arrow}>{arrow(c.key)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.day}>
                <th scope="row" className={styles.canvasCell}>
                  <Link href={`/canvas/${r.day}`} className={styles.canvasLink}>
                    {/* The published artwork, straight from BasePaint. Lazy, because
                        there are 1,089 of them and most are below the fold. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={artworkUrl(r.day)}
                      alt=""
                      width={40}
                      height={40}
                      loading="lazy"
                      decoding="async"
                      className={styles.thumb}
                    />
                    <span className={styles.canvasText}>
                      <span className={styles.canvasName}>{r.name}</span>
                      <span className={styles.canvasDay}>
                        day {r.day} · {r.size}px
                      </span>
                    </span>
                  </Link>
                </th>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={c.key === key ? styles.cellOn : styles.cell}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {shown.length === 0 && <p className={styles.empty}>No canvas matches that.</p>}
      </div>
    </div>
  );
}
