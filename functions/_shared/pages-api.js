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
  if (env?.WMS_DB) {
    return {
      readDb: async () => readState(env),
      writeDb: async (db) => writeState(env, db),
      readBackup: async (key) => readBackup(env, key)
    };
  }
  return {
    readDb: async () => readCacheState(),
    writeDb: async (db) => writeCacheState(db),
    readBackup: async (key) => readCacheBackup(key)
  };
}

async function readState(env) {
  const db = env?.WMS_DB;
  if (!db) throw new Error("Cloudflare D1 binding WMS_DB is missing");
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
  const row = await db.prepare(`SELECT payload FROM ${BACKUP_TABLE} WHERE backup_key = ?`).bind(key).first();
  return row ? JSON.parse(row.payload) : null;
}

async function readCacheState() {
  const cached = await readCacheJson(cacheKey("state"));
  if (!cached) return migrateDb(emptyState);
  return migrateDb(cached);
}

async function writeCacheState(dbState) {
  const payload = JSON.parse(JSON.stringify(dbState));
  await writeCacheJson(cacheKey("state"), payload);
  const day = new Date().toISOString().slice(0, 10);
  await writeCacheJson(cacheKey("backup/latest"), makeBackupPayload(payload));
  await writeCacheJson(cacheKey(`backup/daily-${day}`), makeBackupPayload(payload));
}

async function readCacheBackup(key) {
  return readCacheJson(cacheKey(`backup/${key}`));
}

function cacheKey(path) {
  return new Request(`https://wms-lite.local/${path}`, { method: "GET" });
}

async function readCacheJson(request) {
  const response = await caches.default.match(request);
  if (!response) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function writeCacheJson(request, data) {
  await caches.default.put(
    request,
    new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=31536000"
      }
    })
  );
}

function makeBackupPayload(dbState) {
  const data = {
    ...dbState,
    sessions: []
  };
  return {
    backupAt: new Date().toISOString(),
    backupAtLocal: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23"
    }).format(new Date()).replace(",", ""),
    timeZone: "Asia/Jakarta",
    version: 1,
    data
  };
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
