import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BASE_SCHEMA_SQL, getUserState, listRecipes, openDatabase, SCHEMA_VERSION, schemaVersion, countUsers, findUserByName } from './db';

/**
 * Upgrade safety: a database written by version 1 of the server (the one that
 * went live on the box) must open under the current code with every row intact.
 * Build the v1 file with the v1 DDL and v1-shaped rows, then open it normally.
 */
describe('schema migrations', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  function v1Database(): string {
    const dir = mkdtempSync(join(tmpdir(), 'forkcast-v1-'));
    dirs.push(dir);
    const file = join(dir, 'forkcast.sqlite');
    const db = new DatabaseSync(file);
    db.exec(BASE_SCHEMA_SQL);
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
    db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'christy', 'scrypt$x$y$z', '2026-10-23T01:15:00Z')").run();
    db.prepare(
      `INSERT INTO recipes (user_id, id, name, base_servings, active_minutes, total_minutes, ingredients_json, advance_prep_json, created_at, updated_at)
       VALUES (1, 'lemon-pasta', 'Lemon Pasta', 4, 15, 25, ?, ?, 't', 't')`,
    ).run(JSON.stringify([{ name: 'spaghetti', quantity: { amount: 1, unit: 'lb' }, section: 'dry-goods' }]), JSON.stringify([{ id: 'zest', description: 'Zest', leadDays: 1, activeMinutes: 5 }]));
    db.prepare("INSERT INTO plans (user_id, plan_json, checked_json, updated_at) VALUES (1, ?, ?, 't')").run(
      JSON.stringify({ settings: { startDay: 0, activeSlots: ['dinner'], householdSize: 2, availableMinutesPerDay: [120, 45, 45, 45, 45, 45, 120], pantryStaples: ['salt'], batchPrepDayIndex: 0 }, entries: [{ kind: 'cook', id: 'e1', slot: { dayIndex: 0, slot: 'dinner' }, recipeId: 'lemon-pasta', servings: 4 }] }),
      JSON.stringify({ 'spaghetti|mass': true }),
    );
    db.close();
    return file;
  }

  it('upgrades a v1 database in place and keeps every row', () => {
    const file = v1Database();
    const db = openDatabase(file);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(countUsers(db)).toBe(1);
    expect(findUserByName(db, 'christy')?.passwordHash).toBe('scrypt$x$y$z');
    const recipes = listRecipes(db, 1);
    expect(recipes).toEqual([
      {
        id: 'lemon-pasta',
        name: 'Lemon Pasta',
        baseServings: 4,
        activeMinutes: 15,
        totalMinutes: 25,
        ingredients: [{ name: 'spaghetti', quantity: { amount: 1, unit: 'lb' }, section: 'dry-goods' }],
        advancePrep: [{ id: 'zest', description: 'Zest', leadDays: 1, activeMinutes: 5 }],
        instructions: [],
      },
    ]);
    const state = getUserState(db, 1);
    expect(state.plan.entries).toHaveLength(1);
    expect(state.checked).toEqual({ 'spaghetti|mass': true });
    expect(state.shoppingEdits).toEqual({ extras: [], removed: [] });
    db.close();

    // Opening again is a no-op (idempotent), and the v1 tables still have their data.
    const again = openDatabase(file);
    expect(schemaVersion(again)).toBe(SCHEMA_VERSION);
    expect(listRecipes(again, 1)).toHaveLength(1);
    again.close();
  });

  it('a newer-than-known database is refused rather than touched', () => {
    const file = v1Database();
    const db = new DatabaseSync(file);
    db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION + 1);
    db.close();
    expect(() => openDatabase(file)).toThrow(/newer than this build/);
  });
});
