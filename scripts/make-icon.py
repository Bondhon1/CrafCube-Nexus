"""Render the app icon from the same geometry as src/components/Logo.tsx.

The mark is drawn rather than exported from a design tool so the taskbar icon
and the in-app logo can never drift apart. Run this after changing LogoMark:

    python scripts/make-icon.py

Outputs apps/desktop/build/, which electron-builder picks up automatically.
"""
from __future__ import annotations

import pathlib

from PIL import Image, ImageDraw

DESKTOP = pathlib.Path(__file__).resolve().parent.parent / "apps" / "desktop"
OUT = DESKTOP / "build"
# Vite copies public/ verbatim, so the favicon has to live there rather than
# alongside the packaging icons.
PUBLIC = DESKTOP / "public"

# Drawn at 8x the largest target, then downscaled: PIL has no anti-aliased
# polygon fill, so supersampling is what keeps the hexagon edges clean.
SUPER = 2048
SCALE = SUPER / 100.0

# tailwind.config.mjs — the palette is sampled from the brand artwork.
INK_900 = (0, 15, 22, 255)
INK_700 = (13, 42, 52, 255)
MINT = (13, 248, 208, 255)
MINT_600 = (14, 177, 141, 255)

# The mark occupies this share of the canvas. Icons sit in a padded square on
# every platform, so filling edge to edge would look larger than its neighbours.
MARK_SCALE = 0.82

HEX = [(50, 3), (91, 26.5), (91, 73.5), (50, 97), (9, 73.5), (9, 26.5)]
CUBE_TOP = [(50, 30), (69, 41), (50, 52), (31, 41)]
CUBE_LEFT = [(31, 41), (50, 52), (50, 74), (31, 63)]
CUBE_RIGHT = [(69, 41), (69, 63), (50, 74), (50, 52)]

# Thicker than the 9 units the SVG uses. At 16 px the on-screen stroke is barely
# over a pixel, and a ring that thin greys out into the taskbar background.
RING_WIDTH = 11


def place(points: list[tuple[float, float]], scale: float = MARK_SCALE
          ) -> list[tuple[float, float]]:
    """Map 100-unit mark coordinates onto the padded canvas."""
    offset = SUPER * (1 - scale) / 2
    return [(x * SCALE * scale + offset, y * SCALE * scale + offset) for x, y in points]


def shrink(points: list[tuple[float, float]], factor: float
           ) -> list[tuple[float, float]]:
    """Scale a shape about the mark's centre."""
    return [(50 + (x - 50) * factor, 50 + (y - 50) * factor) for x, y in points]


def linear_gradient(size: int, start: tuple, end: tuple) -> Image.Image:
    """Top-left to bottom-right gradient, matching the SVG's x1/y1 -> x2/y2."""
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    assert pixels is not None
    for y in range(size):
        for x in range(size):
            # Diagonal position, normalised to 0..1.
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(
                round(start[i] + (end[i] - start[i]) * t) for i in range(4)
            )
    return gradient


def draw_mark(simplified: bool = False) -> Image.Image:
    """The mint hexagon and cube on a transparent ground.

    `simplified` is the 16-24 px cut. At those sizes the gap between the ring
    and the cube closes up and the two shapes merge into one blob, so the cube
    is pulled in, the ring thickened, and the dimmed side faces dropped —
    facet shading no more than a pixel wide is noise, not depth.
    """
    paint = linear_gradient(SUPER, MINT, MINT_600)
    canvas = Image.new("RGBA", (SUPER, SUPER), (0, 0, 0, 0))
    width = RING_WIDTH * (1.35 if simplified else 1.0)
    cube = 0.72 if simplified else 1.0

    def stamp(points: list[tuple[float, float]], opacity: float) -> None:
        mask = Image.new("L", (SUPER, SUPER), 0)
        ImageDraw.Draw(mask).polygon(place(shrink(points, cube)),
                                     fill=round(255 * opacity))
        canvas.paste(paint, (0, 0), mask)

    # Outer ring: the hexagon minus a concentric copy of itself.
    ring = Image.new("L", (SUPER, SUPER), 0)
    ring_draw = ImageDraw.Draw(ring)
    ring_draw.polygon(place(HEX), fill=255)
    ring_draw.polygon(place(shrink(HEX, 1 - width / 50)), fill=0)
    canvas.paste(paint, (0, 0), ring)

    # Cube faces. The two sides are dimmed so the isometric form reads at a
    # glance rather than flattening into one mint blob.
    stamp(CUBE_TOP, 1.0)
    stamp(CUBE_LEFT, 1.0 if simplified else 0.55)
    stamp(CUBE_RIGHT, 1.0 if simplified else 0.8)
    return canvas


def draw_icon(simplified: bool = False) -> Image.Image:
    """Mark on the app's near-black ground, in a rounded square."""
    plate = linear_gradient(SUPER, INK_700, INK_900)

    # Windows taskbars are usually dark, so a near-black plate would dissolve
    # into the background. The rounded shape plus the mint mark is what gives
    # the icon an outline; the plate only has to separate it from pure black.
    mask = Image.new("L", (SUPER, SUPER), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, SUPER - 1, SUPER - 1), radius=round(SUPER * 0.22), fill=255,
    )

    icon = Image.new("RGBA", (SUPER, SUPER), (0, 0, 0, 0))
    icon.paste(plate, (0, 0), mask)
    icon.alpha_composite(draw_mark(simplified))
    return icon


# Below this the detailed mark stops resolving and the simplified cut is used.
SIMPLIFY_BELOW = 32

ICO_SIZES = [16, 20, 24, 32, 48, 64, 128, 256]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    detailed = draw_icon()
    simple = draw_icon(simplified=True)

    # electron-builder derives the macOS .icns and its own .ico from this.
    detailed.resize((512, 512), Image.LANCZOS).save(OUT / "icon.png")

    # A hand-built .ico as well, so each size carries the right cut — and
    # because Electron needs one at runtime for the dev window, before any
    # packaging step has run. PIL's own multi-size ICO would downscale one
    # bitmap for every entry, which is what smears the 16 px frame.
    frames = [
        (simple if size < SIMPLIFY_BELOW else detailed).resize((size, size), Image.LANCZOS)
        for size in ICO_SIZES
    ]
    frames[-1].save(OUT / "icon.ico", format="ICO",
                    sizes=[(s, s) for s in ICO_SIZES], append_images=frames[:-1])

    # The mark alone, on no plate, for the renderer's favicon.
    PUBLIC.mkdir(parents=True, exist_ok=True)
    draw_mark().resize((256, 256), Image.LANCZOS).save(PUBLIC / "mark.png")

    print(f"wrote {OUT / 'icon.png'}, {OUT / 'icon.ico'}, {PUBLIC / 'mark.png'}")


if __name__ == "__main__":
    main()
