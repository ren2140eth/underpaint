# Underpaint

**Most of the work in a BasePaint canvas is invisible.**

BasePaint artists share one grid for 24 hours and paint over each other
constantly. The artwork that gets minted is the top coat of that stack. On day
1080, 68 artists placed 139,618 pixels onto a 65,536-pixel canvas — **57.4% of
that work sits under later coats**, where the finished image is built on top of
it.

Underpaint replays every stroke of any canvas so you can see what's underneath.

![Day 1080 with one coat stripped away: entirely different characters, and the
visible-artist count rising from 36 to 57](screenshots/underpainting.png)

*Day 1080, one coat down. Different animals entirely. 29 artists who own nothing
in the finished piece own something here — and 8 who are visible on the surface
vanish, because everything they painted was laid down once and never covered.
The checkerboard is where nothing was buried.*

## What it does

### X-ray

Scrub through the day, peel coats back one at a time, solo or mute individual
artists, or promote the buried underpainting to the surface. Every control is a
filter on the same per-pixel event stack, so they compose: "hour 14, two coats
down, without these three artists" is one image, not three.

![The x-ray on day 1080 showing the finished artwork and the artist
panel](screenshots/xray.png)

Beside it, a live attribution panel: every artist who painted here, ranked by
what they own *right now*. Change a control and the ranking changes. Artists
whose paint is entirely buried keep their row — they are the point.

### Core sample

Hover any pixel to pull its full stack out as a column of swatches, oldest coat
at the bottom, surviving paint on top. It reads like a geological core, which is
what a palimpsest is.

![A pinned core sample on day 131 showing 85 coats over 8,104 paint
events](screenshots/core-sample.png)

Coats are runs of one colour from one hand, not raw paint events — a brush
dragged over its own path repaints a pixel without laying anything new down.
The deepest pixel in the archive took **8,104 paint events**, which is 85 coats.
On the median canvas the most-worked pixel is touched by 19 separate strokes;
on day 382 one pixel was touched by 271.

### Remix

**Remix palette** repaints a canvas in another canvas's colours — same paint,
same hands, someone else's palette. BasePaint palettes run from 2 to 24 colours,
so indices are mapped proportionally: first to first, last to last, everything
between in proportion. Palettes are mostly ordered light to dark, so the artwork
keeps its tonal structure and changes only its hue.

The roll happens on click and the result is a fixed day in the URL, so a remix
link reproduces exactly rather than re-rolling for whoever opens it.

### Paint

Compose a variation — wind the day back, strip some coats, wear another
canvas's colours — then **paint** on it and finish it however you like. Your
coat sits on top of whatever you composed, in the palette that's active, so a
remix recolours your work along with everyone else's: it's paint on the same
canvas, not a sticker over it.

The artist panel counts your pixels honestly. Everyone's share is a fraction of
what's actually visible, so covering someone's work lowers their number — you
are one of the hands now.

A painting rides in the link as a BasePaint-format `XXYYCC` blob, the same
triplets the chain stores. Past about 1,300 pixels it stops fitting in a URL;
the canvas and the PNG keep every pixel and the page says so, rather than
truncating your work into a different picture.

### Archive

All 1,089 settled canvases, sortable by figures derived from the strokes:
buried labour, coverage, paint depth, artist concentration, late surge, and what
each canvas earned. **62.1% of all painting in BasePaint history is buried.**

![The archive sorted by buried share, with Ship of Theseus at
92%](screenshots/archive.png)

The most buried canvas ever made is day 569, *Ship of Theseus*, at 92.0% — 19%
coverage and 12.5 coats on the average painted pixel. It is aptly named.

## Links are recipes, not files

Every variation encodes itself into the URL, and the canvas is replayed from the
strokes when the link is opened. Nothing is stored, and the same link always
produces the same image.

```
/canvas/1080?t=1784875315&p=2&c=102&s=8&n=68&d=1f2a03…
             │             │    │     │   │   └─ your own coat, XXYYCC per pixel
             │             │    │     │   └───── the cast this link was made under
             │             │    │     └───────── showing only artist 8
             │             │    └─────────────── in day 102's palette
             │             └──────────────────── two coats stripped
             └────────────────────────────────── as it stood at hour 14
```

`solo` and `muted` are indices into the canvas's artist list, which is built in
order of first appearance. That is deterministic for a settled canvas, but it is
not self-describing — so links carry the cast size they were made under. If it
no longer matches, the artist controls are dropped and you are told, rather than
being shown the wrong person's work.

**Download PNG** exports whatever is on screen, upscaled by a whole number so
the pixels stay square, with the recipe in the filename.

## Verified against the real artwork

Two layers of checking. `npm test` runs 172 offline unit fixtures over every
render mode — time scrubbing, coat peeling, solo, mute, underpainting,
attribution, the artist roster, pixel histories, recipe encoding, palette
remapping, brush geometry, and the malformed-blob paths.

`npm run verify` is the proof that matters. It re-derives each canvas's final
image from its strokes and compares it pixel-for-pixel with the artwork
BasePaint published at `basepaint.net`:

```
$ npm run verify

verifying 15 canvases against basepaint.net

  PASS  day    1 (144px)  160 strokes, 27,498 px placed, 101 artists
  PASS  day  131 (144px)  690 strokes, 104,498 px placed, 620 artists
  PASS  day  365 (144px)  703 strokes, 99,411 px placed, 336 artists
  PASS  day  366 (256px)  548 strokes, 113,982 px placed, 335 artists
  PASS  day  569 (256px)  879 strokes, 156,204 px placed, 127 artists
  PASS  day 1080 (256px)  157 strokes, 139,618 px placed, 68 artists
  ...
  15/15 canvases reproduced exactly
```

Run `npm run verify 1080 1081` to check specific days.

## How it works

Strokes are stored on Base as hex blobs — six characters per pixel, `XXYYCC`
for x, y, and palette index. Replaying them in order reconstructs not just the
final image but every layer beneath it. Data comes from BasePaint's public
GraphQL indexer; there is no backend, the site is statically exported, and
nothing is stored server-side.

```
src/engine/basepaint.ts    GraphQL client, palettes, proportional remapping
src/engine/replay.ts       stroke replay, render modes, coat grouping
src/engine/view.ts         composed variations, artist roster, URL recipes
src/engine/stats.ts        per-canvas statistics
src/engine/index-table.ts  the archive's rows and sort order
src/engine/paint.ts        the visitor's own coat: brush, blob, overlay
scripts/verify.ts          correctness proof against published artwork
scripts/ingest.ts          precompute the canvas index
scripts/palettes.ts        project the palette lookup the remix control fetches
data/index.json            1,090 canvases, committed
test/                      172 offline fixtures
```

Strokes are fetched on demand and replayed in the browser — the committed index
is 978 KB, the archive's strokes are hundreds of megabytes.

## A note on buried paint

Buried is not a bad score, and a high buried share is not a flaw in the canvas
or in BasePaint. Painting over each other is the game as designed and as
documented — that shared grid is the whole point of it, and every artist can
see the rules going in.

An artist who lays down 7,000 pixels of base layer in hour 3 is doing the work
the finished image is built on — that's underpainting, and it's why the canvas
looks like anything at all. On day 1080 the two busiest hands on the canvas
placed 7,000 and 6,999 pixels, and both are entirely under later coats.
Underpaint shows these numbers as facts about how a canvas was made, and
deliberately does not rank artists by them.

## Licence

Code is MIT. BasePaint artwork is CC0.

Built for the [BasePaint hackathon](https://basepaint.xyz/hack), August 2026.
