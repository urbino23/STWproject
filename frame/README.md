# AvianVisitors e-ink frame

A high-fidelity wall frame that mirrors your live AvianVisitors collage onto
a [Pimoroni Inky Impression 13.3"](https://shop.pimoroni.com/products/inky-impression-13-3)
(Spectra 6) — the birds heard outside your window in the last 24 hours, hung
in a picture frame.

It is **the actual website**, not a re-implementation: a headless browser
screenshots your collage, the controls are hidden, and the image is pushed to
the panel in its six inks. Improve the site and the frame follows.

|        | what it shows |
|--------|---------------|
| small  | a title eyebrow (e.g. `onethreenine birds`) |
| large  | `heard today` |
| body   | the live collage — every species sized by how often it's been heard |

## How it works

Two small programs:

- **`shoot.py`** — loads your collage URL at a portrait viewport, hides the
  menu / window-picker / view-slider with injected CSS, sets the titles, waits
  for the illustrations to load, and saves a `1200×1600` PNG. Needs a real
  headless browser (Chromium via Playwright).
- **`display.py`** — on the frame Pi: decides whether anything changed, then
  quantizes the screenshot to the panel's 6 inks (Floyd–Steinberg), rotates it
  to the panel's landscape buffer, and pushes it with the `inky` library.

Nothing here is secret, and the frame needs **no credentials** — the
AvianVisitors default leaves the collage and detection API public. (If you've
gated your *entire* site behind basic-auth, set `basic_user`/`basic_pass`.)

## The one constraint: a screenshot needs a browser

A collage is drawn in JavaScript, so capturing it means running headless
Chromium — which an **original Pi Zero W cannot do**. Two ways to deploy:

**A — Capable frame Pi (recommended): Pi Zero 2 W, Pi 3/4/5.**
`shoot.py` and `display.py` both run on the frame Pi. Set `shoot = true` in
the config and you're done — one box.

**B — Original Pi Zero W (or any thin client).**
The screenshot is taken *elsewhere* and the Zero W only displays it. The
"elsewhere" is any always-on box that can run Chromium and reach your site —
a spare Pi 4, a NAS, a home-server VM, or a serverless browser
(e.g. Cloudflare Browser Rendering). It publishes `frame.png` to a URL or a
shared path; the Zero W's `display.py` reads it via `image_url` / `image`.

In both cases `display.py` independently checks the detection API for a coarse
change signature, so it refreshes the panel only when the species set (or a
call-count bracket) actually changes.

## Hardware

- **Inky Impression 13.3" (2025, Spectra 6)** — 1600×1200, 6 inks, ~30 s full
  refresh. Mounts as a 40-pin HAT; the Pi sits on the back with the included
  standoffs. Hung **portrait**, the canvas is 1200×1600.
- A Raspberry Pi (see A/B above) and a solid **2.5 A+** supply — the panel
  pulls real current on refresh; a brown-out can wedge the Pi.
- Enable SPI: `sudo raspi-config` → Interface Options → SPI → Enable.

## Install

On the **frame Pi**:

```bash
git clone https://github.com/Twarner491/AvianVisitors
cd AvianVisitors/frame
python3 -m venv .venv
.venv/bin/pip install -r requirements-frame.txt   # Pillow + inky
# (or Pimoroni's installer for the Inky deps: curl https://get.pimoroni.com/inky | bash)

cp config.example.toml ~/.birdframe/config.toml    # then edit it
```

On the **screenshot host** (the frame Pi too, in mode A):

```bash
.venv/bin/pip install -r requirements-shoot.txt    # playwright
.venv/bin/playwright install chromium
```

### Configure

Edit `~/.birdframe/config.toml` — at minimum `base_url` (your collage) and the
screenshot source (`shoot = true` for mode A, or `image_url` for mode B). See
the comments in `config.example.toml`.

### Try it without the panel

```bash
# mode A: shoot the live site and preview the 6-ink result, no hardware
.venv/bin/python shoot.py --url http://birdnet.local \
    --title "onethreenine birds" --subtitle "heard today" --out shot.png
.venv/bin/python display.py --image shot.png --preview panel.png --no-signature
open panel.png
```

### Run on a schedule

```bash
# edit the User/paths in systemd/birdframe.service first
sudo cp systemd/birdframe.* /etc/systemd/system/
sudo systemctl enable --now birdframe.timer
systemctl start birdframe.service   # one immediate run
journalctl -u birdframe.service -n 20
```

In mode B, also run `shoot.py` on the screenshot host on its own schedule
(a 15-min cron writing `frame.png` to wherever the Zero W fetches it).

## Refresh cadence

The timer fires every 15 min, but a Spectra-6 refresh is a slow, flashy ~30 s
event, so `display.py` only actually refreshes when the **species set or a
call-count bracket changes** — plus one daily "heal" refresh and a quiet-hours
window (default 22:00–06:00) so it never flashes in a dark room overnight. Net:
new birds appear within ~15 min, the panel sits still the rest of the time.

## Local vs. forwarded

It's just a URL. `base_url = "http://birdnet.local"` mirrors the default LAN
install; `base_url = "https://your.site"` mirrors a forwarded public deploy.
Everything else is identical.
