# Underpaint

**Most of the work in a BasePaint canvas is invisible.**

BasePaint artists share one grid for 24 hours and paint over each other
constantly. The artwork that gets minted is only what survived. On day 1080,
68 artists placed 139,618 pixels onto a 65,536-pixel canvas — **57.4% of that
work ended up buried**, and 32 of the 68 artists finished with no visible pixels
at all.

Underpaint replays every stroke of any canvas so you can see what's underneath.

## What it does

- **X-ray** — scrub through the day, peel paint layers back one at a time, solo
  or mute individual artists, or promote the buried underpainting to the
  surface. Every BasePaint canvas is a palimpsest up to 7 layers deep.
- **Pixel inspector** — click any pixel for its full history: every artist who
  painted it, in order, with colours and timestamps.
- **Canvas index** — all ~1,090 canvases ranked by things you can't currently
  see: buried labour, artist concentration, coverage, and effort relative to how
  many people minted it.

Every variation shows an attribution split — which artists' pixels are visible
in the image you're looking at, by share. Change a control and the split
changes.

## Verified against the real artwork

The replay is checked by re-deriving each canvas's final image from its strokes
and comparing it pixel-for-pixel with the artwork BasePaint published at
`basepaint.net`:

```
$ npm run verify

  PASS  day    1 (144px)  160 strokes,  27,498 px placed, 101 artists
  PASS  day  365 (144px)  703 strokes,  99,411 px placed, 336 artists
  PASS  day  366 (256px)  548 strokes, 113,982 px placed, 335 artists
  PASS  day 1080 (256px)  157 strokes, 139,618 px placed,  68 artists
  ...
  11/11 canvases reproduced exactly
```

Run `npm run verify 1080 1081` to check specific days.

## How it works

Strokes are stored on Base as hex blobs — six characters per pixel, `XXYYCC`
for x, y, and palette index. Replaying them in order reconstructs not just the
final image but every layer beneath it. Data comes from BasePaint's public
GraphQL indexer; there is no backend and nothing is stored server-side.

```
src/engine/basepaint.ts   GraphQL client (paginated, BigInt id ordering)
src/engine/replay.ts      stroke replay + all render modes
scripts/verify.ts         correctness proof against published artwork
```

## A note on "survival"

A low survival rate is not a bad score. An artist who lays down 7,000 pixels of
base layer in hour 3 is doing the work the finished image is built on — that's
underpainting, and it's why the canvas looks like anything at all. Underpaint
shows these numbers as facts about how a canvas was made, and deliberately does
not rank artists by them.

## Licence

Code is MIT. BasePaint artwork is CC0.

Built for the [BasePaint hackathon](https://basepaint.xyz/hack), August 2026.
