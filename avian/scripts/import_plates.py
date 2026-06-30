#!/usr/bin/env python3
"""AvianVisitors - import a folder of bird plates into the illustration set.

The bundled art is a set of full plates (this fork ships Audubon "Birds of
America" lithographs) named by COMMON name, e.g. `blue_jay.jpg`. The
frontend resolves images by SCIENTIFIC name though - cutout.php turns a
detection's `Calypte anna` into the slug `calypte-anna` and serves
`assets/illustrations/<slug>.{png,jpg}`. This script bridges the two:

    1. read every image in --source (common-name filenames)
    2. map each to a scientific name via the model's labels_en.json,
       restricted to the BirdNET vocabulary so the slug matches what a
       detection actually emits
    3. downscale to --max-edge and install as assets/illustrations/<slug>.jpg

Common-name matching is normalised (case, apostrophes, separators). A small
ALIAS table absorbs recent eBird/AOS renames the 6K v2.4 labels predate, and
PIN resolves the handful of common names the label set maps to two scientific
names (taxonomic splits) to whichever one the model ships.

Usage:
    # dry run - report matches, skips, and slug collisions
    python3 import_plates.py --source ~/plates

    # install (downscale to 1200px JPG); --replace clears the old set first
    python3 import_plates.py --source ~/plates --apply --replace

This replaces the generate -> cutout -> masks pipeline (pregen.py et al.)
for anyone supplying their own finished plates. See README.md.
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

# Recent eBird/AOS renames the BirdNET 6K v2.4 labels predate: filename
# common name -> the common name the model still uses.
ALIAS = {
    "american barn owl": "barn owl",
    "american goshawk": "northern goshawk",
    "northern house wren": "house wren",
    "hudsonian whimbrel": "whimbrel",
    "western cattle egret": "cattle egret",
    "northern yellow warbler": "yellow warbler",
    "eastern warbling vireo": "warbling vireo",
    "american herring gull": "herring gull",
}
# Common names the label set maps to two scientific names (splits). Pin each
# to the binomial that is actually in the model, by filename stem.
PIN = {
    "double_crested_cormorant": "Nannopterum auritum",
    "green_winged_teal": "Anas crecca",
    "ruby_crowned_kinglet": "Corthylio calendula",
}
# Filename stems whose species the BirdNET model doesn't know - never
# detected, so there's no slug to serve them under. Skipped.
SKIP = {"white_cheeked_pintail", "white_winged_scoter"}


def norm(s: str) -> str:
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[''.]", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slugify(sci: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", sci.lower())).strip("-")


def load_vocab(labels_en: str, model_labels: str):
    with open(labels_en, encoding="utf-8") as f:
        sci2com = json.load(f)
    with open(model_labels, encoding="utf-8") as f:
        model = set(l.strip() for l in f if l.strip())
    com2sci = {}
    for sci, com in sci2com.items():
        if sci in model:
            com2sci.setdefault(norm(com), []).append(sci)
    return com2sci


def resolve(stem: str, com2sci) -> str | None:
    if stem in SKIP:
        return None
    if stem in PIN:
        return PIN[stem]
    key = norm(stem.replace("_", " "))
    key = norm(ALIAS.get(key, key))
    cands = com2sci.get(key)
    return cands[0] if cands else None


def install(src: str, dst: str, max_edge: int, quality: int) -> int:
    from PIL import Image
    im = Image.open(src)
    if im.mode != "RGB":
        im = im.convert("RGB")
    w, h = im.size
    if max(w, h) > max_edge:
        scale = max_edge / max(w, h)
        im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
    return os.path.getsize(dst)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="folder of common-name-named plate images")
    ap.add_argument("--illustrations", default=os.path.join(REPO, "avian", "assets", "illustrations"))
    ap.add_argument("--labels-en", default=os.path.join(REPO, "model", "l18n", "labels_en.json"))
    ap.add_argument("--model-labels",
                    default=os.path.join(REPO, "model", "BirdNET_GLOBAL_6K_V2.4_Model_FP16_Labels.txt"))
    ap.add_argument("--max-edge", type=int, default=1200, help="downscale longest side to this many px")
    ap.add_argument("--quality", type=int, default=85, help="output JPEG quality")
    ap.add_argument("--apply", action="store_true", help="write files (default: dry run)")
    ap.add_argument("--replace", action="store_true",
                    help="clear assets/illustrations/ before installing")
    args = ap.parse_args()

    com2sci = load_vocab(args.labels_en, args.model_labels)
    files = sorted(glob.glob(os.path.join(args.source, "*.jpg")) +
                   glob.glob(os.path.join(args.source, "*.jpeg")) +
                   glob.glob(os.path.join(args.source, "*.png")))
    if not files:
        print(f"no images in {args.source}", file=sys.stderr)
        return 1

    plan, skipped, slugs = [], [], {}
    for p in files:
        stem = os.path.splitext(os.path.basename(p))[0]
        sci = resolve(stem, com2sci)
        if not sci:
            skipped.append(stem)
            continue
        slug = slugify(sci)
        slugs.setdefault(slug, []).append(stem)
        plan.append((p, slug))

    dupes = {k: v for k, v in slugs.items() if len(v) > 1}
    print(f"source: {len(files)} | mapped: {len(plan)} | skipped: {len(skipped)}")
    if skipped:
        print(f"skipped (not in model vocabulary): {sorted(skipped)}")
    if dupes:
        print(f"!! slug collisions (two files map to one species): {dupes}")

    if not args.apply:
        print("\n(dry run - pass --apply to install)")
        return 0

    if args.replace:
        n = 0
        for f in glob.glob(os.path.join(args.illustrations, "*")):
            os.remove(f)
            n += 1
        print(f"cleared {n} existing files from {args.illustrations}")

    os.makedirs(args.illustrations, exist_ok=True)
    total = 0
    for src, slug in plan:
        total += install(src, os.path.join(args.illustrations, slug + ".jpg"),
                         args.max_edge, args.quality)
    print(f"installed {len(plan)} plates ({total / 1e6:.1f} MB). "
          f"Bump IMG_VERSION in apt.js so browsers drop cached copies.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
