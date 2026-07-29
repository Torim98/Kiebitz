"""Compose branded Google Play assets from reproducible Kiebitz captures.

The source screenshots remain untouched. This renderer adds the marketing layer
(background, copy, framing, and decorative brand elements), creates contact
sheets, validates every upload asset, and builds a ZIP archive.
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
INK = "#f2f1ec"
INK_2 = "#b9b8ae"
INK_3 = "#8b8a82"
ACCENT = "#22c08a"
ACCENT_DIM = "#17835e"
BG = "#0e0e0d"
PANEL = "#171716"
LINE = "#3a3a37"

COPY = {
    "de-DE": {
        "01-dashboard": (
            "DEIN SCHACH.\nDEINE DATEN.",
            "Analyse und Training –\nlokal auf deinem Gerät.",
        ),
        "02-analysis": (
            "VERSTEHE\nJEDEN ZUG.",
            "Leistungsstarke Stockfish-Analyse\nohne Cloud.",
        ),
        "03-insights": (
            "ERKENNE DEINE\nMUSTER.",
            "Stärken, Eröffnungen und\nFehlerphasen im Überblick.",
        ),
        "04-study": (
            "TRAINIERE\nMIT PLAN.",
            "Tägliche Einheiten aus deinen\npersönlichen Schwächen.",
        ),
        "05-repertoire": (
            "BAUE DEIN\nREPERTOIRE.",
            "Eröffnungen wiederholen und\ndauerhaft festigen.",
        ),
        "06-puzzles": (
            "LERNE AUS\nDEINEN FEHLERN.",
            "Taktiktraining aus kuratierten\nund eigenen Partien.",
        ),
    },
    "en-US": {
        "01-dashboard": (
            "YOUR CHESS.\nYOUR DATA.",
            "Analysis and training –\nlocal to your device.",
        ),
        "02-analysis": (
            "UNDERSTAND\nEVERY MOVE.",
            "Powerful Stockfish analysis\nwithout the cloud.",
        ),
        "03-insights": (
            "SPOT YOUR\nPATTERNS.",
            "Strengths, openings and\nerror phases at a glance.",
        ),
        "04-study": (
            "TRAIN WITH\nA PLAN.",
            "Daily sessions built around\nyour personal weaknesses.",
        ),
        "05-repertoire": (
            "BUILD YOUR\nREPERTOIRE.",
            "Review openings and make\nthem stick.",
        ),
        "06-puzzles": (
            "LEARN FROM\nYOUR MISTAKES.",
            "Tactics from curated puzzles\nand your own games.",
        ),
    },
}


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def blend(
    start: tuple[int, int, int], end: tuple[int, int, int], amount: float
) -> tuple[int, int, int]:
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def font_path(repo_root: Path) -> Path:
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


def font(repo_root: Path, size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    result = ImageFont.truetype(font_path(repo_root), size)
    result.set_variation_by_axes([weight])
    return result


def gradient_background(size: tuple[int, int], variant: int) -> Image.Image:
    width, height = size
    top = hex_rgb(("#071711", "#081a14", "#091b15")[variant % 3])
    bottom = hex_rgb(BG)
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        amount = y / max(height - 1, 1)
        amount = amount * amount * (3 - 2 * amount)
        draw.line((0, y, width, y), fill=blend(top, bottom, amount))

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        (
            int(width * 0.48),
            int(height * 0.18),
            int(width * 1.12),
            int(height * 0.82),
        ),
        fill=(34, 192, 138, 38),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(max(70, width // 11)))
    image = Image.alpha_composite(image.convert("RGBA"), glow)

    texture = Image.new("RGBA", size, (0, 0, 0, 0))
    texture_draw = ImageDraw.Draw(texture)
    spacing = max(70, width // 12)
    origin_x = int(width * 0.72)
    origin_y = int(height * 0.63)
    for row in range(6):
        for column in range(6):
            x0 = origin_x + column * spacing
            y0 = origin_y + row * spacing
            if (row + column) % 2 == 0:
                texture_draw.rectangle(
                    (x0, y0, x0 + spacing, y0 + spacing),
                    fill=(242, 241, 236, 5),
                )
    return Image.alpha_composite(image, texture)


def cubic_bezier(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 90,
) -> list[tuple[float, float]]:
    points = []
    for index in range(steps + 1):
        t = index / steps
        mt = 1 - t
        x = (
            mt**3 * p0[0]
            + 3 * mt**2 * t * p1[0]
            + 3 * mt * t**2 * p2[0]
            + t**3 * p3[0]
        )
        y = (
            mt**3 * p0[1]
            + 3 * mt**2 * t * p1[1]
            + 3 * mt * t**2 * p2[1]
            + t**3 * p3[1]
        )
        points.append((x, y))
    return points


def decorate_background(image: Image.Image, portrait: bool, variant: int) -> None:
    width, height = image.size
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    if portrait:
        curves = [
            (
                (-80, height * 0.33),
                (width * 0.28, height * 0.25),
                (width * 0.55, height * 0.40),
                (width * 1.10, height * 0.27),
            ),
            (
                (-120, height * 0.37),
                (width * 0.25, height * 0.29),
                (width * 0.59, height * 0.44),
                (width * 1.12, height * 0.31),
            ),
        ]
        line_widths = (4, 2)
    else:
        curves = [
            (
                (-100, height * 0.77),
                (width * 0.27, height * 0.57),
                (width * 0.45, height * 0.92),
                (width * 1.08, height * 0.62),
            ),
            (
                (-100, height * 0.83),
                (width * 0.26, height * 0.63),
                (width * 0.47, height * 0.98),
                (width * 1.08, height * 0.68),
            ),
        ]
        line_widths = (5, 2)
    alphas = (34 + variant * 4, 18 + variant * 3)
    for curve, line_width, alpha in zip(curves, line_widths, alphas):
        draw.line(
            cubic_bezier(*curve),
            fill=(34, 192, 138, alpha),
            width=line_width,
            joint="curve",
        )
    image.alpha_composite(overlay)


def rounded_screenshot(
    source: Image.Image, size: tuple[int, int], radius: int
) -> Image.Image:
    fitted = ImageOps.fit(source.convert("RGB"), size, Image.Resampling.LANCZOS)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *size), radius=radius, fill=255)
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    result.paste(fitted, (0, 0), mask)
    border = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (1, 1, size[0] - 2, size[1] - 2),
        radius=radius,
        outline=(185, 184, 174, 42),
        width=3,
    )
    return Image.alpha_composite(result, border)


def paste_card(
    canvas: Image.Image,
    source: Image.Image,
    box: tuple[int, int, int, int],
    radius: int,
) -> None:
    x, y, width, height = box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (x + 8, y + 18, x + width + 8, y + height + 18),
        radius=radius,
        fill=(0, 0, 0, 178),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(18, radius // 2)))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(rounded_screenshot(source, (width, height), radius), (x, y))


def paste_wordmark(
    canvas: Image.Image, repo_root: Path, x: int, y: int, icon_size: int, text_size: int
) -> None:
    icon_path = repo_root / "src-tauri" / "icons" / "128x128.png"
    with Image.open(icon_path) as icon_source:
        icon = icon_source.convert("RGBA").resize(
            (icon_size, icon_size), Image.Resampling.LANCZOS
        )
    canvas.alpha_composite(icon, (x, y))
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (x + icon_size + round(icon_size * 0.36), y + round(icon_size * 0.08)),
        "KIEBITZ",
        fill=hex_rgb(INK_2),
        font=font(repo_root, text_size, 720),
        tracking=0,
    )


def text_height(
    draw: ImageDraw.ImageDraw,
    text: str,
    typeface: ImageFont.FreeTypeFont,
    spacing: int,
) -> int:
    box = draw.multiline_textbbox((0, 0), text, font=typeface, spacing=spacing)
    return box[3] - box[1]


def fitted_multiline_font(
    draw: ImageDraw.ImageDraw,
    repo_root: Path,
    text: str,
    max_width: int,
    start_size: int,
    minimum_size: int,
    weight: int,
) -> ImageFont.FreeTypeFont:
    for size in range(start_size, minimum_size - 1, -2):
        candidate = font(repo_root, size, weight)
        if max(draw.textlength(line, font=candidate) for line in text.splitlines()) <= max_width:
            return candidate
    return font(repo_root, minimum_size, weight)


def render_portrait(
    source: Image.Image,
    locale: str,
    stem: str,
    repo_root: Path,
    variant: int,
) -> Image.Image:
    canvas = gradient_background((1080, 1920), variant)
    decorate_background(canvas, portrait=True, variant=variant)
    paste_wordmark(canvas, repo_root, 72, 50, 44, 26)
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (1008, 62),
        f"{variant + 1:02d}",
        fill=hex_rgb(INK_3),
        font=font(repo_root, 24, 620),
        anchor="ra",
    )

    headline, subtitle = COPY[locale][stem]
    headline_font = font(repo_root, 78, 850)
    subtitle_font = font(repo_root, 28, 450)
    headline_y = 122
    headline_spacing = -3
    draw.multiline_text(
        (72, headline_y),
        headline,
        fill=hex_rgb(INK),
        font=headline_font,
        spacing=headline_spacing,
    )
    subtitle_y = (
        headline_y
        + text_height(draw, headline, headline_font, headline_spacing)
        + 24
    )
    draw.multiline_text(
        (74, subtitle_y),
        subtitle,
        fill=hex_rgb(INK_2),
        font=subtitle_font,
        spacing=7,
    )

    screen_width = 820
    screen_height = round(screen_width * 16 / 9)
    screen_y = 420
    paste_card(
        canvas,
        source,
        ((1080 - screen_width) // 2, screen_y, screen_width, screen_height),
        radius=40,
    )
    return canvas.convert("RGB")


def render_landscape(
    source: Image.Image,
    locale: str,
    stem: str,
    repo_root: Path,
    variant: int,
) -> Image.Image:
    canvas = gradient_background((1920, 1080), variant)
    decorate_background(canvas, portrait=False, variant=variant)
    paste_wordmark(canvas, repo_root, 92, 62, 48, 28)
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (1818, 72),
        f"{variant + 1:02d}",
        fill=hex_rgb(INK_3),
        font=font(repo_root, 26, 620),
        anchor="ra",
    )

    headline, subtitle = COPY[locale][stem]
    headline_font = fitted_multiline_font(
        draw,
        repo_root,
        headline,
        max_width=510,
        start_size=76,
        minimum_size=62,
        weight=850,
    )
    subtitle_font = font(repo_root, 29, 450)
    headline_y = 280
    headline_spacing = -3
    draw.multiline_text(
        (92, headline_y),
        headline,
        fill=hex_rgb(INK),
        font=headline_font,
        spacing=headline_spacing,
    )
    subtitle_y = (
        headline_y
        + text_height(draw, headline, headline_font, headline_spacing)
        + 28
    )
    draw.multiline_text(
        (94, subtitle_y),
        subtitle,
        fill=hex_rgb(INK_2),
        font=subtitle_font,
        spacing=8,
    )

    screen_width = 1200
    screen_height = round(screen_width * 9 / 16)
    paste_card(canvas, source, (650, 205, screen_width, screen_height), radius=38)
    return canvas.convert("RGB")


def render_feature(
    source: Image.Image, locale: str, repo_root: Path
) -> Image.Image:
    canvas = gradient_background((1024, 500), 0)
    decorate_background(canvas, portrait=False, variant=0)
    paste_wordmark(canvas, repo_root, 54, 42, 38, 21)
    draw = ImageDraw.Draw(canvas)
    title = "Verstehe dein Spiel." if locale == "de-DE" else "Understand your game."
    subtitle = (
        "Analyse · Insights · Training"
        if locale == "de-DE"
        else "Analysis · Insights · Training"
    )
    draw.text(
        (54, 162),
        title,
        fill=hex_rgb(INK),
        font=fitted_multiline_font(
            draw,
            repo_root,
            title,
            max_width=510,
            start_size=48,
            minimum_size=40,
            weight=820,
        ),
    )
    draw.text(
        (56, 227),
        subtitle,
        fill=hex_rgb(INK_2),
        font=font(repo_root, 24, 450),
    )
    draw.rounded_rectangle(
        (54, 302, 374, 360),
        radius=29,
        fill=hex_rgb(ACCENT),
    )
    draw.ellipse((76, 325, 86, 335), fill=(6, 34, 25))
    trust = "Lokal. Privat. Fokussiert." if locale == "de-DE" else "Local. Private. Focused."
    draw.text(
        (100, 314),
        trust,
        fill=(6, 34, 25),
        font=font(repo_root, 19, 720),
    )

    paste_card(canvas, source, (610, 88, 560, 315), radius=26)
    return canvas.convert("RGB")


def contact_sheet(paths: list[Path], output: Path, columns: int) -> None:
    thumb_width = 360
    gap = 14
    border = 14
    background = hex_rgb(BG)
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
    sheet = Image.new("RGB", (width, height), background)
    y = border
    for row in range(rows):
        for column in range(columns):
            index = row * columns + column
            if index >= len(thumbs):
                break
            x = border + column * (thumb_width + gap)
            sheet.paste(thumbs[index], (x, y))
        y += row_heights[row] + gap
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, "PNG", optimize=True)


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
    readme = f"""# Kiebitz – Google Play Store Assets v2

Branded marketing screenshots generated from the reproducible in-app captures.

## Upload mapping

| Play Console field | Folder / file | Count | Resolution |
|---|---|---:|---:|
| Feature graphic | `feature-graphic.png` | 1 | 1024 × 500 |
| Phone screenshots | `phone/` | 6 | 1080 × 1920 |
| 7-inch tablet screenshots | `tablet-7/` | 4 | 1080 × 1920 |
| 10-inch tablet screenshots | `tablet-10/` | 4 | 1920 × 1080 |
| Chromebook screenshots | `chromebook/` | 4 | 1920 × 1080 |

The numeric filename prefixes define the upload order. All files are 24-bit RGB
PNGs without transparency. `validation.json` contains the technical checks.
The contact sheets in `previews/` are for review only.

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


def render_all(source_root: Path, output_root: Path, repo_root: Path) -> None:
    for locale in LOCALES:
        for device in TARGETS:
            source_dir = source_root / locale / device
            target_dir = output_root / locale / device
            target_dir.mkdir(parents=True, exist_ok=True)
            sources = sorted(source_dir.glob("*.png"))
            expected = 6 if device == "phone" else 4
            if len(sources) != expected:
                raise RuntimeError(
                    f"{source_dir}: expected {expected} captures, found {len(sources)}"
                )
            for variant, source_path in enumerate(sources):
                stem = source_path.stem
                if stem not in COPY[locale]:
                    raise RuntimeError(f"Missing marketing copy for {locale}/{stem}")
                with Image.open(source_path) as source:
                    if TARGETS[device][0] < TARGETS[device][1]:
                        rendered = render_portrait(
                            source, locale, stem, repo_root, variant
                        )
                    else:
                        rendered = render_landscape(
                            source, locale, stem, repo_root, variant
                        )
                rendered.save(target_dir / source_path.name, "PNG", optimize=True)

        feature_source = source_root / locale / "tablet-10" / "02-analysis.png"
        with Image.open(feature_source) as source:
            feature = render_feature(source, locale, repo_root)
        feature.save(output_root / locale / "feature-graphic.png", "PNG", optimize=True)


def build_previews(output_root: Path) -> None:
    previews = output_root / "previews"
    for locale, prefix in (("de-DE", "de"), ("en-US", "en")):
        for device in TARGETS:
            paths = sorted((output_root / locale / device).glob("*.png"))
            columns = 3 if device == "phone" else 2
            contact_sheet(paths, previews / f"{prefix}-{device}-contact.png", columns)


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
