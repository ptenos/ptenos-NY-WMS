import { readFile } from "node:fs/promises";
import { getStore } from "@netlify/blobs";
import { emptyState, handleApiRequest, migrateDb } from "../../backend/core.js";

const stateKey = "state";

export default async function handler(request) {
  if (request.method === "OPTIONS") return response(204, {});

  const url = new URL(request.url);
  const pathname = apiPathname(url.pathname);
  let snapshot = null;

  try {
    const body = await readBody(request);
    const result = await handleApiRequest({
      method: request.method,
      pathname,
      query: url.searchParams,
      headers: request.headers,
      body,
      storage: {
        readDb: async () => {
          snapshot = await readSnapshot();
          return clone(snapshot.db);
        },
        writeDb: async (db) => writeSnapshot(db, snapshot?.etag || null, snapshot?.db || null),
        readBackup: async (key) => readAutoBackup(key)
      }
    });
    return response(result.status, result.data);
  } catch (error) {
    const status = error.status || 500;
    return response(status, { error: error.message || "Server error" });
  }
}

function apiPathname(pathname) {
  const functionPrefix = "/.netlify/functions/api";
  if (pathname.startsWith(functionPrefix)) return `/api${pathname.slice(functionPrefix.length) || ""}`;
  return pathname.startsWith("/api/") ? pathname : `/api${pathname}`;
}

async function readBody(request) {
  if (!["POST", "PUT", "PATCH"].includes(request.method)) return {};
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

async function readSnapshot() {
  const store = getStateStore();
  const entry = await store.getWithMetadata(stateKey, { consistency: "strong", type: "json" });
  if (entry?.data) return { db: migrateDb(entry.data), etag: entry.etag };
  return { db: await initialState(), etag: null };
}

async function writeSnapshot(db, etag, previousDb) {
  const store = getStateStore();
  await writeAutoBackup(previousDb);
  const result = await store.setJSON(stateKey, db, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
  if (!result.modified) {
    const error = new Error("库存已被其他人更新，请刷新后重试");
    error.status = 409;
    throw error;
  }
}

async function writeAutoBackup(db) {
  if (!db) return;
  try {
    const backup = {
      backupAt: new Date().toISOString(),
      version: 1,
      data: { ...db, sessions: [] }
    };
    const day = backup.backupAt.slice(0, 10);
    const store = getStore("wms-lite-backups", { consistency: "strong" });
    await Promise.all([
      store.setJSON("latest", backup),
      store.setJSON(`daily-${day}`, backup)
    ]);
  } catch (error) {
    console.warn("auto backup failed", error?.message || error);
  }
}

async function readAutoBackup(key) {
  const store = getStore("wms-lite-backups", { consistency: "strong" });
  return await store.get(key, { consistency: "strong", type: "json" });
}

function getStateStore() {
  return getStore("wms-lite-state", { consistency: "strong" });
}

async function initialState() {
  try {
    const file = new URL("../../backend/data/wms-lite.json", import.meta.url);
    return migrateDb(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return migrateDb(emptyState);
  }
}

function response(status, data) {
  return new Response(status === 204 ? "" : JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-WMS-Lite-Summary",
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export const config = {
  path: "/api/*"
};
