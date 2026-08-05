# Underpaint

**Much of the work in a BasePaint canvas sits beneath the finished image.**

BasePaint artists share one grid for 24 hours, building on and painting over one
another's work. The minted artwork is the top coat of that history. On day 1080,
68 artists placed 139,618 pixels on a 65,536-pixel canvas. **Later coats covered
57.4% of those placements.**

Underpaint replays every stroke of any canvas so you can see what's underneath.

![Day 1080 with one coat stripped away: entirely different characters, and the
visible-artist count rising from 36 to 57](screenshots/underpainting.png)

*Day 1080, one coat down. Contributions from 29 artists reappear, while work from
8 surface artists falls away because it had no earlier coat beneath it.*

## Features

### X-ray

Scrub through the day, peel back coats, isolate or hide individual artists, and
bring the underpainting forward.

![The x-ray on day 1080 showing the finished artwork and the artist
panel](screenshots/xray.png)

The attribution panel lists every participating artist and updates with the
current view. Artists whose contributions are fully covered remain in the panel
so their work can still be explored.

### Core sample

Hover over any pixel to see its complete stack: the earliest coat at the bottom
and the surface coat at the top.

![A pinned core sample on day 131 showing 85 coats over 8,104 paint
events](screenshots/core-sample.png)

A coat is a continuous run of one colour by one artist, not an individual paint
event. 

### Remix

**Remix palette** applies another canvas's colours while preserving the original
paint and attribution.

Each remix records its palette day in the URL, so shared links reproduce the
same result.

### Paint

Compose a variation by changing time, coats, artists, or palette, then **paint**
on top. Palette remixes recolour your additions with the rest of the canvas.

The brush can keep a borrowed palette after **Own colours** restores the canvas,
letting you paint one day's colours onto another. **Brush: own colours** restores
the original brush palette. Borrowed palettes are resampled to the canvas's
colour count.

The attribution panel includes your pixels in the visible total and updates each
artist's displayed share as you paint.

Paint is encoded in the link as BasePaint-format `XXYYCC` triplets. Above roughly
1,300 pixels it no longer fits safely in a URL, but remains intact on the canvas
and in PNG exports.

### Archive

The archive contains 1,089 settled canvases, sortable by covered paint,
coverage, depth, artist concentration, late activity, and earnings. **Later
layers cover 62.1% of all recorded painting in BasePaint history.**

![The archive sorted by buried share, with Ship of Theseus at
92%](screenshots/archive.png)

Day 569, *Ship of Theseus*, has the archive's highest covered share at 92.0%,
with 19% coverage and an average depth of 12.5 coats per painted pixel.

## Links are recipes, not files

Each variation is encoded in its URL and rebuilt from the strokes when opened.
Nothing is stored server-side, and the same link produces the same image.

```
/canvas/1080?t=1784875315&p=2&c=102&b=102&s=8&n=68&d=1f2a03…
             │            │   │     │     │   │    └─ your own coat, XXYYCC per pixel
             │            │   │     │     │   └────── the cast this link was made under
             │            │   │     │     └────────── showing only artist 8
             │            │   │     └──────────────── your brush in day 102's palette
             │            │   └────────────────────── the canvas in day 102's palette
             │            └─────────────────────────── two coats stripped
             └──────────────────────────────────────── as it stood at hour 14
```

`solo` and `muted` are indices into the canvas's artist list, ordered by first
appearance. That order is stable for a settled canvas but not self-describing,
so links also carry the artist count. If it changes, Underpaint removes the
artist-specific controls instead of applying them to the wrong person.

**Download PNG** exports whatever is on screen with the recipe in the filename.

## Licence

Code is MIT. BasePaint artwork is CC0.

Built for the [BasePaint hackathon](https://basepaint.xyz/hack), August 2026.
