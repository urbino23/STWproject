# AvianVisitors e-ink frame

*The last 24h of birds, framed on the wall by your window.*

A [Pimoroni Inky Impression 13.3"](https://shop.pimoroni.com/products/inky-impression-13-3) (Spectra 6) mirroring the live collage. A Pi screenshots the site, mats it onto an A5 opening, and pushes to the panel, refreshing only when the birds change.

---

## BOM

| Qty | Description | Price | Link |
|-----|-------------|-------|------|
| 1 | Raspberry Pi Zero 2 W | ~$35 | [Raspberry Pi](https://www.raspberrypi.com/products/) |
| 1 | 13.3" E Ink Display | $299.99 | [Amazon](https://a.co/d/0eGzAzpD) |
| 1 | A4 wood photo frame | $21.99 | [Amazon](https://a.co/d/03lpjhgH) |

Plus a flat micro-USB cable and a 5V brick. Backing-plate CAD and a print-ready 3MF are in [`hardware/`](hardware/).

---

## 1. Flash the SD card

[Raspberry Pi Imager](https://www.raspberrypi.com/software/), Raspberry Pi OS Lite (64-bit). In the customisation dialog set a username, your WiFi, hostname `birdpic`, and enable SSH. Boot.

---

## 2. Run the installer

```bash
ssh <your-username>@birdpic.local
git clone https://github.com/Twarner491/AvianVisitors
cd AvianVisitors/frame && ./install.sh
```

Enables SPI + I2C, installs the deps and a 15-minute systemd timer, and writes `~/.birdframe/config.toml`.

---

## 3. Point it at the collage

The Pi is too small to run a browser, so it fetches a ready-made PNG. The aggregator Worker renders one at `/frame.png`, gated by a key. Set both in `~/.birdframe/config.toml`, then `sudo reboot` for SPI:

```toml
base_url  = "https://bird.onethreenine.net"
image_url = "https://bird.onethreenine.net/frame.png?k=YOUR_FRAME_KEY"
```

No Worker? Set `shoot = true` to screenshot on any capable host instead. Full options are in [`config.example.toml`](config.example.toml).
