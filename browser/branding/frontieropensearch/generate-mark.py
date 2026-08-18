#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Generate the Frontier OpenSearch mark.

The geometry below is the single source of truth. It emits the SVG wordmark
and glyph, and rasterises every PNG size the build needs. There is no raster
source of truth: regenerate rather than edit any PNG by hand.

    python3 browser/branding/frontieropensearch/generate-mark.py

The glyph is one stroke that divides into three. Each branch continues past
the fork -- the point where a linear path would have ended -- which is the
thesis of the browser in one shape.
"""

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))

# Canvas is 64x64 user units; every coordinate below is in those units.
VIEW = 64
TILE_RADIUS = 14.0
STROKE = 5.0
# The glyph is drawn in the 64-unit box, then inset so it breathes in the tile.
INSET = 0.86

INK = "#0E1726"  # tile
STRAND = "#4FD1C5"  # glyph

# The stem rises, forks at FORK, and the three branches all overshoot it.
FORK = (32.0, 34.0)
STEM = [(32.0, 55.0), FORK]
# Outer branches are quadratic curves; the centre one carries straight on.
LEFT = (FORK, (28.0, 24.0), (14.0, 13.0))
RIGHT = (FORK, (36.0, 24.0), (50.0, 13.0))
CENTRE = [FORK, (32.0, 9.0)]


def inset(p):
    k = INSET
    return (p[0] * k + VIEW / 2 * (1 - k), p[1] * k + VIEW / 2 * (1 - k))


def quad(p0, p1, p2, steps=48):
    """Flatten a quadratic bezier to a polyline."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        pts.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return pts


def polylines():
    return [STEM + CENTRE[1:], quad(*LEFT), quad(*RIGHT)]


def svg(size=64, tile=True):
    def f(v):
        return f"{v:.2f}"

    o = VIEW / 2 * (1 - INSET)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {VIEW} {VIEW}" fill="none">',
    ]
    if tile:
        out.append(
            f'  <rect width="{VIEW}" height="{VIEW}" rx="{f(TILE_RADIUS)}" fill="{INK}"/>'
        )
    d = (
        f"M{f(STEM[0][0])},{f(STEM[0][1])} L{f(CENTRE[1][0])},{f(CENTRE[1][1])} "
        f"M{f(FORK[0])},{f(FORK[1])} Q{f(LEFT[1][0])},{f(LEFT[1][1])} "
        f"{f(LEFT[2][0])},{f(LEFT[2][1])} "
        f"M{f(FORK[0])},{f(FORK[1])} Q{f(RIGHT[1][0])},{f(RIGHT[1][1])} "
        f"{f(RIGHT[2][0])},{f(RIGHT[2][1])}"
    )
    out.append(
        f'  <g transform="translate({f(o)},{f(o)}) scale({f(INSET)})">'
        f'<path d="{d}" stroke="{STRAND}" stroke-width="{f(STROKE)}" '
        f'stroke-linecap="round" stroke-linejoin="round"/></g>'
    )
    out.append("</svg>")
    return "\n".join(out) + "\n"


def wordmark():
    """Glyph plus name, sized to sit in the about dialog header."""

    def f(v):
        return f"{v:.2f}"

    k = 72.0 / VIEW
    d = (
        f"M{f(STEM[0][0])},{f(STEM[0][1])} L{f(CENTRE[1][0])},{f(CENTRE[1][1])} "
        f"M{f(FORK[0])},{f(FORK[1])} Q{f(LEFT[1][0])},{f(LEFT[1][1])} "
        f"{f(LEFT[2][0])},{f(LEFT[2][1])} "
        f"M{f(FORK[0])},{f(FORK[1])} Q{f(RIGHT[1][0])},{f(RIGHT[1][1])} "
        f"{f(RIGHT[2][0])},{f(RIGHT[2][1])}"
    )
    # The viewBox width has to clear the end of the text or the name is simply
    # cut off: the about dialog paints this with background-size "auto 44px", so
    # the viewBox is the crop, not a hint. At font-size 30 and weight 600,
    # "Frontier OpenSearch" measures 350.35px in the product itself, less 7.6px
    # of letter-spacing over 19 characters, starting at x=86 — so the glyphs run
    # to x≈429. The first cut of this file said 372 and shipped a dialog reading
    # "Frontier OpenSea".
    #
    # 470 leaves headroom rather than hugging that number, because system-ui
    # resolves to a different font on other systems and a wider one would clip
    # again. The extra width costs nothing: it is trailing transparent space in
    # a left-aligned background image.
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 470 99" fill="none">\n'
        f'  <g transform="translate(0,14) scale({f(k)})">'
        f'<path d="{d}" stroke="context-fill" stroke-width="{f(STROKE)}" '
        'stroke-linecap="round" stroke-linejoin="round"/></g>\n'
        '  <text x="86" y="60" fill="context-fill" font-size="30" '
        'font-family="system-ui, sans-serif" font-weight="600" '
        'letter-spacing="-0.4">Frontier OpenSearch</text>\n'
        "</svg>\n"
    )


def png(size, tile=True, ss=8):
    """Rasterise by drawing at ss times the target and downsampling."""
    n = size * ss
    scale = n / VIEW
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if tile:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=TILE_RADIUS * scale, fill=INK)
    w = max(1, round(STROKE * INSET * scale))
    for line in polylines():
        pts = [(x * scale, y * scale) for x, y in (inset(p) for p in line)]
        d.line(pts, fill=STRAND, width=w, joint="curve")
        # Round caps: PIL has none, so cap the ends by hand.
        for x, y in (pts[0], pts[-1]):
            r = w / 2.0
            d.ellipse([x - r, y - r, x + r, y + r], fill=STRAND)
    return img.resize((size, size), Image.LANCZOS)


def main():
    content = os.path.join(HERE, "content")
    os.makedirs(content, exist_ok=True)

    with open(os.path.join(content, "about-logo.svg"), "w") as fh:
        fh.write(svg(192))
    with open(os.path.join(HERE, "glyph.svg"), "w") as fh:
        fh.write(svg(64))
    with open(os.path.join(content, "about-wordmark.svg"), "w") as fh:
        fh.write(wordmark())

    for size in (16, 22, 24, 32, 48, 64, 128, 256):
        png(size).save(os.path.join(HERE, f"default{size}.png"))
    png(192).save(os.path.join(content, "about-logo.png"))
    png(384).save(os.path.join(content, "about-logo@2x.png"))
    print("wrote mark at", HERE)


if __name__ == "__main__":
    main()
