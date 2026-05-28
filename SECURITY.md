# Security

AvianVisitors is designed for a Raspberry Pi listening on a trusted home network. If anyone other than you can reach the Pi at the network layer — a shared apartment LAN, dorm wifi, an open hotspot, a forwarded port — read this first.

## What the default install leaves open

The public-facing endpoints (the collage HTML, the read-only birdnet-api.php aggregations, cutout/spectrogram/recording PHPs, the wiki proxy) are intentionally unauthenticated. They serve display data and a few thousand bytes of JSON each. Treat them as public.

The **admin endpoints** are not safe to expose to untrusted networks:

- `/avian/api/config.php` — reads and writes a whitelisted slice of `birdnet.conf` and restarts the analyzer when settings change.
- `/avian/api/birdnet-status.php` — returns system metrics (CPU, mem, disk, uptime), service state, journalctl output, and accepts `?action=restart` to bounce a whitelisted unit.

By default these are reachable on the same `http://birdnet.local/` listener as everything else. On a shared LAN, anyone on the same network can hit them. The frontend's "lock screen" is cosmetic without a Caddy basic_auth gate in front.

## What can go wrong

The upstream BirdNET-Pi installer drops a `caddy ALL=(ALL) NOPASSWD: ALL` sudoers rule (see `scripts/install_services.sh`). PHP-FPM runs as the `caddy` user. That means anything reachable from a PHP shim has full root via `sudo`.

The shims here use a tight allowlist for `systemctl restart` and `journalctl -u`, and they validate every input against a whitelist + `escapeshellarg`. The string fields written to `birdnet.conf` are escaped against `$`, backtick, backslash, and double-quote, and rejected outright if they contain anything outside `[A-Za-z0-9 _.,'-]`. So even on a flat-trust LAN, the public-by-default admin endpoints don't *currently* offer an obvious path to RCE.

But the surface is wide. New shims, future config keys, or a regression in `quote_val` would be enough. The safe default is: **lock the admin endpoints down on every install that isn't a fully trusted home network**.

## Locking it down

Add a Caddy basic_auth block in front of the admin shims. Example, dropped into the bottom of `/etc/caddy/Caddyfile` (or a snippet in `conf.d/`):

```
basicauth /avian/api/config.php* /avian/api/birdnet-status.php* {
  birdnet $2a$14$...  # caddy hash-password --plaintext '<your-password>'
}
```

Then in `/etc/avian/env` (or your php-fpm pool env block):

```
AV_REQUIRE_AUTH=1
```

The env flag makes the PHP shims refuse to respond unless an `Authorization` header reached them — which it will, when basic_auth in Caddy passes the request through, and won't, when basic_auth rejects it.

Reload Caddy and php-fpm:

```
sudo systemctl reload caddy
sudo systemctl reload "$(systemctl list-unit-files 'php*-fpm.service' --no-legend | awk '{print $1; exit}')"
```

After that:

- The collage and read-only APIs still serve to anyone.
- The admin overlay's settings/system/logs/tools panels prompt for the password the first time the drawer opens, then the browser caches it.
- `curl http://birdnet.local/avian/api/birdnet-status.php?action=diag` returns 401 without credentials.

If you also need the Pi reachable from outside the home network (Cloudflare Tunnel, reverse proxy, port-forward), the basic_auth gate above is the bare minimum — consider also limiting `/avian/api/config.php` and `/avian/api/birdnet-status.php` to specific source IPs at the Caddy layer, or moving them onto a separate listener that's only bound to a Tailscale interface.

## What I'd love a contribution on

- Auto-generating a unique basic_auth password during `install_services.sh`, writing it to a file the user reads once after install, and emitting the matching Caddy block — so the secure default is the path of least resistance.
- A smaller-radius sudoers replacement that drops the blanket `caddy ALL=(ALL) NOPASSWD: ALL` rule and grants only the specific commands AvianVisitors actually needs.

## Reporting

If you find a security issue, open a GitHub issue with the `security` label or email `teddy@theodore.net`. There's no bug bounty — this is a side project — but I'll prioritize a fix and credit you in the release notes.
