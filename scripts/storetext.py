"""Text rendering for the store assets, for Latin and for complex scripts.

Pillow draws a string codepoint by codepoint. That is fine for Latin, and wrong
for three of the seven store locales:

* Devanagari reorders the i-matra in front of its consonant and builds
  conjuncts, so ``कि`` comes out as ``क`` followed by a stray vowel sign;
* Arabic letters change shape by position and run right to left, so an
  unshaped string renders as disconnected isolated forms in reverse;
* Chinese is fine glyph-wise but needs a font that actually has the glyphs.

The Pillow build available here has no Raqm, so the shaping happens here:
HarfBuzz (uharfbuzz) produces glyph ids and positions, fontTools supplies the
outlines, and the contours are filled with an even-odd rule — nested contours
of a glyph never overlap, so XOR gives the counters (the hole in "ओ") for free.

Latin keeps the original Pillow path, so the German and English assets render
byte for byte as before.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

# Supersampling factor of the glyph masks. Three is enough to make the edges
# indistinguishable from Pillow's own antialiasing at these sizes.
OVERSAMPLE = 3

# Flattening steps per Bézier segment. Headlines run up to ~100 px, where more
# steps stop being visible.
CURVE_STEPS = 12


def _windows_font(name: str) -> Path | None:
    path = Path("C:/Windows/Fonts") / name
    return path if path.exists() else None


def _first_existing(*names: str) -> Path | None:
    for name in names:
        found = _windows_font(name)
        if found is not None:
            return found
    return None


@dataclass(frozen=True)
class ScriptFont:
    """A font file for one script, plus the face index inside a collection."""

    path: Path
    index: int = 0


def script_font(script: str) -> ScriptFont:
    """Font file for a script, or a clear error naming what is missing."""
    if script == "han":
        found = _first_existing("msyh.ttc", "msyhbd.ttc", "simsun.ttc")
        missing = "Microsoft YaHei (msyh.ttc)"
    elif script == "devanagari":
        found = _first_existing("Nirmala.ttc", "mangal.ttf")
        missing = "Nirmala UI (Nirmala.ttc)"
    elif script == "arabic":
        found = _first_existing("segoeui.ttf", "tahoma.ttf", "arabtype.ttf")
        missing = "Segoe UI (segoeui.ttf)"
    else:
        raise ValueError(f"no font mapping for script {script!r}")
    if found is None:
        raise RuntimeError(
            f"{missing} not found under C:/Windows/Fonts · the store assets for "
            f"the {script} locales cannot be rendered without it."
        )
    return ScriptFont(found)


# --------------------------------------------------------------------------- #
# shaping
# --------------------------------------------------------------------------- #


@lru_cache(maxsize=8)
def _hb_font(path: str, index: int):
    import uharfbuzz as hb

    blob = hb.Blob.from_file_path(path)
    face = hb.Face(blob, index)
    return hb.Font(face), face.upem


@lru_cache(maxsize=8)
def _tt_glyphset(path: str, index: int):
    from fontTools.ttLib import TTFont

    # A .ttc needs the face index; a plain .ttf ignores it.
    font = TTFont(path, fontNumber=index, lazy=True)
    return font.getGlyphSet(), font.getGlyphOrder()


@lru_cache(maxsize=4096)
def _glyph_contours(path: str, index: int, gid: int) -> tuple[tuple[tuple[float, float], ...], ...]:
    """Flattened outline of one glyph in font units, y pointing up."""
    from fontTools.pens.basePen import BasePen

    glyph_set, order = _tt_glyphset(path, index)
    if gid >= len(order):
        return ()
    name = order[gid]

    class PolygonPen(BasePen):
        def __init__(self) -> None:
            super().__init__(glyph_set)
            self.contours: list[list[tuple[float, float]]] = []
            self._current: list[tuple[float, float]] = []

        def _moveTo(self, pt):
            self._finish()
            self._current = [pt]

        def _lineTo(self, pt):
            self._current.append(pt)

        def _curveToOne(self, p1, p2, p3):
            p0 = self._current[-1] if self._current else p1
            for step in range(1, CURVE_STEPS + 1):
                t = step / CURVE_STEPS
                u = 1 - t
                x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
                y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
                self._current.append((x, y))

        def _closePath(self):
            self._finish()

        def _endPath(self):
            self._finish()

        def _finish(self):
            if len(self._current) > 2:
                self.contours.append(self._current)
            self._current = []

    pen = PolygonPen()
    try:
        glyph_set[name].draw(pen)
    except Exception:  # noqa: BLE001 — a broken glyph must not stop the render
        return ()
    pen._finish()
    return tuple(tuple(contour) for contour in pen.contours)


def _runs(text: str, base_rtl: bool) -> list[tuple[str, bool]]:
    """Split a line into directional runs, in logical order.

    HarfBuzz shapes one direction per buffer, so "chess.com وLichess" has to be
    handed over in pieces. Strong characters set the direction, neutrals (spaces,
    punctuation) inherit it from what came before, and European digits count as
    left-to-right — which is how Arabic typesets them.
    """
    import unicodedata

    directions: list[bool] = []
    current = base_rtl
    for char in text:
        kind = unicodedata.bidirectional(char)
        if kind in ("R", "AL", "AN"):
            current = True
        elif kind in ("L", "EN"):
            current = False
        directions.append(current)

    # A neutral tail (trailing space, full stop) belongs to the run before it,
    # which the inheritance above already does; nothing else to fix up.
    runs: list[tuple[str, bool]] = []
    for char, rtl in zip(text, directions):
        if runs and runs[-1][1] == rtl:
            runs[-1] = (runs[-1][0] + char, rtl)
        else:
            runs.append((char, rtl))
    return runs


@dataclass
class _ShapedGlyph:
    gid: int
    x: float
    y: float


def _shape_run(text: str, face: ScriptFont, size: float, rtl: bool) -> tuple[list[_ShapedGlyph], float]:
    """Glyphs of one directional run in visual order, plus its advance width."""
    import uharfbuzz as hb

    hb_font, upem = _hb_font(str(face.path), face.index)
    scale = size / upem

    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    buffer.direction = "rtl" if rtl else "ltr"
    hb.shape(hb_font, buffer, {"kern": True, "liga": True})

    glyphs: list[_ShapedGlyph] = []
    cursor = 0.0
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        glyphs.append(
            _ShapedGlyph(
                gid=info.codepoint,
                x=(cursor + position.x_offset) * scale,
                y=position.y_offset * scale,
            )
        )
        cursor += position.x_advance
    return glyphs, cursor * scale


def _shape(text: str, face: ScriptFont, size: float, base_rtl: bool) -> tuple[list[_ShapedGlyph], float, float]:
    """A whole line in visual order, plus its advance width and ascent, in pixels."""
    hb_font, upem = _hb_font(str(face.path), face.index)

    shaped = [(_shape_run(run, face, size, rtl)) for run, rtl in _runs(text, base_rtl)]
    total = sum(advance for _, advance in shaped)

    glyphs: list[_ShapedGlyph] = []
    # In a right-to-left line the first logical run sits furthest right.
    cursor = total if base_rtl else 0.0
    for run_glyphs, advance in shaped:
        origin = cursor - advance if base_rtl else cursor
        for glyph in run_glyphs:
            glyphs.append(_ShapedGlyph(gid=glyph.gid, x=origin + glyph.x, y=glyph.y))
        cursor = origin if base_rtl else cursor + advance

    extents = hb_font.get_font_extents("ltr")
    return glyphs, total, extents.ascender * (size / upem)


def _glyph_mask(face: ScriptFont, gid: int, size: float, box: tuple[int, int], origin: tuple[float, float]) -> Image.Image | None:
    """One glyph as an L mask, even-odd filled so counters stay open."""
    contours = _glyph_contours(str(face.path), face.index, gid)
    if not contours:
        return None
    hb_font, upem = _hb_font(str(face.path), face.index)
    scale = size / upem
    mask = Image.new("1", box, 0)
    for contour in contours:
        layer = Image.new("1", box, 0)
        points = [
            (origin[0] + x * scale, origin[1] - y * scale)
            for x, y in contour
        ]
        ImageDraw.Draw(layer).polygon(points, fill=1)
        mask = ImageChops.logical_xor(mask, layer)
    return mask


# --------------------------------------------------------------------------- #
# typefaces
# --------------------------------------------------------------------------- #


class Typeface:
    """Common surface for the Pillow path and the shaped path."""

    size: int

    def length(self, text: str, tracking: float = 0.0) -> float:
        raise NotImplementedError

    def draw(
        self,
        canvas: Image.Image,
        xy: tuple[float, float],
        text: str,
        fill: tuple[int, int, int],
        tracking: float = 0.0,
    ) -> None:
        raise NotImplementedError

    def line_height(self) -> float:
        return self.size * 1.28


class PilTypeface(Typeface):
    """Inter through Pillow · letter tracking is applied per character."""

    def __init__(self, typeface: ImageFont.FreeTypeFont, size: int) -> None:
        self._font = typeface
        self.size = size

    @property
    def font(self) -> ImageFont.FreeTypeFont:
        return self._font

    def length(self, text: str, tracking: float = 0.0) -> float:
        if not text:
            return 0.0
        return sum(self._font.getlength(char) for char in text) + tracking * (len(text) - 1)

    def draw(self, canvas, xy, text, fill, tracking=0.0) -> None:
        draw = ImageDraw.Draw(canvas)
        x, y = xy
        for char in text:
            draw.text((x, y), char, fill=fill, font=self._font)
            x += self._font.getlength(char) + tracking


class ShapedTypeface(Typeface):
    """HarfBuzz-shaped rendering for Chinese, Devanagari and Arabic.

    Tracking is ignored on purpose: letter spacing breaks Arabic joining and
    pulls Devanagari clusters apart, and CJK does not want it either.
    """

    def __init__(self, face: ScriptFont, size: int, rtl: bool) -> None:
        self.face = face
        self.size = size
        self.rtl = rtl

    def length(self, text: str, tracking: float = 0.0) -> float:
        if not text:
            return 0.0
        _, advance, _ = _shape(text, self.face, self.size, self.rtl)
        return advance

    def draw(self, canvas, xy, text, fill, tracking=0.0) -> None:
        if not text:
            return
        scale = OVERSAMPLE
        glyphs, advance, ascent = _shape(text, self.face, self.size * scale, self.rtl)
        width = max(1, int(advance) + 4 * scale)
        height = max(1, int(self.size * scale * 2.0))
        baseline = ascent
        box = (width, height)

        mask = Image.new("1", box, 0)
        for glyph in glyphs:
            glyph_mask = _glyph_mask(
                self.face, glyph.gid, self.size * scale, box, (glyph.x, baseline - glyph.y)
            )
            if glyph_mask is not None:
                mask = ImageChops.logical_or(mask, glyph_mask)

        smooth = mask.convert("L").resize(
            (max(1, width // scale), max(1, height // scale)), Image.Resampling.LANCZOS
        )
        layer = Image.new("RGBA", smooth.size, (*fill, 0))
        layer.putalpha(smooth)
        # Pillow's default text anchor puts the ascender at y · match that so
        # every call site keeps its existing vertical rhythm.
        canvas.alpha_composite(layer, (round(xy[0]), round(xy[1])))

    def line_height(self) -> float:
        return self.size * 1.34


# Scripts by store locale. Everything not listed uses Inter through Pillow.
LOCALE_SCRIPT = {
    "zh-CN": "han",
    "hi-IN": "devanagari",
    "ar": "arabic",
}

RTL_LOCALES = {"ar"}


def is_shaped(locale: str) -> bool:
    return locale in LOCALE_SCRIPT


def check_available(locales: list[str]) -> None:
    """Fail early and loudly rather than after twenty minutes of rendering."""
    missing_libs = []
    for module in ("uharfbuzz", "fontTools"):
        try:
            __import__(module)
        except ImportError:
            missing_libs.append(module)
    needed = [locale for locale in locales if is_shaped(locale)]
    if needed and missing_libs:
        raise RuntimeError(
            "The locales "
            + ", ".join(needed)
            + " need text shaping. Install it with: pip install "
            + " ".join("uharfbuzz" if m == "uharfbuzz" else "fonttools" for m in missing_libs)
        )
    for locale in needed:
        script_font(LOCALE_SCRIPT[locale])


def make(
    locale: str,
    pil_font: ImageFont.FreeTypeFont,
    size: int,
) -> Typeface:
    """Typeface for a locale · Inter for Latin, a shaped face otherwise."""
    script = LOCALE_SCRIPT.get(locale)
    if script is None:
        return PilTypeface(pil_font, size)
    return ShapedTypeface(script_font(script), size, locale in RTL_LOCALES)


if __name__ == "__main__":  # pragma: no cover — manual smoke test
    samples = {
        "zh-CN": "理解每一着棋",
        "hi-IN": "अपनी बाज़ी समझें",
        "ar": "افهم كل نقلة",
    }
    canvas = Image.new("RGBA", (900, 340), (14, 14, 13, 255))
    y = 30
    for locale, text in samples.items():
        make(locale, None, 64).draw(canvas, (40, y), text, (242, 241, 236))
        y += 100
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "shaping-sample.png")
    canvas.convert("RGB").save(out)
    print(f"wrote {out}")
