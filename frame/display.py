#!/usr/bin/env python3
"""Frame-Pi side: turn a collage screenshot into panel pixels and push it.

Runs on the Pi Zero W wired to the Inky Impression 13.3". Each invocation
(driven by a systemd timer, ~every 15 min) it:

  1. asks the site which species are in the window and builds a coarse
     SIGNATURE (species set + count brackets);
  2. refreshes the panel ONLY if that signature changed since last time --
     or if a daily "heal" refresh is due -- and never during quiet hours.
     E-ink refreshes are slow (~30s) and flash, so we don't fire one when
     nothing meaningful changed;
  3. obtains the screenshot (a local file from shoot.py, a published URL,
     or by running shoot.py inline on a capable host);
  4. rotates it to the panel's landscape buffer and pushes it. The Inky
     library does the final map to the panel's native inks.

With ``--preview out.png`` it skips the hardware and writes an approximate
6-ink dither so you can see the result on any machine.

  python3 display.py --config config.toml
  python3 display.py --image shot.png --preview panel.png --no-signature
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime

from PIL import Image

PANEL_W, PANEL_H = 1200, 1600  # portrait (the panel itself is 1600x1200 landscape)

# Approximate Spectra-6 inks -- used ONLY for the --preview dither. On real
# hardware the Inky library maps to the panel's true palette.
SPECTRA6 = [
    (236, 234, 223), (26, 26, 28), (165, 60, 56),
    (198, 176, 74), (49, 71, 130), (58, 110, 72),
]

DEFAULTS = {
    "base_url": "http://birdnet.local",  # where the API + (optionally) screenshot live
    "hours": 24,
    "image": "",            # local PNG written by shoot.py
    "image_url": "",        # OR a published screenshot URL
    "shoot": False,         # OR run shoot.py inline (capable hosts only)
    "shoot_title": None,
    "shoot_subtitle": None,
    "rotate": 90,           # 90 or 270, depending on which way the frame hangs
    "saturation": 0.6,      # Inky dither saturation
    "quiet_start": 22,      # local hour [quiet_start, quiet_end) -> no refresh
    "quiet_end": 6,
    "heal_hours": 24,       # force a refresh at least this often (panel health)
    "state": "~/.birdframe/state.json",
    "cache": "~/.birdframe",
    "timeout": 45,
    "basic_user": None,     # if the whole site is gated
    "basic_pass": None,
}


# ---------------------------------------------------------------- signature
def slugify(sci: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", sci.lower()).strip("-")


def _bucket(n: int) -> int:
    # Coarse brackets: refresh when a species crosses one, not on every call.
    for i, edge in enumerate((1, 2, 5, 15, 40, 100, 300, 1000)):
        if n <= edge:
            return i
    return 8


def fetch_recent(base, hours, timeout, auth=None):
    url = f"{base.rstrip('/')}/avian/api/birdnet-api.php?action=recent&hours={hours}"
    req = urllib.request.Request(url, headers={"User-Agent": "AvianVisitors-frame/1.0"})
    if auth:
        req.add_header("Authorization", "Basic " + auth)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read()).get("species", [])


def signature(species) -> str:
    items = sorted((slugify(s["sci"]), _bucket(int(s.get("n") or 1))) for s in species)
    return hashlib.sha256(json.dumps(items).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- image i/o
def get_image(source, timeout, auth=None) -> Image.Image:
    if re.match(r"^https?://", source):
        req = urllib.request.Request(source, headers={"User-Agent": "AvianVisitors-frame/1.0"})
        if auth:
            req.add_header("Authorization", "Basic " + auth)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    return Image.open(os.path.expanduser(source)).convert("RGB")


def quantize_spectra6(img):
    pal = Image.new("P", (1, 1))
    flat = []
    for c in SPECTRA6:
        flat += list(c)
    while len(flat) < 768:
        flat += list(SPECTRA6[len(flat) // 3 % len(SPECTRA6)])
    pal.putpalette(flat[:768])
    return img.convert("RGB").quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG).convert("RGB")


def fit_panel(img):
    if img.size != (PANEL_W, PANEL_H):
        img = img.resize((PANEL_W, PANEL_H), Image.LANCZOS)
    return img


# ---------------------------------------------------------------- hardware
def push_panel(img, rotate, saturation):
    """Rotate to the panel's landscape buffer and push. Lazy Inky import so
    this module loads fine on machines without the hardware."""
    from inky.auto import auto

    inky = auto()
    buf = img.rotate(rotate, expand=True)
    if buf.size != (inky.width, inky.height):
        buf = buf.resize((inky.width, inky.height), Image.LANCZOS)
    try:
        inky.set_image(buf, saturation=saturation)  # Impression takes saturation
    except TypeError:
        inky.set_image(buf)
    inky.show()


# ---------------------------------------------------------------- state
def load_state(path):
    try:
        return json.load(open(os.path.expanduser(path)))
    except Exception:
        return {"signature": None, "last_refresh": 0}


def save_state(path, sig, when):
    path = os.path.expanduser(path)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    json.dump({"signature": sig, "last_refresh": when}, open(path, "w"))


def in_quiet_hours(cfg, hour):
    s, e = cfg["quiet_start"], cfg["quiet_end"]
    if s == e:
        return False
    return (s <= hour < e) if s < e else (hour >= s or hour < e)


# ---------------------------------------------------------------- run
def obtain_image(cfg, auth):
    if cfg["shoot"]:
        from shoot import shoot  # lazy: only needed on capable hosts
        out = os.path.join(os.path.expanduser(cfg["cache"]), "shot.png")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        shoot(cfg["base_url"], out, title=cfg["shoot_title"], subtitle=cfg["shoot_subtitle"],
              timeout_ms=cfg["timeout"] * 1000, user=cfg["basic_user"], password=cfg["basic_pass"])
        return Image.open(out).convert("RGB")
    src = cfg["image_url"] or cfg["image"]
    if not src:
        raise SystemExit("no image source: set image, image_url, or shoot in config")
    return get_image(src, cfg["timeout"], auth)


def run(cfg, preview=None, force=False, use_signature=True):
    auth = None
    if cfg["basic_user"]:
        import base64
        auth = base64.b64encode(f"{cfg['basic_user']}:{cfg['basic_pass'] or ''}".encode()).decode()

    now = time.time()
    state = load_state(cfg["state"])
    sig = None
    if use_signature:
        try:
            species = fetch_recent(cfg["base_url"], cfg["hours"], cfg["timeout"], auth)
            sig = signature(species)
            print(f"{len(species)} species, signature {sig}")
        except Exception as e:
            print(f"signature fetch failed ({e}); will refresh to be safe", file=sys.stderr)

    heal_due = (now - state.get("last_refresh", 0)) >= cfg["heal_hours"] * 3600
    quiet = in_quiet_hours(cfg, datetime.now().hour)
    changed = (sig is None) or (sig != state.get("signature"))

    if not force and not preview:
        if quiet and not heal_due:
            print("quiet hours, nothing urgent -> skip")
            return
        if not changed and not heal_due:
            print("no change since last refresh -> skip")
            return
        print("refreshing:" + (" heal" if heal_due and not changed else " changed"))

    img = fit_panel(obtain_image(cfg, auth))

    if preview:
        quantize_spectra6(img).save(preview)
        print(f"wrote preview {preview}")
        return

    push_panel(img, cfg["rotate"], cfg["saturation"])
    save_state(cfg["state"], sig, now)
    print("panel updated")


def load_config(path):
    cfg = dict(DEFAULTS)
    if path:
        import tomllib
        with open(os.path.expanduser(path), "rb") as f:
            cfg.update(tomllib.load(f))
    return cfg


def main():
    ap = argparse.ArgumentParser(description="Push the collage screenshot to the Inky panel.")
    ap.add_argument("--config")
    ap.add_argument("--base-url")
    ap.add_argument("--image", help="local screenshot path")
    ap.add_argument("--image-url", help="published screenshot URL")
    ap.add_argument("--preview", help="write a 6-ink preview PNG instead of pushing")
    ap.add_argument("--rotate", type=int)
    ap.add_argument("--force", action="store_true", help="refresh even if unchanged")
    ap.add_argument("--no-signature", action="store_true", help="skip the change-detection fetch")
    args = ap.parse_args()

    cfg = load_config(args.config)
    if args.base_url:
        cfg["base_url"] = args.base_url
    if args.image:
        cfg["image"] = args.image
    if args.image_url:
        cfg["image_url"] = args.image_url
    if args.rotate is not None:
        cfg["rotate"] = args.rotate

    run(cfg, preview=args.preview, force=args.force, use_signature=not args.no_signature)


if __name__ == "__main__":
    main()
