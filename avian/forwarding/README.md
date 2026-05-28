# Optional: forwarding the collage off your local network

Default install hosts the collage at `http://birdnet.local/avian/` on
your LAN with no auth. If you want it accessible from anywhere — or
piped into Home Assistant / MQTT — pick one of the recipes below.

Each recipe is independent. Skip what you don't need.

---

## 1. Cloudflare Tunnel — public HTTPS, no port forwarding

Free Cloudflare account required.

Install `cloudflared`:

```bash
sudo apt install -y lsb-release
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
```

Authenticate + create the tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create birds
cloudflared tunnel route dns birds birds.your-domain.com
```

Configure + start the tunnel:

```bash
sudo cp ~/BirdNET-Pi/avian/forwarding/cloudflared.yml /etc/cloudflared/config.yml
# Edit /etc/cloudflared/config.yml — set `tunnel:` to your tunnel UUID
sudo cloudflared service install
sudo systemctl restart cloudflared
```

To password-protect the public URL, set up Cloudflare Access (free
tier: up to 50 users). The LAN URL stays open. If you'd rather use HTTP
Basic auth, see [`caddy-auth.caddy`](caddy-auth.caddy).

---

## 2. Home Assistant — surface latest detection as a sensor

Add to `configuration.yaml`:

```yaml
rest:
  - resource: http://birdnet.local/avian/api/birdnet-api.php?action=recent&hours=1
    scan_interval: 60
    sensor:
      - name: "Latest Bird"
        value_template: "{{ value_json.species[0].com if value_json.species else 'none' }}"
        json_attributes_path: "$.species[0]"
        json_attributes:
          - sci
          - n
          - last_seen
          - best_conf
```

`birdnet-api.php?action=recent` already returns `species` ordered by
count desc; if you want most-recent first, replace the value_template
with a sort filter.

---

## 3. MQTT — fan out detections to other services

```bash
sudo pip3 install paho-mqtt --break-system-packages
cp ~/BirdNET-Pi/avian/forwarding/mqtt-bridge.py ~/avian-mqtt.py
# Edit ~/avian-mqtt.py — broker host, topic prefix, credentials
sudo cp ~/BirdNET-Pi/avian/forwarding/avian-mqtt.service /etc/systemd/system/
# Edit /etc/systemd/system/avian-mqtt.service — set User= to your username
sudo systemctl daemon-reload
sudo systemctl enable --now avian-mqtt
```

The bridge polls `/avian/api/birdnet-api.php?action=recent&hours=1`
once a minute and publishes new species under `birdnet/<slug>` with the
full record as a JSON payload. Dedup is in-memory only — downstream
consumers should be idempotent.
