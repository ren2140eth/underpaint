import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allCanvases, canvasRow, neighbours } from "../../../src/engine/index-data";
import XRay from "./XRay";

export function generateStaticParams() {
  return allCanvases().map((c) => ({ day: String(c.day) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ day: string }>;
}): Promise<Metadata> {
  const row = canvasRow(Number((await params).day));
  if (!row) return { title: "Underpaint" };

  const buried = Math.round(100 * row.buriedShare);
  return {
    title: `${row.name} — day ${row.day} under x-ray | Underpaint`,
    description: `${row.artists} artists placed ${row.distinctPlaced.toLocaleString()} pixels on day ${row.day}. ${buried}% of that work is buried under the finished artwork.`,
  };
}

export default async function CanvasPage({ params }: { params: Promise<{ day: string }> }) {
  const day = Number((await params).day);
  const row = canvasRow(day);
  if (!row) notFound();

  return <XRay row={row} {...neighbours(day)} />;
}
