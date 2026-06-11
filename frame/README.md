# AvianVisitors e-ink frame

A wall frame that mirrors your live AvianVisitors collage onto a
[Pimoroni Inky Impression 13.3"](https://shop.pimoroni.com/products/inky-impression-13-3)
(Spectra 6): the birds heard outside your window in the last 24 hours, hung in
a picture frame.

It shows **the actual website**, not a copy. A headless browser screenshots the
collage, the controls are stripped, and the image is matted and pushed to the
panel. Improve the site and the frame follows. The frame needs no credentials
(the AvianVisitors collage and detection API are public).

## How it works

Two small programs:

- **`shoot.py`** loads your collage URL at a portrait viewport, hides the
  chrome, sets the titles, and rewrites three of the page's own collage
  tunables at capture time (cluster shape, the count-to-size curve, a rare-bird
  floor). Saves a 1200x1600 PNG. Needs headless Chromium.
- **`display.py`** runs on the frame Pi: it refreshes only when the birds
  actually change (plus a daily heal, never at night), crops the title and
  collage, centres and mats them, and pushes to the Inky. `--preview` writes a
  6-ink PNG instead, so you can check it with no hardware.

## The one constraint: a screenshot needs a browser

Headless Chromium does not run on an original **Pi Zero W** (ARMv6). So:

- **Capable frame Pi** (Zero 2 W, Pi 3/4/5): set `shoot = true` and both halves
  run on the frame Pi. One box, done.
- **Pi Zero W**: the screenshot is taken elsewhere and the Pi only displays it.
  The AvianVisitors Worker already renders one via Cloudflare Browser Rendering
  at `/frame.png`, so no extra hardware is needed; or run the shooter yourself
  on any 64-bit box. Either way the Pi fetches the PNG via `image_url`.

## Hardware

- **Inky Impression 13.3" (2025, Spectra 6)**, 1600x1200, ~30 s refresh. Mounts
  as a 40-pin HAT; the Pi sits on the back.
- A Raspberry Pi and a solid **2.5 A+** supply (the panel pulls real current on
  refresh).
- SPI **and** I2C must be on, plus the `spi0-0cs` overlay. `install.sh` does
  this for you.

## Install on the frame Pi

```bash
git clone https://github.com/Twarner491/AvianVisitors
cd AvianVisitors/frame
./install.sh          # enables SPI/I2C, installs deps, sets up the timer
nano ~/.birdframe/config.toml   # paste your FRAME_KEY into image_url
sudo reboot           # so SPI takes effect
```

`install.sh` installs `libatlas3-base` (numpy needs it on ARMv6), creates a
venv, and installs a systemd timer that runs every 15 minutes. If panel
auto-detect ever fails, set `panel = "el133uf1"` in the config. If the picture
hangs upside down, set `rotate = 270`.

## The shooter (Pi Zero W only)

The Pi Zero W displays a PNG that something else renders. Two ways:

**Built in (recommended).** The AvianVisitors aggregator Worker renders the
collage with Cloudflare Browser Rendering and serves it at `/frame.png`, gated
by a shared key (its `FRAME_KEY` secret) so the daily render budget cannot be
drained. No shooter host, no cron: set `shoot = false` and point `image_url` at
it.

```toml
base_url  = "https://bird.onethreenine.net"
image_url = "https://bird.onethreenine.net/frame.png?k=YOUR_FRAME_KEY"
```

`display.py` fetches the image only when the birds change, so a render fires a
handful of times a day, well inside the Workers Free plan's 10 min/day budget.

**Self-hosted.** No Worker? Run `shoot.py` on any 64-bit box (a Pi 4/5, a
laptop, a NAS) and copy the PNG to the Pi on a cron every 15 minutes:

```bash
cd AvianVisitors/frame
python3 -m venv .venv && .venv/bin/pip install -r requirements-shoot.txt
.venv/bin/playwright install chromium
```

```cron
*/15 * * * * cd ~/AvianVisitors/frame && .venv/bin/python shoot.py \
  --url https://bird.onethreenine.net --title "onethreenine birds" \
  --subtitle "heard today" --out /tmp/frame.png \
  && scp -q /tmp/frame.png monalisa@birdpic:~/.birdframe/frame.png
```

Then set `image = "~/.birdframe/frame.png"` on the Pi. (Passwordless `scp` needs
the shooter's SSH key on the Pi.)

## Test without the panel

Works on any machine, no Inky, no network beyond the site:

```bash
.venv/bin/python shoot.py --url https://bird.onethreenine.net \
  --title "onethreenine birds" --subtitle "heard today" --out shot.png
.venv/bin/python display.py --image shot.png --preview panel.png --no-signature
open panel.png
```

## Refresh cadence

The timer fires every 15 min, but a Spectra-6 refresh is a slow, flashy ~30 s
event, so `display.py` only refreshes when the species set or a call-count
bracket changes, plus one daily heal, and never during quiet hours
(22:00 to 06:00 by default). New birds appear within ~15 min; the panel sits
still otherwise.
