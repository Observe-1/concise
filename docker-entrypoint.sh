#!/bin/sh
set -e

# Concise container entrypoint.
#
# Goal: make the same image work both for NAS platforms that expect PUID/PGID
# (Unraid, Synology, TrueNAS) and for the hardened docker-compose stack that
# runs as a fixed non-root user with all capabilities dropped.
#
# Concise only writes to the /data volume (the SQLite DB + backups). On a bind
# mount the files must be owned by the host user who owns the share, otherwise
# the app cannot write. PUID/PGID name that user; they default to 1000 (the
# image's built-in `node` user). On Unraid set PUID=99 / PGID=100 (nobody:users).

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Optional file-creation mask for the DB file and backups (e.g. UMASK=022).
if [ -n "${UMASK:-}" ]; then
  umask "${UMASK}"
fi

# If we are root we can take ownership of the data volume and drop to the
# requested UID/GID. If we are NOT root — the hardened compose stack runs with
# `user:` + no-new-privileges + cap_drop ALL, where chown/setuid are impossible
# and unnecessary — just run as whoever we already are.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  # Only chown when ownership actually differs, so a populated backups/ directory
  # is not recursively re-chowned on every restart (and the first run, or a
  # changed PUID/PGID, still fixes everything).
  if [ "$(stat -c '%u:%g' /data)" != "${PUID}:${PGID}" ]; then
    chown -R "${PUID}:${PGID}" /data
  fi
  # `exec` so the app replaces setpriv and becomes PID 1, receiving SIGTERM for
  # the graceful shutdown handler in index.ts. setpriv (util-linux) is an
  # exec-based privilege drop, like gosu, and handles numeric IDs with no
  # /etc/passwd entry (e.g. Unraid's 99:100). --clear-groups drops root's
  # supplementary groups so only the requested PGID remains.
  exec setpriv --reuid "${PUID}" --regid "${PGID}" --clear-groups "$@"
fi

exec "$@"
