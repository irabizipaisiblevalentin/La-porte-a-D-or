#!/usr/bin/env python3
"""Downscale the choir's photographs for the website gallery.

The originals in `images/choir pics/images` are 1-2 MB camera JPEGs (422 MB in
total), which is far too heavy to ship with the site. This script produces two
web-sized copies of every photo:

  * `full/`  — 1600 px on the long edge, for the gallery lightbox and the
               carousel on any page;
  * `thumb/` —  640 px on the long edge, for the grid tiles.

Portrait shots keep their orientation, EXIF rotation is applied for real (so a
rotated phone photo is not sideways), and the result is progressive JPEG at a
quality that stays well inside "looks identical" territory.

Usage:
    python3 scripts/process-gallery-images.py

Re-running is safe: outputs are rewritten from the originals each time.
"""

from __future__ import annotations

import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageOps

SOURCE_DIR = os.path.join("images", "choir pics", "images")
OUT_ROOT = os.path.join("web", "public", "assets", "gallery", "choir")
FULL_DIR = os.path.join(OUT_ROOT, "full")
THUMB_DIR = os.path.join(OUT_ROOT, "thumb")
MANIFEST = os.path.join(OUT_ROOT, "manifest.json")

FULL_EDGE = 1400
THUMB_EDGE = 640
FULL_QUALITY = 78
THUMB_QUALITY = 76


def source_files() -> list[str]:
    if not os.path.isdir(SOURCE_DIR):
        sys.exit(f"Source directory not found: {SOURCE_DIR}")
    names = [
        name
        for name in os.listdir(SOURCE_DIR)
        if name.lower().endswith((".jpg", ".jpeg", ".png"))
    ]
    names.sort()
    return [os.path.join(SOURCE_DIR, name) for name in names]


def slug(name: str) -> str:
    stem = os.path.splitext(os.path.basename(name))[0]
    return stem.lower().replace(" ", "-").replace("_", "-")


def render(path: str) -> dict:
    """Produce the web-sized copies of one photo and describe the result."""
    key = slug(path)
    full_path = os.path.join(FULL_DIR, f"{key}.jpg")
    thumb_path = os.path.join(THUMB_DIR, f"{key}.jpg")

    with Image.open(path) as image:
        # Bake the EXIF orientation in, so sideways originals come out upright.
        image = ImageOps.exif_transpose(image)
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")

        width, height = image.size
        landscape = width >= height

        full = image.copy()
        full.thumbnail((FULL_EDGE, FULL_EDGE), Image.LANCZOS)
        full.save(full_path, "JPEG", quality=FULL_QUALITY, optimize=True, progressive=True)

        thumb = image.copy()
        thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
        thumb.save(thumb_path, "JPEG", quality=THUMB_QUALITY, optimize=True, progressive=True)

    return {
        "key": key,
        "full": f"/assets/gallery/choir/full/{key}.jpg",
        "thumb": f"/assets/gallery/choir/thumb/{key}.jpg",
        "width": width,
        "height": height,
        "orientation": "landscape" if landscape else "portrait",
    }


def main() -> None:
    files = source_files()
    os.makedirs(FULL_DIR, exist_ok=True)
    os.makedirs(THUMB_DIR, exist_ok=True)

    workers = max(1, (os.cpu_count() or 2))
    print(f"Processing {len(files)} photographs with {workers} workers…")

    entries: list[dict] = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for index, entry in enumerate(pool.map(render, files), start=1):
            entries.append(entry)
            if index % 25 == 0 or index == len(files):
                print(f"  {index}/{len(files)}")

    entries.sort(key=lambda item: item["key"])
    with open(MANIFEST, "w", encoding="utf-8") as handle:
        json.dump(entries, handle, indent=2)
        handle.write("\n")

    total_full = sum(
        os.path.getsize(os.path.join(FULL_DIR, f"{e['key']}.jpg")) for e in entries
    )
    total_thumb = sum(
        os.path.getsize(os.path.join(THUMB_DIR, f"{e['key']}.jpg")) for e in entries
    )
    print(f"Wrote {len(entries)} full + thumb images.")
    print(f"  full:  {total_full / 1024 / 1024:.1f} MB")
    print(f"  thumb: {total_thumb / 1024 / 1024:.1f} MB")
    print(f"  manifest: {MANIFEST}")


if __name__ == "__main__":
    main()
