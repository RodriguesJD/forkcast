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
   The image is one Node 22 process that serves `dist/` and the `/api` (SQLite via Node's
   built-in module, so nothing native to compile); the build stage runs natively on the runner
   and only the runtime layer is arm64, so the job takes a few minutes. On the box, **Watchtower**
   (the container started by `~/eth-grid-trader/docker-compose.prod.yml`, shared by every
   project on the host) polls GHCR every 5 minutes and recreates any container labelled
   `com.centurylinklabs.watchtower.enable=true` whose image changed: here, `forkcast-web`.

   So: merge, wait ~10 minutes, verify. `bash ~/forkcast/scripts/deploy.sh` is only for
   "now, not in 5 minutes", or to sync the checkout after `docker-compose.yml` changes
   (Watchtower replaces the image, not the compose file): it pulls `main` and the image,
   `docker compose up -d`, and prints status. From another machine,
   `zsh scripts/deploy_fedora.sh` runs it over ssh.

   **The data volume.** `docker-compose.yml` mounts the named volume `forkcast_forkcast-data` at `/data`,
   where the server keeps `forkcast.sqlite` (accounts, recipes, plans) and `backups/`. The volume
   outlives image updates, container recreation and reboots; only `docker compose down -v` or
   `docker volume rm forkcast_forkcast-data` would delete it, so never run those. The image refuses to
   start when `/data` is not a mounted volume (`FORKCAST_REQUIRE_MOUNT=1`), so a container
   accidentally created without it fails loudly instead of silently losing data later.
   Watchtower keeps the mounts of the container it replaces, so once the volume is attached it
   stays attached. **When the compose file changes** (a port mapping or a volume), Watchtower
   alone is not enough: run `bash ~/forkcast/scripts/deploy.sh` once after the merge so the new
   compose file is applied.

   **Rollback** = revert the commit on `main` through a PR; CI publishes the reverted image
   and Watchtower rolls it out. Don't pin an older tag on the box: Watchtower would replace it
   at the next poll.
6. **Verify.** From a Remote Control session or ssh on the box:
   - the running image is the new one: `docker inspect forkcast-web --format '{{.Image}}'`
     matches `docker image inspect ghcr.io/rodriguesjd/forkcast:<merge sha> --format '{{.Id}}'`,
     and `docker logs watchtower --tail 5` shows an update for that poll;
   - `curl -s http://127.0.0.1:5002/api/health` returns `{"ok":true}` and
     `curl -s http://127.0.0.1:5002/ | head -3` returns the app shell;
   - `docker logs forkcast-web --tail 5` shows `database /data/forkcast.sqlite` and `listening`
     (not the "is not a mounted volume" refusal), and `docker inspect forkcast-web --format
     '{{range .Mounts}}{{.Name}} {{.Destination}}{{end}}'` prints `forkcast_forkcast-data /data`;
   - open `http://aut-macbookpro181.local:5002` from a laptop on the home Wi-Fi, or
     `http://aut-macbookpro181.<tailnet>.ts.net:8082` from a phone on the tailnet, and reload.
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

# 3. Start it. Port 5002 on every host interface (clinch has 5001 and 8001), so the LAN can see it.
#    `docker compose up -d` also creates the forkcast_forkcast-data volume (compose prefixes the project name) on first use.
docker compose up -d
curl -s http://127.0.0.1:5002/api/health                            # {"ok":true}
docker volume inspect forkcast_forkcast-data --format '{{.Mountpoint}}'      # exists

# 4. Also publish on the tailnet (persisted in tailscaled state; survives reboots).
#    80 is clinch's dashboard and 8080 its Datasette, so forkcast takes 8082.
sudo tailscale serve --bg --http=8082 http://127.0.0.1:5002
tailscale serve status
```

## Two ways in

| Who | Needs | URL |
|-----|-------|-----|
| Anyone on the home Wi-Fi (Christy, guests) | nothing installed | `http://aut-macbookpro181.local:5002` |
| Anyone on the tailnet (the lead, from anywhere) | Tailscale signed in | `http://aut-macbookpro181.<tailnet>.ts.net:8082` |

Both point at the same container and work at the same time: compose publishes `5002` on every
host interface, and `tailscale serve` proxies that same port onto the tailnet. The `.local` name
is mDNS, which Macs, iPhones and most laptops resolve on the LAN without setup; if a device cannot,
use the box's LAN IP (`ip -4 addr show` on the box) with `:5002`. `tailscale serve` routes by Host
header, so the bare Tailscale IP returns 404; always use the name there.

This differs from clinch-v2, which binds loopback only. Everything in Forkcast sits behind a
sign-in (scrypt passwords, cookie sessions, login throttling; see `docs/DECISIONS.md` 20), and
sign-up is open on purpose so Christy can create her account from any device on the Wi-Fi. A guest
on the Wi-Fi could therefore create an account of their own, which gives them an empty planner and
nothing else. It is still not internet-safe: never port-forward 5002 on the router, and remember
that Docker's published ports bypass firewalld, so firewalld rules will not close it.

## Accounts, backups, restore, reset

**First account.** After this version is deployed (and `deploy.sh` has applied the volume), open
`http://aut-macbookpro181.local:5002`, tap "Create an account", and that's it. The account
starts with a copy of the sample recipes, all editable.

**Backups.** The server writes a consistent snapshot (`VACUUM INTO`) to `/data/backups/` on
startup when the newest one is older than 24 h, and checks hourly, keeping the newest 14.
`bash ~/forkcast/scripts/backup.sh` copies the newest snapshot to `~/forkcast-backups/` (or a
directory given as `$1`), which is the thing to sync off the box.

**Restore** a snapshot (stops the app for a few seconds):

```bash
docker compose -f ~/forkcast/docker-compose.yml stop
docker run --rm -v forkcast_forkcast-data:/data alpine sh -c \
  'cp /data/backups/forkcast-<stamp>.sqlite /data/forkcast.sqlite && rm -f /data/forkcast.sqlite-wal /data/forkcast.sqlite-shm'
docker compose -f ~/forkcast/docker-compose.yml start
```

To restore from a copy outside the volume, `docker cp ~/forkcast-backups/forkcast-<stamp>.sqlite
forkcast-web:/data/restore.sqlite` first (with the container running), then use that path.

**Forgotten password.** There is no reset flow. Delete the account's sessions and set a new
password hash from inside the container, then sign in with the new password:

```bash
docker exec -it forkcast-web node --no-warnings=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite"); const c = require("node:crypto");
  const [user, pw] = process.argv.slice(1);
  const salt = c.randomBytes(16);
  const key = c.scryptSync(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const hash = `scrypt$32768$${salt.toString("base64")}$${key.toString("base64")}`;
  const db = new DatabaseSync("/data/forkcast.sqlite");
  const n = db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hash, user).changes;
  db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)").run(user);
  console.log(n ? "password updated" : "no such user");
' christy 'new password here'
```

**Start over** (deletes every account, recipe and plan; the volume stays):
`docker compose stop && docker run --rm -v forkcast_forkcast-data:/data alpine rm -f /data/forkcast.sqlite /data/forkcast.sqlite-wal /data/forkcast.sqlite-shm && docker compose start`.

HTTPS (`--https=8443` instead of `--http=8082`) works once "HTTPS Certificates" is enabled for
the tailnet, the same open item as clinch-v2's `docs/remote_access.md`.

## Running the image locally

```sh
docker build -t forkcast .                                       # builds for the host's own platform
docker run --rm -p 5002:3000 -v forkcast-dev:/data forkcast      # http://localhost:5002
```

Without `-v` the container exits immediately with "is not a mounted volume"; that is the guard
working. `-e FORKCAST_REQUIRE_MOUNT=` disables it for a throwaway run.
