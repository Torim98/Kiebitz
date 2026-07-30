"""Compose branded Google Play assets (v3) from the reproducible Kiebitz captures.

Design goals over v2:

* real Android device frames with bezel, rim light, and a synthetic status bar,
* large editorial headlines with a mint accent line and an eyebrow pill,
* one continuous backdrop stitched across the whole screenshot series, so the
  Play Store carousel reads as a single scene,
* devices tilted and bled off the canvas edge for depth.

The source captures in ``artifacts/store-assets/`` are never modified.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


TARGETS = {
    "phone": (1080, 1920),
    "tablet-7": (1080, 1920),
    "tablet-10": (1920, 1080),
    "chromebook": (1920, 1080),
}
LOCALES = ("de-DE", "en-US")

INK = "#f5f4ef"
INK_2 = "#b4c1ba"
INK_3 = "#6d7a73"
ACCENT = "#3ddc9a"
ACCENT_DEEP = "#0a2b20"
DEEP_1 = "#13241e"
DEEP_2 = "#070d0b"

COPY = {
    "de-DE": {
        "01-dashboard": {
            "eyebrow": "100 % OFFLINE",
            "head": ("DEIN SCHACH.", "DEINE DATEN."),
            "sub": "Ratings, Partien und Fortschritt aus\nchess.com und Lichess – auf deinem Gerät.",
        },
        "02-analysis": {
            "eyebrow": "STOCKFISH AN BORD",
            "head": ("VERSTEHE", "JEDEN ZUG."),
            "sub": "Volle Engine-Stärke direkt im Gerät.\nOhne Cloud, ohne Konto, ohne Wartezeit.",
        },
        "03-insights": {
            "eyebrow": "SCHWÄCHEN FINDEN",
            "head": ("ERKENNE", "DEINE MUSTER."),
            "sub": "Genauigkeit nach Spielphase, Eröffnungs-\nbilanz und wiederkehrende Fehler.",
        },
        "04-study": {
            "eyebrow": "TRAININGSPLAN",
            "head": ("TRAINIERE", "MIT PLAN."),
            "sub": "Tägliche Einheiten, die aus deinen\neigenen Partien entstehen.",
        },
        "05-repertoire": {
            "eyebrow": "SPACED REPETITION",
            "head": ("BAUE DEIN", "REPERTOIRE."),
            "sub": "Eröffnungen anlegen, wiederholen und\ndauerhaft im Kopf behalten.",
        },
        "06-puzzles": {
            "eyebrow": "TAKTIK",
            "head": ("LERNE AUS", "FEHLERN."),
            "sub": "Puzzles aus kuratierten Stellungen und\naus deinen eigenen Niederlagen.",
        },
    },
    "en-US": {
        "01-dashboard": {
            "eyebrow": "100% OFFLINE",
            "head": ("YOUR CHESS.", "YOUR DATA."),
            "sub": "Ratings, games and progress from\nchess.com and Lichess – on your device.",
        },
        "02-analysis": {
            "eyebrow": "STOCKFISH ON BOARD",
            "head": ("UNDERSTAND", "EVERY MOVE."),
            "sub": "Full engine strength on the device.\nNo cloud, no account, no waiting.",
        },
        "03-insights": {
            "eyebrow": "YOUR PATTERNS",
            "head": ("SPOT YOUR", "PATTERNS."),
            "sub": "Accuracy by game phase, opening\nrecord and recurring mistakes.",
        },
        "04-study": {
            "eyebrow": "TRAINING PLAN",
            "head": ("TRAIN WITH", "A PLAN."),
            "sub": "Daily sessions generated from\nyour own games.",
        },
        "05-repertoire": {
            "eyebrow": "SPACED REPETITION",
            "head": ("BUILD YOUR", "REPERTOIRE."),
            "sub": "Add openings, review them and\nmake them stick for good.",
        },
        "06-puzzles": {
            "eyebrow": "TACTICS",
            "head": ("LEARN FROM", "MISTAKES."),
            "sub": "Puzzles from curated positions and\nfrom the games you lost.",
        },
    },
}

FEATURE_COPY = {
    "de-DE": ("VERSTEHE", "DEIN SPIEL.", "Analyse · Insights · Training", "LOKAL · PRIVAT · OHNE KONTO"),
    "en-US": ("UNDERSTAND", "YOUR GAME.", "Analysis · Insights · Training", "LOCAL · PRIVATE · NO ACCOUNT"),
}


# --------------------------------------------------------------------------- #
# primitives
# --------------------------------------------------------------------------- #


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def mix(
    start: tuple[int, int, int], end: tuple[int, int, int], amount: float
) -> tuple[int, int, int]:
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def font_file(repo_root: Path) -> Path:
    path = (
        repo_root
        / "node_modules"
        / "@fontsource-variable"
        / "inter"
        / "files"
        / "inter-latin-wght-normal.woff2"
    )
    if not path.exists():
        raise RuntimeError(f"Inter font not found: {path}")
    return path


_FONT_CACHE: dict[tuple[int, int], ImageFont.FreeTypeFont] = {}


def font(repo_root: Path, size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    key = (size, weight)
    cached = _FONT_CACHE.get(key)
    if cached is None:
        cached = ImageFont.truetype(font_file(repo_root), size)
        cached.set_variation_by_axes([weight])
        _FONT_CACHE[key] = cached
    return cached


def blend(canvas: Image.Image, layer: Image.Image, x: int, y: int) -> None:
    """alpha_composite that tolerates layers reaching outside the canvas."""
    canvas_width, canvas_height = canvas.size
    left = max(0, -x)
    top = max(0, -y)
    right = min(layer.width, canvas_width - x)
    bottom = min(layer.height, canvas_height - y)
    if right <= left or bottom <= top:
        return
    canvas.alpha_composite(layer.crop((left, top, right, bottom)), (x + left, y + top))


def vertical_gradient(
    size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]
) -> Image.Image:
    width, height = size
    strip = Image.new("RGB", (1, height))
    pixels = strip.load()
    for y in range(height):
        amount = y / max(height - 1, 1)
        pixels[0, y] = mix(top, bottom, amount * amount * (3 - 2 * amount))
    return strip.resize(size, Image.Resampling.BILINEAR)


def soft_blob(
    size: tuple[int, int],
    box: tuple[float, float, float, float],
    color: tuple[int, int, int],
    alpha: int,
    blur: float,
    scale: int = 6,
) -> Image.Image:
    """A heavily blurred ellipse, computed at 1/scale for speed."""
    width, height = size
    small = (max(1, width // scale), max(1, height // scale))
    layer = Image.new("RGBA", small, (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        tuple(value / scale for value in box), fill=(*color, alpha)
    )
    layer = layer.filter(ImageFilter.GaussianBlur(max(2.0, blur / scale)))
    return layer.resize(size, Image.Resampling.BICUBIC)


def chessboard_overlay(
    size: tuple[int, int], cell: int, angle: float, alpha: int, offset: float = 0.0
) -> Image.Image:
    """A rotated checker grid drawn as polygons, cheap at any canvas size."""
    width, height = size
    overlay = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    radians = math.radians(angle)
    cos_a, sin_a = math.cos(radians), math.sin(radians)
    reach = int(math.hypot(width, height) / cell) + 3
    for row in range(-reach, reach):
        for column in range(-reach, reach):
            if (row + column) % 2:
                continue
            points = []
            for u, v in ((column, row), (column + 1, row), (column + 1, row + 1), (column, row + 1)):
                x = (u * cell + offset) * cos_a - (v * cell) * sin_a + width * 0.5
                y = (u * cell + offset) * sin_a + (v * cell) * cos_a + height * 0.5
                points.append((x, y))
            draw.polygon(points, fill=(245, 244, 239, alpha))
    return overlay


def tracked_width(text: str, typeface: ImageFont.FreeTypeFont, tracking: float) -> float:
    if not text:
        return 0.0
    return sum(typeface.getlength(char) for char in text) + tracking * (len(text) - 1)


def tracked_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    fill: tuple[int, int, int],
    typeface: ImageFont.FreeTypeFont,
    tracking: float,
) -> None:
    x, y = xy
    for char in text:
        draw.text((x, y), char, fill=fill, font=typeface)
        x += typeface.getlength(char) + tracking


def fit_font(
    repo_root: Path,
    lines: tuple[str, ...],
    max_width: int,
    start_size: int,
    minimum_size: int,
    weight: int,
    tracking_ratio: float,
) -> ImageFont.FreeTypeFont:
    for size in range(start_size, minimum_size - 1, -2):
        candidate = font(repo_root, size, weight)
        tracking = size * tracking_ratio
        if max(tracked_width(line, candidate, tracking) for line in lines) <= max_width:
            return candidate
    return font(repo_root, minimum_size, weight)


def paste_rotated(
    canvas: Image.Image,
    layer: Image.Image,
    center: tuple[int, int],
    angle: float,
    shadow_blur: int = 46,
    shadow_offset: tuple[int, int] = (0, 30),
    shadow_alpha: int = 185,
) -> None:
    rotated = layer.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    pad = shadow_blur * 3
    padded = Image.new(
        "RGBA", (rotated.width + 2 * pad, rotated.height + 2 * pad), (0, 0, 0, 0)
    )
    padded.alpha_composite(rotated, (pad, pad))

    shadow = Image.new("RGBA", padded.size, (0, 0, 0, 0))
    shadow.putalpha(padded.split()[3].point(lambda value: value * shadow_alpha // 255))
    shadow = shadow.filter(ImageFilter.GaussianBlur(shadow_blur))

    x = center[0] - padded.width // 2
    y = center[1] - padded.height // 2
    blend(canvas, shadow, x + shadow_offset[0], y + shadow_offset[1])
    blend(canvas, padded, x, y)


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255
    )
    return mask


# --------------------------------------------------------------------------- #
# device frames
# --------------------------------------------------------------------------- #


def status_bar(
    repo_root: Path, width: int, height: int, background: tuple[int, int, int]
) -> Image.Image:
    bar = Image.new("RGBA", (width, height), (*background, 255))
    draw = ImageDraw.Draw(bar)
    center_y = height / 2

    clock = font(repo_root, round(height * 0.52), 620)
    draw.text(
        (round(width * 0.07), center_y),
        "20:41",
        fill=hex_rgb(INK),
        font=clock,
        anchor="lm",
    )

    ink = hex_rgb(INK_2)
    right = width - round(width * 0.06)

    # battery
    body_width = round(height * 0.62)
    body_height = round(height * 0.34)
    body_x = right - body_width
    body_y = center_y - body_height / 2
    draw.rounded_rectangle(
        (body_x, body_y, body_x + body_width, body_y + body_height),
        radius=round(body_height * 0.28),
        outline=ink,
        width=max(2, height // 22),
    )
    draw.rectangle(
        (
            right + max(2, height // 20),
            center_y - body_height * 0.22,
            right + max(4, height // 9),
            center_y + body_height * 0.22,
        ),
        fill=ink,
    )
    inset = max(2, height // 16)
    draw.rounded_rectangle(
        (
            body_x + inset,
            body_y + inset,
            body_x + inset + (body_width - 2 * inset) * 0.72,
            body_y + body_height - inset,
        ),
        radius=round(body_height * 0.16),
        fill=hex_rgb(ACCENT),
    )

    # wifi
    wifi_right = body_x - round(height * 0.30)
    wifi_size = round(height * 0.46)
    for index in range(3):
        scale = (index + 1) / 3
        radius = wifi_size * scale
        draw.arc(
            (
                wifi_right - radius,
                center_y + wifi_size * 0.30 - radius,
                wifi_right + radius,
                center_y + wifi_size * 0.30 + radius,
            ),
            start=225,
            end=315,
            fill=ink,
            width=max(2, height // 22),
        )
    draw.ellipse(
        (
            wifi_right - height * 0.035,
            center_y + wifi_size * 0.22,
            wifi_right + height * 0.035,
            center_y + wifi_size * 0.29,
        ),
        fill=ink,
    )

    # signal bars
    bar_right = wifi_right - round(height * 0.52)
    bar_width = max(3, round(height * 0.09))
    gap = max(2, round(height * 0.06))
    for index in range(4):
        bar_height = height * (0.16 + index * 0.09)
        x1 = bar_right - (3 - index) * (bar_width + gap)
        draw.rounded_rectangle(
            (x1, center_y + height * 0.20 - bar_height, x1 + bar_width, center_y + height * 0.20),
            radius=1,
            fill=ink,
        )

    # punch-hole camera
    hole = round(height * 0.44)
    draw.ellipse(
        (
            width / 2 - hole / 2,
            center_y - hole / 2,
            width / 2 + hole / 2,
            center_y + hole / 2,
        ),
        fill=(4, 6, 5, 255),
        outline=(255, 255, 255, 26),
        width=2,
    )
    return bar


def device_frame(
    repo_root: Path,
    capture: Image.Image,
    screen_width: int,
    *,
    with_status_bar: bool = True,
    corner_ratio: float = 0.085,
) -> Image.Image:
    """A dark Android-style frame around the capture, at the capture's aspect."""
    screen_height = round(screen_width * capture.height / capture.width)
    bar_height = round(screen_width * 0.058) if with_status_bar else 0

    screen = Image.new("RGBA", (screen_width, screen_height + bar_height))
    fitted = ImageOps.fit(
        capture.convert("RGB"), (screen_width, screen_height), Image.Resampling.LANCZOS
    )
    if bar_height:
        background = fitted.getpixel((4, 4))
        screen.paste(status_bar(repo_root, screen_width, bar_height, background), (0, 0))
    screen.paste(fitted, (0, bar_height))

    bezel = max(6, round(screen_width * 0.026))
    outer_radius = round(screen_width * corner_ratio) + bezel
    inner_radius = max(4, outer_radius - bezel)
    width = screen_width + 2 * bezel
    height = screen.height + 2 * bezel

    frame = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    body = vertical_gradient((width, height), hex_rgb("#4a534f"), hex_rgb("#0d1210"))
    frame.paste(body, (0, 0), rounded_mask((width, height), outer_radius))

    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle(
        (bezel - 3, bezel - 3, width - bezel + 2, height - bezel + 2),
        radius=inner_radius + 3,
        fill=(3, 5, 4, 255),
    )

    rounded_screen = Image.new("RGBA", screen.size, (0, 0, 0, 0))
    rounded_screen.paste(screen, (0, 0), rounded_mask(screen.size, inner_radius))
    frame.alpha_composite(rounded_screen, (bezel, bezel))

    draw.rounded_rectangle(
        (0, 0, width - 1, height - 1),
        radius=outer_radius,
        outline=(255, 255, 255, 52),
        width=max(2, bezel // 6),
    )
    draw.rounded_rectangle(
        (2, 2, width - 3, height - 3),
        radius=outer_radius - 2,
        outline=(*hex_rgb(ACCENT), 46),
        width=max(2, bezel // 8),
    )
    return frame


# --------------------------------------------------------------------------- #
# backdrop
# --------------------------------------------------------------------------- #


def build_backdrop(slide: tuple[int, int], count: int) -> Image.Image:
    """One wide scene; every slide crops its own window out of it."""
    slide_width, height = slide
    width = slide_width * count
    canvas = vertical_gradient(
        (width, height), hex_rgb(DEEP_1), hex_rgb(DEEP_2)
    ).convert("RGBA")

    canvas.alpha_composite(
        chessboard_overlay(
            (width, height),
            cell=max(96, slide_width // 6),
            angle=-19,
            alpha=9,
            offset=slide_width * 0.13,
        )
    )

    accent = hex_rgb(ACCENT)
    # a mint light that pulses evenly across the whole series: one node per slide
    # edge and one per slide centre, so no frame is left flat and the seams line
    # up when the carousel is swiped.
    nodes = [index * 0.5 for index in range(2 * count + 1)]
    for node_index, node in enumerate(nodes):
        center_x = node * slide_width
        radius_x = slide_width * 0.58
        radius_y = height * 0.44
        center_y = height * (0.30 if node_index % 2 == 0 else 0.66)
        canvas.alpha_composite(
            soft_blob(
                (width, height),
                (
                    center_x - radius_x,
                    center_y - radius_y,
                    center_x + radius_x,
                    center_y + radius_y,
                ),
                accent,
                24 if node_index % 4 in (0, 3) else 36,
                blur=slide_width * 0.28,
            )
        )

    # long diagonal glow band
    band = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    band_draw = ImageDraw.Draw(band)
    band_draw.polygon(
        [
            (-200, height * 0.94),
            (width * 0.30, height * 0.10),
            (width * 0.34, height * 0.10),
            (width * 0.04, height * 0.99),
        ],
        fill=(*accent, 26),
    )
    band_draw.polygon(
        [
            (width * 0.62, height * 1.05),
            (width + 260, height * 0.02),
            (width + 340, height * 0.02),
            (width * 0.70, height * 1.05),
        ],
        fill=(*accent, 20),
    )
    canvas.alpha_composite(band.filter(ImageFilter.GaussianBlur(slide_width * 0.05)))

    # bottom vignette keeps the bled devices anchored
    canvas.alpha_composite(
        soft_blob(
            (width, height),
            (-width * 0.1, height * 0.78, width * 1.1, height * 1.9),
            (0, 0, 0),
            120,
            blur=slide_width * 0.20,
        )
    )
    return canvas


def slide_backdrop(master: Image.Image, index: int, slide: tuple[int, int]) -> Image.Image:
    x = index * slide[0]
    return master.crop((x, 0, x + slide[0], slide[1])).copy()


# --------------------------------------------------------------------------- #
# text blocks
# --------------------------------------------------------------------------- #


def draw_wordmark(
    canvas: Image.Image, repo_root: Path, x: int, y: int, icon_size: int, text_size: int
) -> None:
    icon_path = repo_root / "src-tauri" / "icons" / "128x128@2x.png"
    with Image.open(icon_path) as source:
        icon = source.convert("RGBA").resize(
            (icon_size, icon_size), Image.Resampling.LANCZOS
        )
    canvas.alpha_composite(icon, (x, y))
    draw = ImageDraw.Draw(canvas)
    tracked_text(
        draw,
        (x + icon_size + round(icon_size * 0.34), y + icon_size * 0.5 - text_size * 0.62),
        "KIEBITZ",
        hex_rgb(INK),
        font(repo_root, text_size, 800),
        text_size * 0.13,
    )


def draw_eyebrow(
    canvas: Image.Image, repo_root: Path, x: int, y: int, text: str, size: int
) -> int:
    typeface = font(repo_root, size, 780)
    tracking = size * 0.14
    text_width = tracked_width(text, typeface, tracking)
    pad_x = round(size * 1.15)
    height = round(size * 2.35)
    pill = Image.new("RGBA", (round(text_width) + 2 * pad_x, height), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        (0, 0, pill.width - 1, height - 1), radius=height // 2, fill=(*hex_rgb(ACCENT), 255)
    )
    tracked_text(
        ImageDraw.Draw(pill),
        (pad_x, height / 2 - size * 0.68),
        text,
        hex_rgb(ACCENT_DEEP),
        typeface,
        tracking,
    )
    canvas.alpha_composite(pill, (x, y))
    return height


def shared_headline_font(
    repo_root: Path,
    headlines: list[tuple[str, str]],
    max_width: int,
    start_size: int,
    minimum_size: int,
) -> ImageFont.FreeTypeFont:
    """One size for the whole series, so the carousel headlines stay aligned."""
    lines = tuple(line for headline in headlines for line in headline)
    return fit_font(repo_root, lines, max_width, start_size, minimum_size, 880, -0.012)


def draw_headline(
    canvas: Image.Image,
    repo_root: Path,
    x: int,
    y: int,
    lines: tuple[str, str],
    typeface: ImageFont.FreeTypeFont,
) -> int:
    size = typeface.size
    tracking = size * -0.012
    leading = round(size * 0.94)
    draw = ImageDraw.Draw(canvas)
    for index, (line, color) in enumerate(zip(lines, (INK, ACCENT))):
        tracked_text(
            draw, (x, y + index * leading), line, hex_rgb(color), typeface, tracking
        )
    return leading * (len(lines) - 1) + round(size * 1.02)


def draw_sub(
    canvas: Image.Image, repo_root: Path, x: int, y: int, text: str, size: int
) -> int:
    typeface = font(repo_root, size, 460)
    draw = ImageDraw.Draw(canvas)
    spacing = round(size * 0.42)
    draw.multiline_text(
        (x, y), text, fill=hex_rgb(INK_2), font=typeface, spacing=spacing
    )
    box = draw.multiline_textbbox((x, y), text, font=typeface, spacing=spacing)
    return box[3] - y


# --------------------------------------------------------------------------- #
# slide renderers
# --------------------------------------------------------------------------- #


def device_halo(canvas: Image.Image, center: tuple[int, int], width: int) -> None:
    """A mint bloom that lifts the device off the near-black backdrop."""
    canvas.alpha_composite(
        soft_blob(
            canvas.size,
            (
                center[0] - width * 0.78,
                center[1] - width * 0.90,
                center[0] + width * 0.78,
                center[1] + width * 0.90,
            ),
            hex_rgb(ACCENT),
            46,
            blur=width * 0.34,
        )
    )


def render_portrait(
    backdrop: Image.Image,
    capture: Image.Image,
    copy: dict[str, object],
    repo_root: Path,
    index: int,
    headline_font: ImageFont.FreeTypeFont,
) -> Image.Image:
    canvas = backdrop
    margin = 84
    draw_wordmark(canvas, repo_root, margin, 66, 60, 27)

    y = 186
    y += draw_eyebrow(canvas, repo_root, margin, y, copy["eyebrow"], 25) + 34
    y += draw_headline(canvas, repo_root, margin, y, copy["head"], headline_font) + 20
    draw_sub(canvas, repo_root, margin + 3, y, copy["sub"], 35)

    screen_width = 830
    frame = device_frame(repo_root, capture, screen_width)
    angle = -4.0 if index % 2 == 0 else 4.0
    shift = 24 if index % 2 == 0 else -24
    center = (540 + shift, 706 + frame.height // 2)
    device_halo(canvas, center, screen_width)
    paste_rotated(
        canvas,
        frame,
        center,
        angle,
        shadow_blur=56,
        shadow_offset=(round(-angle * 3), 38),
    )
    return canvas.convert("RGB")


def render_landscape(
    backdrop: Image.Image,
    capture: Image.Image,
    copy: dict[str, object],
    repo_root: Path,
    index: int,
    headline_font: ImageFont.FreeTypeFont,
) -> Image.Image:
    canvas = backdrop
    margin = 104
    draw_wordmark(canvas, repo_root, margin, 82, 62, 28)

    y = 322
    y += draw_eyebrow(canvas, repo_root, margin, y, copy["eyebrow"], 26) + 34
    y += draw_headline(canvas, repo_root, margin, y, copy["head"], headline_font) + 20
    draw_sub(canvas, repo_root, margin + 3, y, copy["sub"], 33)

    screen_width = 1240
    frame = device_frame(
        repo_root, capture, screen_width, with_status_bar=False, corner_ratio=0.030
    )
    angle = -3.0 if index % 2 == 0 else 3.0
    center = (1566, 544)
    device_halo(canvas, center, round(screen_width * 0.60))
    paste_rotated(
        canvas,
        frame,
        center,
        angle,
        shadow_blur=52,
        shadow_offset=(round(-angle * 4), 34),
    )
    return canvas.convert("RGB")


def render_feature(
    captures: tuple[Image.Image, Image.Image], locale: str, repo_root: Path
) -> Image.Image:
    canvas = build_backdrop((1024, 500), 1)
    top_line, accent_line, tagline, trust = FEATURE_COPY[locale]
    margin = 56
    draw_wordmark(canvas, repo_root, margin, 40, 48, 22)

    y = 128
    y += draw_headline(
        canvas,
        repo_root,
        margin,
        y,
        (top_line, accent_line),
        shared_headline_font(repo_root, [(top_line, accent_line)], 480, 62, 40),
    ) + 10
    ImageDraw.Draw(canvas).text(
        (margin + 2, y),
        tagline,
        fill=hex_rgb(INK_2),
        font=font(repo_root, 24, 460),
    )
    draw_eyebrow(canvas, repo_root, margin, y + 60, trust, 18)

    device_halo(canvas, (790, 250), 300)
    for capture, screen_width, center, angle in (
        (captures[1], 224, (900, 222), 6.0),
        (captures[0], 236, (700, 268), -8.0),
    ):
        frame = device_frame(
            repo_root, capture, screen_width, with_status_bar=False, corner_ratio=0.075
        )
        paste_rotated(
            canvas,
            frame,
            center,
            angle,
            shadow_blur=26,
            shadow_offset=(round(-angle * 2), 16),
        )
    return canvas.convert("RGB")


# --------------------------------------------------------------------------- #
# pipeline
# --------------------------------------------------------------------------- #


def render_all(source_root: Path, output_root: Path, repo_root: Path) -> None:
    for locale in LOCALES:
        for device, target in TARGETS.items():
            source_dir = source_root / locale / device
            target_dir = output_root / locale / device
            target_dir.mkdir(parents=True, exist_ok=True)
            sources = sorted(source_dir.glob("*.png"))
            expected = 6 if device == "phone" else 4
            if len(sources) != expected:
                raise RuntimeError(
                    f"{source_dir}: expected {expected} captures, found {len(sources)}"
                )
            master = build_backdrop(target, len(sources))
            portrait = target[0] < target[1]
            for source_path in sources:
                if source_path.stem not in COPY[locale]:
                    raise RuntimeError(
                        f"Missing marketing copy for {locale}/{source_path.stem}"
                    )
            headlines = [COPY[locale][path.stem]["head"] for path in sources]
            headline_font = (
                shared_headline_font(repo_root, headlines, 1080 - 2 * 84, 104, 60)
                if portrait
                else shared_headline_font(repo_root, headlines, 760, 96, 50)
            )
            for index, source_path in enumerate(sources):
                backdrop = slide_backdrop(master, index, target)
                with Image.open(source_path) as capture:
                    renderer = render_portrait if portrait else render_landscape
                    rendered = renderer(
                        backdrop,
                        capture,
                        COPY[locale][source_path.stem],
                        repo_root,
                        index,
                        headline_font,
                    )
                rendered.save(target_dir / source_path.name, "PNG", optimize=True)

        phone_dir = source_root / locale / "phone"
        with Image.open(phone_dir / "02-analysis.png") as analysis, Image.open(
            phone_dir / "01-dashboard.png"
        ) as dashboard:
            feature = render_feature((analysis, dashboard), locale, repo_root)
        feature.save(output_root / locale / "feature-graphic.png", "PNG", optimize=True)


def contact_sheet(paths: list[Path], output: Path, columns: int) -> None:
    thumb_width = 380
    gap = 16
    border = 16
    thumbs: list[Image.Image] = []
    for path in paths:
        with Image.open(path) as image:
            thumb_height = round(thumb_width * image.height / image.width)
            thumbs.append(
                image.convert("RGB").resize(
                    (thumb_width, thumb_height), Image.Resampling.LANCZOS
                )
            )
    rows = math.ceil(len(thumbs) / columns)
    row_heights = [
        max(
            thumbs[index].height
            for index in range(row * columns, min((row + 1) * columns, len(thumbs)))
        )
        for row in range(rows)
    ]
    width = border * 2 + columns * thumb_width + (columns - 1) * gap
    height = border * 2 + sum(row_heights) + (rows - 1) * gap
    sheet = Image.new("RGB", (width, height), hex_rgb("#101010"))
    y = border
    for row in range(rows):
        for column in range(columns):
            index = row * columns + column
            if index >= len(thumbs):
                break
            sheet.paste(thumbs[index], (border + column * (thumb_width + gap), y))
        y += row_heights[row] + gap
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "PNG", optimize=True)


def build_previews(output_root: Path) -> None:
    previews = output_root / "previews"
    for locale, prefix in (("de-DE", "de"), ("en-US", "en")):
        for device in TARGETS:
            paths = sorted((output_root / locale / device).glob("*.png"))
            columns = 6 if device == "phone" else 4
            contact_sheet(paths, previews / f"{prefix}-{device}-strip.png", columns)


def validate(output_root: Path) -> dict[str, object]:
    records: list[dict[str, object]] = []
    for locale in LOCALES:
        candidates = [output_root / locale / "feature-graphic.png"]
        for device in TARGETS:
            candidates.extend(sorted((output_root / locale / device).glob("*.png")))
        for path in candidates:
            with Image.open(path) as image:
                expected = (
                    (1024, 500)
                    if path.name == "feature-graphic.png"
                    else TARGETS[path.parent.name]
                )
                has_alpha = "A" in image.getbands()
                ok = (
                    image.format == "PNG"
                    and image.size == expected
                    and not has_alpha
                    and path.stat().st_size <= 8 * 1024 * 1024
                )
                records.append(
                    {
                        "file": str(path.relative_to(output_root)),
                        "width": image.width,
                        "height": image.height,
                        "size": path.stat().st_size,
                        "channels": len(image.getbands()),
                        "hasAlpha": has_alpha,
                        "ok": ok,
                    }
                )
    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "assetCount": len(records),
        "passed": sum(bool(record["ok"]) for record in records),
        "failed": sum(not bool(record["ok"]) for record in records),
        "assets": records,
    }
    (output_root / "validation.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return result


def write_readme(output_root: Path, archive: Path) -> None:
    readme = f"""# Kiebitz – Google Play Store Assets v3

Marketing screenshots generated from the reproducible in-app captures in
`artifacts/store-assets/`. Regenerate with `npm run store-assets:marketing`.

## Look

* Android device frames with bezel, mint rim light and a synthetic status bar.
* Editorial headline (white line + mint line), eyebrow pill, supporting copy.
* One continuous backdrop stitched across each device series, so the Play Store
  carousel reads as a single scene when swiped.
* Devices tilted alternately and bled off the bottom edge for depth.

## Upload mapping

| Play Console field | Folder / file | Count | Resolution |
|---|---|---:|---:|
| Feature graphic | `feature-graphic.png` | 1 | 1024 × 500 |
| Phone screenshots | `phone/` | 6 | 1080 × 1920 |
| 7-inch tablet screenshots | `tablet-7/` | 4 | 1080 × 1920 |
| 10-inch tablet screenshots | `tablet-10/` | 4 | 1920 × 1080 |
| Chromebook screenshots | `chromebook/` | 4 | 1920 × 1080 |

The numeric filename prefixes define the upload order. All files are 24-bit RGB
PNGs without transparency. `validation.json` holds the technical checks; the
strips in `previews/` are for review only.

Archive: `{archive.name}`
"""
    (output_root / "README.md").write_text(readme, encoding="utf-8")


def package(output_root: Path, archive: Path) -> None:
    upload_files: list[Path] = []
    for locale in LOCALES:
        upload_files.append(output_root / locale / "feature-graphic.png")
        for device in TARGETS:
            upload_files.extend(sorted((output_root / locale / device).glob("*.png")))
    archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as zip_file:
        for path in upload_files:
            zip_file.write(path, path.relative_to(output_root).as_posix())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    output_root = args.output_root.resolve()
    source_root = args.source_root.resolve()
    if output_root == source_root:
        raise SystemExit("Output must differ from source; source assets are immutable.")

    render_all(source_root, output_root, repo_root)
    build_previews(output_root)
    result = validate(output_root)
    write_readme(output_root, args.archive)
    package(output_root, args.archive)
    if result["failed"]:
        raise SystemExit(f"{result['failed']} store assets failed validation")
    print(
        f"Rendered and validated {result['passed']} assets; archive: "
        f"{os.fspath(args.archive.resolve())}"
    )


if __name__ == "__main__":
    main()
