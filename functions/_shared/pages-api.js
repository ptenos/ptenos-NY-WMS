import { emptyState, handleApiRequest, migrateDb } from "../../backend/core.js";

const STATE_KEY = "state";
const BACKUP_TABLE = "wms_backups";
const STATE_TABLE = "wms_state";

export async function handlePagesApiRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return corsResponse(204, {});

  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);

  try {
    const body = await readBody(request);
    const storage = await resolveStorage(env);
    const result = await handleApiRequest({
      method: request.method,
      pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
      storage
    });
    return jsonResponse(result.status, result.data);
  } catch (error) {
    return jsonResponse(error.status || 500, { error: error.message || "Server error" });
  }
}

async function resolveStorage(env) {
  if (!env?.WMS_DB) {
    const error = new Error("Cloudflare D1 binding WMS_DB is missing");
    error.status = 503;
    throw error;
  }
  return {
    readDb: async () => readState(env),
    writeDb: async (db) => writeState(env, db),
    readBackup: async (key) => readBackup(env, key)
  };
}

async function readState(env) {
  const db = env?.WMS_DB;
  if (!db) throw new Error("Cloudflare D1 binding WMS_DB is missing");
  await ensureSchema(db);
  const row = await db.prepare(`SELECT payload, version FROM ${STATE_TABLE} WHERE id = ?`).bind(STATE_KEY).first();
  if (!row) {
    const seed = await initialState();
    await db.prepare(`INSERT INTO ${STATE_TABLE} (id, payload, version, updated_at) VALUES (?, ?, ?, datetime('now'))`)
      .bind(STATE_KEY, JSON.stringify(seed), 1)
      .run();
    return seed;
  }
  const data = await migrateDb(JSON.parse(row.payload || "{}"));
  data._etag = String(row.version || 1);
  return data;
}

async function writeState(env, dbState) {
  const db = env?.WMS_DB;
  if (!db) throw new Error("Cloudflare D1 binding WMS_DB is missing");
  await ensureSchema(db);
  const current = await db.prepare(`SELECT payload, version FROM ${STATE_TABLE} WHERE id = ?`).bind(STATE_KEY).first();
  const nextVersion = Number(current?.version || 0) + 1;
  const payload = JSON.stringify(dbState);
  await db.prepare(`INSERT INTO ${BACKUP_TABLE} (backup_key, payload, created_at) VALUES (?, ?, datetime('now')) ON CONFLICT(backup_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`)
    .bind("latest", current?.payload || payload)
    .run();
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO ${BACKUP_TABLE} (backup_key, payload, created_at) VALUES (?, ?, datetime('now')) ON CONFLICT(backup_key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`)
    .bind(`daily-${day}`, current?.payload || payload)
    .run();
  const result = await db.prepare(
    `UPDATE ${STATE_TABLE}
     SET payload = ?, version = ?, updated_at = datetime('now')
     WHERE id = ? AND version = ?`
  ).bind(payload, nextVersion, STATE_KEY, Number(current?.version || 1)).run();
  if (!result.success || result.meta?.changes !== 1) {
    const error = new Error("库存已被其他人更新，请刷新后重试");
    error.status = 409;
    throw error;
  }
}

async function readBackup(env, key) {
  const db = env?.WMS_DB;
  if (!db) throw new Error("Cloudflare D1 binding WMS_DB is missing");
  await ensureSchema(db);
  const row = await db.prepare(`SELECT payload FROM ${BACKUP_TABLE} WHERE backup_key = ?`).bind(key).first();
  return row ? JSON.parse(row.payload) : null;
}

async function ensureSchema(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS ${STATE_TABLE} (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
    backup_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS wms_stock (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    batch TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL,
    qty REAL NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS wms_logs (
    id TEXT PRIMARY KEY,
    time TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    type TEXT NOT NULL,
    sku TEXT NOT NULL,
    batch TEXT NOT NULL,
    qty REAL NOT NULL,
    before_qty REAL,
    location TEXT NOT NULL,
    target_location TEXT,
    status TEXT NOT NULL,
    note TEXT,
    gps TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS wms_audit_logs (
    id TEXT PRIMARY KEY,
    time TEXT NOT NULL,
    operator_id TEXT NOT NULL,
    operator_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    key TEXT NOT NULL,
    before TEXT,
    after TEXT,
    note TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS wms_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )`);
}

async function readBody(request) {
  if (!["POST", "PUT", "PATCH"].includes(request.method)) return {};
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

async function initialState() {
  return migrateDb(emptyState);
}

function normalizePathname(pathname) {
  return pathname.startsWith("/api/") ? pathname : `/api${pathname}`;
}

function jsonResponse(status, data) {
  return new Response(status === 204 ? "" : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-WMS-Lite-Summary"
    }
  });
}

function corsResponse(status, data) {
  return jsonResponse(status, data);
}
