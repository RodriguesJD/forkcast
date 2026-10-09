# Deploy — GitHub main → GHCR → Watchtower on the Fedora Asahi box

Same loop as clinch-v2. GitHub `main` is the only source of truth: a session writes code on a
branch, a PR merges it, CI publishes an image, the box pulls it.

## The loop: branch → PR → CI → merge → deploy → verify

1. **Branch.** Every session works on its own branch. Never commit to `main` directly
   (GitHub does not enforce this on our plan, so every session must).
2. **PR.** The session ends by pushing the branch and opening a PR.
3. **CI.** `.github/workflows/ci.yml` runs `npm run typecheck`, `npm test` and `npm run build`
   on Node 22. Nothing needs the network. Fix red before merging; never merge red.
4. **Merge.** Squash or merge from GitHub (phone is fine).
5. **Deploy: automatic.** The `build-image` job runs after the tests on every push to `main`
   and publishes `ghcr.io/rodriguesjd/forkcast:latest` (also tagged with the commit SHA).
   The image is nginx serving `dist/`; the node build stage runs natively on the runner and
   only the nginx layer is arm64, so the job takes a few minutes. On the box, **Watchtower**
   (the container started by `~/eth-grid-trader/docker-compose.prod.yml`, shared by every
   project on the host) polls GHCR every 5 minutes and recreates any container labelled
   `com.centurylinklabs.watchtower.enable=true` whose image changed: here, `forkcast-web`.

   So: merge, wait ~10 minutes, verify. `bash ~/forkcast/scripts/deploy.sh` is only for
   "now, not in 5 minutes", or to sync the checkout after `docker-compose.yml` changes
   (Watchtower replaces the image, not the compose file): it pulls `main` and the image,
   `docker compose up -d`, and prints status. From another machine,
   `zsh scripts/deploy_fedora.sh` runs it over ssh.

   **Rollback** = revert the commit on `main` through a PR; CI publishes the reverted image
   and Watchtower rolls it out. Don't pin an older tag on the box: Watchtower would replace it
   at the next poll.
6. **Verify.** From a Remote Control session or ssh on the box:
   - the running image is the new one: `docker inspect forkcast-web --format '{{.Image}}'`
     matches `docker image inspect ghcr.io/rodriguesjd/forkcast:<merge sha> --format '{{.Id}}'`,
     and `docker logs watchtower --tail 5` shows an update for that poll;
   - `curl -s http://127.0.0.1:5002/ | head -3` returns the app shell;
   - open `http://aut-macbookpro181.<tailnet>.ts.net:8082` from a phone and hard-refresh.
     `index.html` is served `no-cache` and assets are content-hashed, so a normal reload
     picks up the new build.

## One-time host setup (Fedora Asahi box)

Watchtower and Tailscale are already running on the box for clinch; nothing new is installed.

```bash
# 1. Checkout on main (the compose file lives here; the app itself comes from GHCR)
git clone https://github.com/RodriguesJD/forkcast ~/forkcast
cd ~/forkcast

# 2. GHCR. The repo is public, but a package published from a workflow starts out private:
#    on github.com → Packages → forkcast → Package settings → Change visibility → Public,
#    or skip that and rely on the `docker login ghcr.io` the box already has for clinch-v2.
docker pull ghcr.io/rodriguesjd/forkcast:latest

# 3. Start it. Port 5002 on loopback only (clinch has 5001 and 8001).
docker compose up -d
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5002/   # 200

# 4. Publish on the tailnet (persisted in tailscaled state; survives reboots).
#    80 is clinch's dashboard and 8080 its Datasette, so forkcast takes 8082.
sudo tailscale serve --bg --http=8082 http://127.0.0.1:5002
tailscale serve status
```

The app is then `http://aut-macbookpro181.<tailnet>.ts.net:8082` from any device signed into the
tailnet. `tailscale serve` routes by Host header, so the bare IP returns 404; always use the name.
The app has no authentication and stores its plan in the browser's localStorage, so it must never
be published on a public port; the loopback binding in `docker-compose.yml` is the firewall.

HTTPS (`--https=8443` instead of `--http=8082`) works once "HTTPS Certificates" is enabled for
the tailnet, the same open item as clinch-v2's `docs/remote_access.md`.

## Running the image locally

```sh
docker build -t forkcast .            # builds for the host's own platform
docker run --rm -p 5002:80 forkcast   # http://localhost:5002
```
