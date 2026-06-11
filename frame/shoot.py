#!/usr/bin/env python3
"""Screenshot the live AvianVisitors collage for the e-ink frame.

Loads the *real* site -- the LAN default ``http://birdnet.local`` or a
forwarded public URL -- at a portrait viewport, then hides the on-screen
controls and sets the frame titles with CSS/JS injected at capture time.
The result is the actual website, just without its chrome: no changes to
AvianVisitors itself, and it stays in lock-step with whatever the site
renders.

This needs a real headless browser, so it runs on any capable machine
(a Pi 4/5, a LAN box, your laptop, or a serverless browser) -- NOT the
Pi Zero W driving the panel. It writes a 1200x1600 portrait PNG;
``display.py`` turns that into the 6-ink panel image and pushes it.

  pip install playwright && playwright install chromium
  python3 shoot.py --url http://birdnet.local --out frame.png
  python3 shoot.py --url https://bird.onethreenine.net \
      --title "onethreenine birds" --subtitle "heard today" --out frame.png
"""
from __future__ import annotations

import argparse
import sys

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

# Hide every control + the modals, freeze animations so we don't catch the
# collage mid-bloom, and keep the paper ground edge-to-edge.
HIDE_CSS = """
  .top, .slider, .return-to-atlas, #menu-dd,
  #detail-modal, #about-modal, .admin-screen, #collageTip,
  .modal-backdrop { display: none !important; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
  html, body { background: var(--paper, #efece0) !important; }
"""


def _title_css(scale: float) -> str:
    # The titles are frame-specific text, so sizing them for the frame is
    # fair game; the collage itself is untouched.
    return (
        f".static-head {{ padding: {int(70 * scale)}px 32px {int(30 * scale)}px !important; }}"
        f".static-head .pre {{ font-size: {int(23 * scale)}px !important; }}"
        f".static-head h1 {{ font-size: {int(60 * scale)}px !important; }}"
    )


def shoot(url, out, *, title=None, subtitle=None, vw=600, vh=800, dsf=2,
          title_scale=1.0, lowercase=False, timeout_ms=45000, user=None, password=None):
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb"])
        ctx_kw = dict(viewport={"width": vw, "height": vh}, device_scale_factor=dsf)
        if user:
            ctx_kw["http_credentials"] = {"username": user, "password": password or ""}
        ctx = browser.new_context(**ctx_kw)
        page = ctx.new_page()
        page.goto(url, wait_until="networkidle", timeout=timeout_ms)

        # Wait for the collage to exist and its illustrations to finish loading
        # (a screenshot before the cutouts decode would show blank tiles).
        try:
            page.wait_for_selector(".gtile", timeout=timeout_ms)
            page.wait_for_function(
                "() => { const t=[...document.querySelectorAll('.gtile img')];"
                " return t.length>0 && t.every(i=>i.complete && i.naturalWidth>0); }",
                timeout=timeout_ms,
            )
        except PWTimeout:
            print("warning: collage tiles didn't fully settle; capturing anyway", file=sys.stderr)

        css = HIDE_CSS + _title_css(title_scale)
        if lowercase:
            css += ".static-head h1 { text-transform: none !important; }"
        page.add_style_tag(content=css)
        if title is not None:
            page.evaluate("(t)=>{const e=document.querySelector('.static-head .pre'); if(e)e.textContent=t;}", title)
        if subtitle is not None:
            page.evaluate("(s)=>{const e=document.querySelector('.static-head h1'); if(e)e.textContent=s;}", subtitle)

        page.wait_for_timeout(250)
        page.screenshot(path=out, clip={"x": 0, "y": 0, "width": vw, "height": vh})
        browser.close()
    return out


def main():
    ap = argparse.ArgumentParser(description="Screenshot the AvianVisitors collage for the e-ink frame.")
    ap.add_argument("--url", default="http://birdnet.local", help="collage URL (LAN default or forwarded site)")
    ap.add_argument("--out", default="frame.png")
    ap.add_argument("--title", default=None, help="small eyebrow title (default: keep the site's)")
    ap.add_argument("--subtitle", default=None, help="large headline (default: keep the site's)")
    ap.add_argument("--lowercase", action="store_true", help="don't uppercase the headline")
    ap.add_argument("--title-scale", type=float, default=1.0)
    ap.add_argument("--width", type=int, default=600, help="logical viewport width (<=700 -> portrait layout)")
    ap.add_argument("--height", type=int, default=800)
    ap.add_argument("--dsf", type=int, default=2, help="device scale factor (2 -> 1200x1600 output)")
    ap.add_argument("--user", default=None, help="basic-auth user, if the whole site is gated")
    ap.add_argument("--password", default=None)
    ap.add_argument("--timeout", type=int, default=45000)
    args = ap.parse_args()

    shoot(args.url, args.out, title=args.title, subtitle=args.subtitle,
          vw=args.width, vh=args.height, dsf=args.dsf, title_scale=args.title_scale,
          lowercase=args.lowercase, timeout_ms=args.timeout, user=args.user, password=args.password)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
