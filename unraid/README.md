# Concise on Unraid

`concise-wealth-tracker.xml` is a Community Applications template for running
Concise on Unraid (it also works as a reference for Synology/TrueNAS, which use
the same PUID/PGID convention).

## Install

The template isn't published to Community Applications, so add it manually:

1. Copy `concise-wealth-tracker.xml` to your Unraid server at
   `/boot/config/plugins/dockerMan/templates-user/`
   (e.g. `scp concise-wealth-tracker.xml root@tower:/boot/config/plugins/dockerMan/templates-user/`).
2. In the Unraid web UI go to **Docker → Add Container**, and pick
   **concise** from the *Template* dropdown (under "User templates").
3. Review the settings (see below) and click **Apply**. Unraid pulls
   `observe1234/concise-wealth-tracker:latest` and starts the container.

## Key settings

| Setting | Default | Notes |
|---|---|---|
| **WebUI Port** | `3000` | Host port. The container always listens on **3000** internally, serving **both** the web UI and the `/api` REST API from that single port — there is no separate API port. Change only the host (left) side. |
| **Appdata** | `/mnt/user/appdata/concise-wealth-tracker` → `/data` | Holds the SQLite database (`concise.db`). |
| **Backup Directory** | `/mnt/user/appdata/concise-wealth-tracker/backups` → `/backups` | Where validated backups are written. Point the host side at any share to keep copies off the database's own folder; the container side is fixed at `/backups` (the `BACKUP_DIR` variable). |
| **PUID / PGID** | `99` / `100` | The user/group that owns your appdata share (Unraid: `nobody:users`). The app writes `/data` and `/backups` as this user. |
| **COOKIE_SECURE** | `false` | Leave `false` for plain-HTTP LAN access (`http://tower:3000`) or **login will silently fail**. Set `true` only behind an HTTPS reverse proxy. |

Advanced variables (`BACKUP_DIR`, timezone, rate limits, trusted origins, price
provider, log level, demo seed) are hidden under **Show more settings…**;
defaults are safe. Leave `BACKUP_DIR` at `/backups` — to relocate backups,
change the host side of the **Backup Directory** mapping, not this variable.

## How it works (PUID/PGID)

The image starts as root, the entrypoint `chown`s `/data` to `PUID:PGID`, then
drops to that user via `setpriv` and `exec`s Node (so the app is PID 1 / gets a
clean SIGTERM). It never runs the app as root. If the container is instead
started as a non-root user (the project's hardened `docker-compose.yml` pins
`user: 1000:1000`), the entrypoint detects that and runs directly without the
chown/drop.

## Backups & disaster recovery

Concise takes validated SQLite backups itself (automatic + manual; tune them in
**Settings → Backup**). They are written to the **Backup Directory** mapping —
by default `<appdata>/backups`, but you can repoint the host side at a dedicated
backups share or a second disk. Because the default is on your array, include
the appdata share in your normal Unraid backup routine (e.g. the CA Appdata
Backup plugin) for off-server copies. See `../BACKUP.md`.
