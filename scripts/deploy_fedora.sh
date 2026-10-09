#!/bin/zsh
# Deploy from another machine: runs scripts/deploy.sh on the box over ssh (the one definition).
# Merge to main first. From a Remote Control session on the box, run scripts/deploy.sh directly.
#   zsh scripts/deploy_fedora.sh [host]
set -e
HOST=${1:-aut@aut-macbookpro181.local}   # off-LAN: aut@aut-macbookpro181 (Tailscale MagicDNS)
ssh "$HOST" 'bash ~/forkcast/scripts/deploy.sh'
