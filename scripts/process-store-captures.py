"""Scale browser captures, build contact sheets, validate, and package store assets."""

from __future__ import annotations

import argparse
import json
import os
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps


TARGETS = {
    "phone": (1080, 1920),
    "tablet-7": (1080, 1920),
    "tablet-10": (1920, 1080),
    "chromebook": (1920, 1080),
}
LOCALES = ("de-DE", "en-US")


def resize_captures(raw_root: Path, output_root: Path) -> None:
    for locale in LOCALES:
        for device, size in TARGETS.items():
            source_dir = raw_root / locale / device
            target_dir = output_root / locale / device
            target_dir.mkdir(parents=True, exist_ok=True)
            sources = sorted(source_dir.glob("*.png"))
            expected = 6 if device == "phone" else 4
            if len(sources) != expected:
                raise RuntimeError(
                    f"{source_dir}: expected {expected} captures, found {len(sources)}"
                )
            for source in sources:
                with Image.open(source) as image:
                    rgb = image.convert("RGB")
                    if rgb.size != size:
                        rgb = rgb.resize(size, Image.Resampling.LANCZOS)
                    rgb.save(target_dir / source.name, "PNG", optimize=True)


def contact_sheet(paths: list[Path], output: Path, columns: int) -> None:
    thumb_width = 360
    gap = 14
    border = 14
    background = (12, 12, 12)
    thumbs: list[Image.Image] = []
    for path in paths:
        with Image.open(path) as image:
            thumb_height = round(thumb_width * image.height / image.width)
            thumbs.append(
                image.convert("RGB").resize(
                    (thumb_width, thumb_height), Image.Resampling.LANCZOS
                )
            )
    rows = (len(thumbs) + columns - 1) // columns
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


def build_previews(output_root: Path) -> None:
    previews = output_root / "previews"
    for locale, prefix in (("de-DE", "de"), ("en-US", "en")):
        for device in TARGETS:
            paths = sorted((output_root / locale / device).glob("*.png"))
            columns = 3 if device == "phone" else 2
            contact_sheet(paths, previews / f"{prefix}-{device}-contact.png", columns)


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


def package(output_root: Path, archive: Path) -> None:
    upload_files: list[Path] = []
    for locale in LOCALES:
        upload_files.append(output_root / locale / "feature-graphic.png")
        for device in TARGETS:
            upload_files.extend(sorted((output_root / locale / device).glob("*.png")))
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zip_file:
        for path in upload_files:
            zip_file.write(path, path.relative_to(output_root).as_posix())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw_root", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("archive", type=Path)
    args = parser.parse_args()
    resize_captures(args.raw_root, args.output_root)
    build_previews(args.output_root)
    result = validate(args.output_root)
    package(args.output_root, args.archive)
    if result["failed"]:
        raise SystemExit(f"{result['failed']} store assets failed validation")
    print(
        f"Processed {result['passed']} assets; archive: "
        f"{os.fspath(args.archive.resolve())}"
    )


if __name__ == "__main__":
    main()
