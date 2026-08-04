import type { Metadata } from "next";
import { Roboto_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import styles from "./layout.module.css";

const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto-mono",
});

export const metadata: Metadata = {
  title: "Underpaint — see what's under a BasePaint canvas",
  description:
    "Replay every stroke of any BasePaint canvas to see the work that got painted over. 61.9% of all painting in BasePaint history is buried.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={robotoMono.variable}>
      <body>
        {/* BasePaint asks every app to keep a stable header linking home. */}
        <header className={styles.header}>
          <Link href="/" className={styles.wordmark}>
            <span className={styles.mark} aria-hidden="true" />
            Underpaint
          </Link>
          <nav className={styles.nav}>
            <Link href="/">X-ray</Link>
            <a href="https://github.com/ren2140eth/underpaint">Source</a>
            <a href="https://basepaint.xyz/" className={styles.home}>
              basepaint.xyz
            </a>
          </nav>
        </header>
        <main>{children}</main>
        <footer className={styles.footer}>
          <p>
            Stroke data from BasePaint's public indexer. Artwork is CC0. Underpaint computes an
            attribution split for every variation and pays nothing — there is no contract here.
          </p>
          {/* BasePaint's optional referral beacon. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://basepaint.xyz/api/beacon.gif?ref=underpaint" width={1} height={1} alt="" />
        </footer>
      </body>
    </html>
  );
}
