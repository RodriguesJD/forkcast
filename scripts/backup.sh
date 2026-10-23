#!/usr/bin/env bash
# backup.sh — copy the newest database backup out of the Docker volume. Runs ON the box.
#
# The server itself writes a consistent snapshot (VACUUM INTO) to /data/backups every 24 h and
# keeps the newest 14, all inside the `forkcast_forkcast-data` volume. That protects against bad writes
# and mistakes, not against losing the box. This script copies the newest snapshot to
# ~/forkcast-backups (or $1) so it can be synced somewhere else.
#
#   bash ~/forkcast/scripts/backup.sh              # -> ~/forkcast-backups/forkcast-<stamp>.sqlite
#   bash ~/forkcast/scripts/backup.sh /mnt/usb     # elsewhere
#
# Restore (docs/deploy.md): stop the container, copy a snapshot over forkcast.sqlite in the
# volume, start it again.
set -euo pipefail
dest="${1:-$HOME/forkcast-backups}"
mkdir -p "$dest"

newest="$(docker exec forkcast-web sh -c 'ls -1 /data/backups/forkcast-*.sqlite 2>/dev/null | sort | tail -n 1')"
if [ -z "$newest" ]; then
  echo "backup: no snapshot in the volume yet (the server writes one at startup and every 24 h)" >&2
  exit 1
fi
docker cp "forkcast-web:$newest" "$dest/"
echo "copied $(basename "$newest") -> $dest"
ls -1t "$dest" | head -n 5
