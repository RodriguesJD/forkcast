import { serve } from '@hono/node-server';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './app';
import { backupDatabase, deleteExpiredSessions, listBackups, openDatabase } from './db';

/**
 * Process entry point. Configuration is by environment:
 *   PORT                    listen port (default 3000)
 *   FORKCAST_DATA_DIR       where forkcast.sqlite and backups/ live (default ./data)
 *   FORKCAST_DIST_DIR       built client to serve (default ./dist)
 *   FORKCAST_REQUIRE_MOUNT  "1": refuse to start unless the data dir is a mount point.
 *                           Set in the image so a container accidentally run without the
 *                           persistent volume fails loudly instead of losing data later.
 *   FORKCAST_BACKUP_KEEP    how many nightly backups to keep (default 14)
 */

const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.FORKCAST_DATA_DIR ?? 'data');
const distDir = resolve(process.env.FORKCAST_DIST_DIR ?? 'dist');
const backupKeep = Number(process.env.FORKCAST_BACKUP_KEEP ?? 14);
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

function isMountPoint(dir: string): boolean {
  try {
    const target = dir.replace(/ /g, '\\040');
    return readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .some((line) => line.split(' ')[4] === target);
  } catch {
    return false;
  }
}

if (process.env.FORKCAST_REQUIRE_MOUNT === '1' && !isMountPoint(dataDir)) {
  console.error(
    `forkcast: ${dataDir} is not a mounted volume. Refusing to start, because anything written there\n` +
      `would vanish with the container. Run with the persistent volume (docker compose up -d, or\n` +
      `docker run -v forkcast-data:/data ...), or unset FORKCAST_REQUIRE_MOUNT to run throwaway.`,
  );
  process.exit(1);
}

mkdirSync(dataDir, { recursive: true });
if (!existsSync(join(distDir, 'index.html'))) {
  console.error(`forkcast: no built client at ${distDir}/index.html (run npm run build)`);
  process.exit(1);
}

const dbFile = join(dataDir, 'forkcast.sqlite');
const db = openDatabase(dbFile);
log(`database ${dbFile}`);
const expired = deleteExpiredSessions(db);
if (expired) log(`removed ${expired} expired sessions`);

const backupDir = join(dataDir, 'backups');
function backupIfDue(): void {
  const newest = listBackups(backupDir)[0];
  if (newest && Date.now() - newest.mtimeMs < BACKUP_INTERVAL_MS) return;
  try {
    log(`backup written ${backupDatabase(db, backupDir, backupKeep)}`);
  } catch (err) {
    console.error(`${new Date().toISOString()} backup FAILED: ${(err as Error).message}`);
  }
}
backupIfDue();
const backupTimer = setInterval(backupIfDue, 60 * 60 * 1000);
const sessionTimer = setInterval(() => deleteExpiredSessions(db), BACKUP_INTERVAL_MS);

const app = createApp({ db, distDir, log });
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  log(`listening on http://${info.address}:${info.port}, serving ${distDir}`);
});

function shutdown(signal: string): void {
  log(`${signal}: shutting down`);
  clearInterval(backupTimer);
  clearInterval(sessionTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
