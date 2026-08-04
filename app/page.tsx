import { redirect } from "next/navigation";
import { latestSettledDay } from "../src/engine/index-data";

/** The x-ray is the product, so the front door is the most recent finished canvas. */
export default function Home() {
  redirect(`/canvas/${latestSettledDay()}`);
}
