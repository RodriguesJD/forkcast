import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Recipe, ShoppingEdits, WeekPlan } from '../src/domain/types';
import { defaultSettings } from '../src/domain/defaults';
import { emptyShoppingEdits } from '../src/domain/shopping';

/**
 * The only module that talks to SQLite. Everything is synchronous (node:sqlite
 * is), which is fine for one household on one box. Rows go in and out as the
 * domain types; ingredients and advance prep are JSON columns because nothing
 * ever queries inside them and the Recipe type must round-trip unchanged.
 */

/**
 * Bump when adding a migration below. Migrations are additive only (new tables,
 * new columns with defaults, new indexes): the database on the box is live data,
 * an older server must still open a newer file, and a failed step must leave the
 * file untouched (each migration runs in one transaction). See CLAUDE.md.
 */
export const SCHEMA_VERSION = 2;

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRow {
  tokenHash: string;
  userId: number;
  createdAt: string;
  expiresAt: string;
}

export interface UserState {
  plan: WeekPlan;
  checked: Record<string, boolean>;
  shoppingEdits: ShoppingEdits;
}

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

export function openMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** The v1 schema. Later versions only ever add to it (see MIGRATIONS). */
export const BASE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS recipes (
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id                TEXT NOT NULL,
      name              TEXT NOT NULL,
      base_servings     INTEGER NOT NULL,
      active_minutes    INTEGER NOT NULL,
      total_minutes     INTEGER NOT NULL,
      ingredients_json  TEXT NOT NULL,
      advance_prep_json TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );
    CREATE TABLE IF NOT EXISTS plans (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      plan_json    TEXT NOT NULL,
      checked_json TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
`;

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** MIGRATIONS[n] brings a version n-1 database to version n. Version 1 is BASE_SCHEMA_SQL. */
const MIGRATIONS: Record<number, (db: DatabaseSync) => void> = {
  2: (db) => {
    addColumn(db, 'recipes', 'instructions_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, 'recipes', 'source_url', 'TEXT');
    addColumn(db, 'plans', 'shopping_edits_json', `TEXT NOT NULL DEFAULT '{"extras":[],"removed":[]}'`);
  },
};

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
  return row?.version ?? 0;
}

function migrate(db: DatabaseSync): void {
  db.exec(BASE_SCHEMA_SQL);
  let version = schemaVersion(db);
  if (version === 0) {
    db.prepare('INSERT INTO schema_version (version) VALUES (1)').run();
    version = 1;
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`database schema version ${version} is newer than this build (${SCHEMA_VERSION})`);
  }
  while (version < SCHEMA_VERSION) {
    const next = version + 1;
    const step = MIGRATIONS[next];
    if (!step) throw new Error(`no migration to schema version ${next}`);
    db.exec('BEGIN');
    try {
      step(db);
      db.prepare('UPDATE schema_version SET version = ?').run(next);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    version = next;
  }
}

const now = () => new Date().toISOString();

// ---------- users ----------

function toUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as number,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    createdAt: row.created_at as string,
  };
}

export function countUsers(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function findUserByName(db: DatabaseSync, username: string): UserRow | undefined {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  return row ? toUser(row) : undefined;
}

export function findUserById(db: DatabaseSync, id: number): UserRow | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? toUser(row) : undefined;
}

/** Returns the new user, or undefined when the name is taken (case-insensitively). */
export function insertUser(db: DatabaseSync, username: string, passwordHash: string): UserRow | undefined {
  try {
    const result = db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, now());
    return findUserById(db, Number(result.lastInsertRowid));
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) return undefined;
    throw err;
  }
}

// ---------- sessions ----------

export function insertSession(db: DatabaseSync, tokenHash: string, userId: number, expiresAt: string): void {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    userId,
    now(),
    expiresAt,
  );
}

export function findSession(db: DatabaseSync, tokenHash: string): SessionRow | undefined {
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
  if (!row) return undefined;
  return {
    tokenHash: row.token_hash as string,
    userId: row.user_id as number,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
  };
}

export function extendSession(db: DatabaseSync, tokenHash: string, expiresAt: string): void {
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
}

export function deleteSession(db: DatabaseSync, tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteExpiredSessions(db: DatabaseSync): number {
  return Number(db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()).changes);
}

// ---------- recipes ----------

function toRecipe(row: Record<string, unknown>): Recipe {
  const recipe: Recipe = {
    id: row.id as string,
    name: row.name as string,
    baseServings: row.base_servings as number,
    activeMinutes: row.active_minutes as number,
    totalMinutes: row.total_minutes as number,
    ingredients: JSON.parse(row.ingredients_json as string),
    advancePrep: JSON.parse(row.advance_prep_json as string),
    instructions: JSON.parse((row.instructions_json as string | null) ?? '[]'),
  };
  if (typeof row.source_url === 'string' && row.source_url.length > 0) recipe.sourceUrl = row.source_url;
  return recipe;
}

export function listRecipes(db: DatabaseSync, userId: number): Recipe[] {
  return db
    .prepare('SELECT * FROM recipes WHERE user_id = ? ORDER BY name COLLATE NOCASE, id')
    .all(userId)
    .map(toRecipe);
}

export function findRecipe(db: DatabaseSync, userId: number, id: string): Recipe | undefined {
  const row = db.prepare('SELECT * FROM recipes WHERE user_id = ? AND id = ?').get(userId, id);
  return row ? toRecipe(row) : undefined;
}

export function insertRecipe(db: DatabaseSync, userId: number, recipe: Recipe): void {
  const t = now();
  db.prepare(
    `INSERT INTO recipes (user_id, id, name, base_servings, active_minutes, total_minutes,
       ingredients_json, advance_prep_json, instructions_json, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    recipe.id,
    recipe.name,
    recipe.baseServings,
    recipe.activeMinutes,
    recipe.totalMinutes,
    JSON.stringify(recipe.ingredients),
    JSON.stringify(recipe.advancePrep),
    JSON.stringify(recipe.instructions ?? []),
    recipe.sourceUrl ?? null,
    t,
    t,
  );
}

export function insertRecipes(db: DatabaseSync, userId: number, recipes: readonly Recipe[]): void {
  db.exec('BEGIN');
  try {
    for (const r of recipes) insertRecipe(db, userId, r);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Returns false when the recipe does not exist for this user. */
export function updateRecipe(db: DatabaseSync, userId: number, recipe: Recipe): boolean {
  const result = db
    .prepare(
      `UPDATE recipes SET name = ?, base_servings = ?, active_minutes = ?, total_minutes = ?,
         ingredients_json = ?, advance_prep_json = ?, instructions_json = ?, source_url = ?, updated_at = ?
       WHERE user_id = ? AND id = ?`,
    )
    .run(
      recipe.name,
      recipe.baseServings,
      recipe.activeMinutes,
      recipe.totalMinutes,
      JSON.stringify(recipe.ingredients),
      JSON.stringify(recipe.advancePrep),
      JSON.stringify(recipe.instructions ?? []),
      recipe.sourceUrl ?? null,
      now(),
      userId,
      recipe.id,
    );
  return Number(result.changes) > 0;
}

export function deleteRecipe(db: DatabaseSync, userId: number, id: string): boolean {
  return Number(db.prepare('DELETE FROM recipes WHERE user_id = ? AND id = ?').run(userId, id).changes) > 0;
}

// ---------- plan + shopping checkboxes ----------

const EMPTY_EDITS_JSON = JSON.stringify(emptyShoppingEdits());

export function getUserState(db: DatabaseSync, userId: number): UserState {
  const row = db.prepare('SELECT plan_json, checked_json, shopping_edits_json FROM plans WHERE user_id = ?').get(userId);
  if (!row) return { plan: { settings: defaultSettings(), entries: [] }, checked: {}, shoppingEdits: emptyShoppingEdits() };
  return {
    plan: JSON.parse(row.plan_json as string),
    checked: JSON.parse(row.checked_json as string),
    shoppingEdits: JSON.parse((row.shopping_edits_json as string | null) ?? EMPTY_EDITS_JSON),
  };
}

export function savePlan(db: DatabaseSync, userId: number, plan: WeekPlan): void {
  db.prepare(
    `INSERT INTO plans (user_id, plan_json, checked_json, updated_at) VALUES (?, ?, '{}', ?)
     ON CONFLICT(user_id) DO UPDATE SET plan_json = excluded.plan_json, updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(plan), now());
}

export function saveChecked(db: DatabaseSync, userId: number, checked: Record<string, boolean>): void {
  const plan = JSON.stringify({ settings: defaultSettings(), entries: [] });
  db.prepare(
    `INSERT INTO plans (user_id, plan_json, checked_json, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET checked_json = excluded.checked_json, updated_at = excluded.updated_at`,
  ).run(userId, plan, JSON.stringify(checked), now());
}

export function saveShoppingEdits(db: DatabaseSync, userId: number, edits: ShoppingEdits): void {
  const plan = JSON.stringify({ settings: defaultSettings(), entries: [] });
  db.prepare(
    `INSERT INTO plans (user_id, plan_json, checked_json, shopping_edits_json, updated_at) VALUES (?, ?, '{}', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET shopping_edits_json = excluded.shopping_edits_json, updated_at = excluded.updated_at`,
  ).run(userId, plan, JSON.stringify(edits), now());
}

// ---------- backups ----------

export const BACKUP_PREFIX = 'forkcast-';
export const BACKUP_SUFFIX = '.sqlite';

export function listBackups(dir: string): { file: string; mtimeMs: number }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX))
    .map((n) => ({ file: join(dir, n), mtimeMs: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Write a consistent snapshot with `VACUUM INTO` (safe while the database is in
 * use), then prune to the newest `keep`. Returns the new file's path.
 */
export function backupDatabase(db: DatabaseSync, dir: string, keep: number, at: Date = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = at.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const file = join(dir, `${BACKUP_PREFIX}${stamp}${BACKUP_SUFFIX}`);
  db.prepare('VACUUM INTO ?').run(file);
  for (const old of listBackups(dir).slice(keep)) unlinkSync(old.file);
  return file;
}
