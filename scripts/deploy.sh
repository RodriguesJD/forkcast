#!/usr/bin/env bash
# deploy.sh — bring the Fedora box up to origin/main now. Runs ON the box (a Remote Control
# session, or over ssh via scripts/deploy_fedora.sh); this is the one definition of a deploy.
#
# Normal path needs no deploy at all: CI publishes ghcr.io/rodriguesjd/forkcast:latest on every
# merge to main and Watchtower (5-minute poll) recreates forkcast-web from it. This script is
# for "now, not in 5 minutes" and for syncing the checkout (compose file changes only land
# this way). Rollback = revert on main; Watchtower would undo a local pin.
#
#   bash ~/forkcast/scripts/deploy.sh
#
# FORKCAST_DIR overrides the checkout location.
set -euo pipefail
cd "${FORKCAST_DIR:-$HOME/forkcast}"

[ "$(git branch --show-current)" = main ] || { echo "deploy: checkout is not on main" >&2; exit 1; }
git pull --ff-only -q origin main
echo "box at $(git log --oneline -1)"

docker pull -q ghcr.io/rodriguesjd/forkcast:latest
docker compose up -d

docker ps --format '{{.Names}}\t{{.Status}}' | grep forkcast
curl -s -o /dev/null -w "http://127.0.0.1:5002 -> %{http_code}\n" http://127.0.0.1:5002/ || true
tailscale serve status 2>/dev/null | grep -E "forkcast|5002" || true
