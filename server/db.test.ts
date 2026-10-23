import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase, insertUser, listBackups, openDatabase, countUsers } from './db';
import { DatabaseSync } from 'node:sqlite';

describe('database file and backups', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it('persists across reopen and writes restorable backups with retention', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forkcast-db-'));
    dirs.push(dir);
    const file = join(dir, 'forkcast.sqlite');
    const db = openDatabase(file);
    insertUser(db, 'christy', 'hash');
    db.close();

    const again = openDatabase(file);
    expect(countUsers(again)).toBe(1);

    const backups = join(dir, 'backups');
    const files: string[] = [];
    for (let i = 0; i < 4; i++) {
      const f = backupDatabase(again, backups, 3, new Date(Date.UTC(2026, 0, i + 1)));
      // Make mtimes distinct and ordered regardless of filesystem resolution.
      utimesSync(f, new Date(2026, 0, i + 1), new Date(2026, 0, i + 1));
      files.push(f);
    }
    expect(readdirSync(backups)).toHaveLength(3);
    expect(listBackups(backups).map((b) => b.file)).toEqual([files[3], files[2], files[1]]);

    const restored = new DatabaseSync(files[3]);
    expect(countUsers(restored)).toBe(1);
    restored.close();
    again.close();
  });
});
