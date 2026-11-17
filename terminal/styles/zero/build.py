"""Builds `ryntra-zero.woff2`: the terminal's plain zero.

Hubot Sans — the face of the terminal's numbers — draws the digit zero with a bar across it, so a price read as
«$θ,2544». The face has no OpenType feature for a plain zero. This script takes Hubot Sans as the build serves it
(the Latin subset of Google Fonts, a variable font with its width and weight axes), keeps only the zero — every form
of it, the tabular one too — and removes the bar's contour from the outline and from every variation. Nothing else
changes: the same advance in every form, so a column of figures keeps its tabular width, and the same weight and
width as the digits beside it.

The terminal loads the result first in the numbers' stack for U+0030 alone (`terminal/styles/zero.ts`); the city and
the share cards keep Hubot Sans as it is.

    python terminal/styles/zero/build.py <Hubot Sans latin .woff2> terminal/styles/zero/ryntra-zero.woff2

Needs fontTools and brotli. Hubot Sans is licensed under the SIL Open Font License 1.1 (`OFL.txt` beside this file);
the derived font carries another name, as the licence asks.
"""

import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates

FAMILY = "Ryntra Zero"


def bar_of(coords, ends):
    """The bar across the zero: the one four-point contour, wider than it is tall. Returns its point range or None."""
    start = 0
    found = None
    for end in ends:
        points = coords[start : end + 1]
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        if len(points) == 4 and (max(xs) - min(xs)) > 3 * (max(ys) - min(ys)):
            if found is not None:
                raise SystemExit("two bars in one zero: look at the glyph")
            found = (start, end)
        start = end + 1
    return found


def main(source: str, target: str) -> None:
    options = subset.Options()
    options.layout_features = ["*"]
    options.glyph_names = True
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.hinting = False
    font = TTFont(source)
    if "Hubot Sans" not in (font["name"].getDebugName(1) or ""):
        raise SystemExit("the source is not Hubot Sans")
    advances = {name: font["hmtx"][name][0] for name in font.getGlyphOrder() if name.startswith("zero")}
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[0x30])
    subsetter.subset(font)

    glyf = font["glyf"]
    gvar = font["gvar"]
    done = []
    for name in font.getGlyphOrder():
        if not name.startswith("zero"):
            continue
        glyph = glyf[name]
        coords, ends, flags = glyph.getCoordinates(glyf)
        bar = bar_of(coords, ends)
        if bar is None:
            # The small forms — a numerator, a denominator — are drawn plain already.
            done.append(f"{name} (plain as it is)")
            continue
        first, last = bar
        gone = last - first + 1
        keep = [i for i in range(len(coords)) if i < first or i > last]
        glyph.coordinates = GlyphCoordinates([coords[i] for i in keep])
        glyph.flags = type(flags)(flags[i] for i in keep)
        glyph.endPtsOfContours = [end if end < first else end - gone for end in ends if end != last]
        glyph.numberOfContours -= 1
        if hasattr(glyph, "program"):
            glyph.program.fromBytecode(b"")
        # A variation lists a delta for every point and four phantom points after them.
        for variation in gvar.variations.get(name, []):
            deltas = variation.coordinates
            variation.coordinates = [deltas[i] for i in keep] + list(deltas[len(coords) :])
        glyph.recalcBounds(glyf)
        if font["hmtx"][name][0] != advances[name]:
            raise SystemExit(f"{name}: the advance moved")
        done.append(f"{name} ({glyph.numberOfContours} contours, advance {advances[name]})")

    for record in font["name"].names:
        if record.nameID in (1, 16):
            record.string = FAMILY
        elif record.nameID in (4,):
            record.string = FAMILY
        elif record.nameID == 6:
            record.string = FAMILY.replace(" ", "")
        elif record.nameID == 3:
            record.string = f"{FAMILY}: the zero of Hubot Sans without its bar"

    font.flavor = "woff2"
    font.save(target)
    print("built", target, "—", ", ".join(done))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
