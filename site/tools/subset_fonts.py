"""Makes the site's two web fonts from the OFL sources in github.com/google/fonts.

    python -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python site/tools/subset_fonts.py <folder with the downloaded .ttf files>

Sources (download them next to each other, keep the names):
    https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf
    https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat[wght].ttf
Their licences (SIL Open Font License 1.1) are copied next to the woff2 files as OFL-*.txt.

- fraunces.woff2: the text and display face. Variable in weight (300-800), optical size
  (9-144, the browser follows the font size) and WONK; SOFT pinned at 100 (round, ink-spread
  terminals).
- caveat.woff2: the handwriting for notes in the margins, one weight (500).
Both keep English and French only (ASCII, Latin-1, OE ligatures, general punctuation with the
narrow no-break space, euro, arrows): about 90 KB together.
"""

import io
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

UNICODES = (
    list(range(0x20, 0x7F))
    + list(range(0xA0, 0x100))
    + [0x131, 0x152, 0x153, 0x178, 0x2C6, 0x2DA, 0x2DC]
    + list(range(0x2000, 0x2070))
    + [0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2197, 0x2212, 0x2215, 0xFEFF, 0xFFFD]
)
FEATURES = ["kern", "liga", "locl", "case", "mark", "mkmk", "ccmp", "rvrn", "onum", "lnum", "tnum", "pnum"]

FONTS = [
    ("Fraunces[SOFT,WONK,opsz,wght].ttf", "fraunces.woff2", {"SOFT": 100, "wght": (300, 800)}),
    ("Caveat[wght].ttf", "caveat.woff2", {"wght": 500}),
]


def make(source: str, target: str, axes: dict) -> None:
    font = TTFont(source, lazy=False)
    font = instancer.instantiateVariableFont(font, axes)
    # Reload the instance: the subsetter expects fully loaded tables.
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    font = TTFont(buffer, lazy=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = FEATURES
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]  # copyright, names, licence and its URL
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(target)
    print(f"{os.path.basename(target)}: {os.path.getsize(target) / 1024:.1f} KB")


def main() -> None:
    sources = sys.argv[1] if len(sys.argv) > 1 else "."
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets", "fonts")
    os.makedirs(out, exist_ok=True)
    for source, target, axes in FONTS:
        make(os.path.join(sources, source), os.path.join(out, target), axes)


if __name__ == "__main__":
    main()
