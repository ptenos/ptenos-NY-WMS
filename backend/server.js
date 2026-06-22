import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest, migrateDb } from "./core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const dataDir = process.env.WMS_DATA_DIR ? resolve(process.env.WMS_DATA_DIR) : join(__dirname, "data");
const dbPath = process.env.WMS_DB_PATH ? resolve(process.env.WMS_DB_PATH) : join(dataDir, "wms-lite.json");
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png"
};

const emptyState = {
  materials: [],
  locations: [],
  stock: [],
  logs: [],
  auditLogs: [],
  users: [
    { id: "admin", name: "管理员", role: "admin", password: "admin123" },
    { id: "WH-001", name: "仓库员工", role: "employee", password: "123456" },
    { id: "WH-MGR", name: "仓管", role: "keeper", password: "123456" }
  ],
  currentUserId: "admin"
};

await mkdir(dirname(dbPath), { recursive: true });
await ensureDb();

const server = createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === "OPTIONS") return sendJson(res, 204, {});

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleCoreApi(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
});

globalThis.__wmsLiteServer = server;

server.listen(port, "0.0.0.0", () => {
  console.log(`WMS Lite running at http://127.0.0.1:${port}`);
});

export { server, applyOperation, refreshLocationUsage, cleanup, makeLog, roundQty };

async function ensureDb() {
  try {
    await readFile(dbPath, "utf-8");
  } catch {
    await writeDb(emptyState);
  }
}

async function readDb() {
  const data = JSON.parse(await readFile(dbPath, "utf-8"));
  data.materials = (Array.isArray(data.materials) ? data.materials : []).map((item) => ({
    sku: item.sku,
    name: item.name
  }));
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.logs = Array.isArray(data.logs) ? data.logs : [];
  data.users = Array.isArray(data.users) ? data.users : emptyState.users;
  return data;
}

async function writeDb(data) {
  await writeFile(dbPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

async function handleCoreApi(req, res, url) {
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req) : {};
  const result = await handleApiRequest({
    method: req.method,
    pathname: url.pathname,
    query: url.searchParams,
    headers: req.headers,
    body,
    storage: {
      readDb: async () => migrateDb(await readDb()),
      writeDb: async (db) => writeDb(db),
      readBackup: async () => null
    }
  });
  return sendJson(res, result.status, result.data);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    return sendJson(res, 200, await readDb());
  }

  if (req.method === "PUT" && url.pathname === "/api/state") {
    return sendJson(res, 405, { error: "state cannot be overwritten; use operation APIs" });
  }

  if (req.method === "POST" && url.pathname === "/api/materials") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const sku = normalizeCode(body.sku);
    if (!sku || !body.name) return sendJson(res, 422, { error: "sku and name are required" });
    const previousSku = normalizeCode(body.previousSku);
    if (previousSku && previousSku !== sku && db.materials.some((item) => item.sku === sku)) {
      return sendJson(res, 409, { error: "物料编码已存在" });
    }
    if (!previousSku && db.materials.some((item) => item.sku === sku)) {
      return sendJson(res, 409, { error: "物料编码已存在，请搜索后修改" });
    }
    const existing = db.materials.find((item) => item.sku === (previousSku || sku));
    const before = existing ? { ...existing } : null;
    if (existing) {
      Object.assign(existing, { sku, name: body.name });
      if (previousSku && previousSku !== sku) {
        db.stock.forEach((row) => {
          if (row.sku === previousSku) {
            row.sku = sku;
            touchStock(row);
          }
        });
      }
    } else {
      db.materials.push({ sku, name: body.name });
    }
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: existing ? (previousSku && previousSku !== sku ? "修改物料编码" : "修改物料") : "新增物料",
      entity: "物料主数据",
      key: sku,
      before,
      after: { sku, name: body.name }
    }));
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/locations") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const code = normalizeCode(body.code);
    if (!code) return sendJson(res, 422, { error: "code is required" });
    const previousCode = normalizeCode(body.previousCode);
    if (previousCode && previousCode !== code && db.locations.some((item) => item.code === code)) {
      return sendJson(res, 409, { error: "库位编码已存在" });
    }
    if (!previousCode && db.locations.some((item) => item.code === code)) {
      return sendJson(res, 409, { error: "库位已存在，请搜索后修改" });
    }
    const existing = db.locations.find((item) => item.code === (previousCode || code));
    const before = existing ? { ...existing } : null;
    if (existing) {
      Object.assign(existing, { code, status: body.status || existing.status || "空闲" });
      if (previousCode && previousCode !== code) {
        db.stock.forEach((row) => {
          if (row.location === previousCode) {
            row.location = code;
            touchStock(row);
          }
          if (row.targetLocation === previousCode) row.targetLocation = code;
        });
      }
    } else {
      db.locations.push({ code, status: body.status || "空闲" });
    }
    refreshLocationUsage(db);
    const after = db.locations.find((item) => item.code === code) || { code, status: body.status || "空闲" };
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: existing ? (previousCode && previousCode !== code ? "修改库位编码" : "修改库位") : "新增库位",
      entity: "库位主数据",
      key: code,
      before,
      after
    }));
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/operations") {
    const db = await readDb();
    const operation = await readJson(req);
    const result = applyOperation(db, operation);
    if (result.error) return sendJson(res, 422, result);
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const id = normalizeCode(body.id);
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim();
    const userPassword = String(body.userPassword || "").trim();
    if (!id || !name || !["employee", "keeper", "admin"].includes(role)) return sendJson(res, 422, { error: "账号、姓名和角色不能为空" });
    const existing = db.users.find((user) => user.id === id);
    if (!existing && !userPassword) return sendJson(res, 422, { error: "新增账号必须设置密码" });
    const user = { id, name, role };
    if (userPassword) user.password = userPassword;
    const before = existing ? sanitizeUser(existing) : null;
    if (existing) Object.assign(existing, user);
    else db.users.push(user);
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: existing ? "修改账号" : "新增账号",
      entity: "账号权限",
      key: id,
      before,
      after: sanitizeUser(db.users.find((item) => item.id === id))
    }));
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/users/delete") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const targetId = normalizeCode(body.targetId);
    if (targetId === "ADMIN") return sendJson(res, 422, { error: "不能删除管理员账号" });
    const before = sanitizeUser(db.users.find((user) => user.id === targetId));
    db.users = db.users.filter((user) => user.id !== targetId);
    if (before) {
      db.auditLogs.unshift(makeAuditLog({
        actor,
        action: "删除账号",
        entity: "账号权限",
        key: targetId,
        before,
        after: null
      }));
    }
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/import-materials") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    let imported = 0;
    for (const row of rows) {
      const sku = normalizeCode(pickField(row, ["sku", "SKU", "物料编码", "存货编码"]));
      const name = String(pickField(row, ["name", "物料名称", "存货名称"]) || "").trim();
      if (!sku || !name) continue;
      upsertMaterial(db, { sku, name });
      imported += 1;
    }
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: "导入物料主数据",
      entity: "物料主数据",
      key: "IMPORT",
      before: null,
      after: { imported, sourceRows: rows.length },
      note: `导入物料 ${imported} 行`
    }));
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/import-locations") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    let imported = 0;
    for (const row of rows) {
      const code = normalizeCode(pickField(row, ["code", "location", "库位", "库位编码", "仓库名称", "仓库"]));
      const status = String(pickField(row, ["status", "状态", "库位状态"]) || "空闲").trim();
      if (!code) continue;
      const existing = db.locations.find((item) => item.code === code);
      if (existing) existing.status = status || existing.status || "空闲";
      else db.locations.push({ code, status: status || "空闲" });
      imported += 1;
    }
    refreshLocationUsage(db);
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: "导入库位主数据",
      entity: "库位主数据",
      key: "IMPORT",
      before: null,
      after: { imported, sourceRows: rows.length },
      note: `导入库位 ${imported} 行`
    }));
    await writeDb(db);
    return sendState(req, res, db);
  }

  if (req.method === "POST" && url.pathname === "/api/import-inventory") {
    const db = await readDb();
    const body = await readJson(req);
    const denied = requireAdmin(db, body.operatorId, body.password);
    if (denied) return sendJson(res, 403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const groupedRows = new Map();
    for (const row of rows) {
      const sku = normalizeCode(pickField(row, ["sku", "SKU", "物料编码", "存货编码"]));
      const name = String(pickField(row, ["name", "物料名称", "存货名称"]) || "").trim();
      const batch = normalizeCode(pickField(row, ["batch", "批号"]));
      const location = normalizeCode(pickField(row, ["location", "库位", "库位编码", "仓库名称", "仓库"]));
      const qty = parseSystemQty(pickField(row, ["qty", "数量", "可用数量", "现存量"]));
      const status = String(pickField(row, ["status", "状态", "库存状态"]) || "可用").trim();
      if (!sku || !name || !batch || !location || qty === null || qty <= 0) continue;
      const key = `${sku}||${batch}||${location}||${status}`;
      const existing = groupedRows.get(key);
      if (existing) existing.qty = roundQty(existing.qty + qty);
      else groupedRows.set(key, { sku, name, batch, location, status, qty });
    }
    for (const row of groupedRows.values()) {
      upsertMaterial(db, { sku: row.sku, name: row.name });
      upsertLocation(db, { code: row.location, status: "空闲" });
      setStock(db, { sku: row.sku, batch: row.batch, location: row.location, status: row.status, qty: row.qty });
    }
    const imported = groupedRows.size;
    refreshLocationUsage(db);
    db.logs.unshift(makeLog({
      type: "initial",
      operatorId: actor?.id || "",
      operatorName: actor?.name || "",
      operator: actor ? [actor.id, actor.name].filter(Boolean).join(" ") : body.operator || "system",
      sku: "IMPORT",
      qty: imported,
      note: `导入期初库存 ${imported} 行`
    }));
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: "导入期初库存",
      entity: "库存导入",
      key: "IMPORT",
      before: null,
      after: { imported, sourceRows: rows.length },
      note: `导入期初库存 ${imported} 行`
    }));
    await writeDb(db);
    return sendState(req, res, db);
  }

  return sendJson(res, 404, { error: "Not found" });
}

function applyOperation(db, operation) {
  const type = operation.type;
  const actor = getActor(db, operation.operatorId, operation.password);
  const denied = authorizeOperation(actor, type);
  if (denied) return { error: denied };
  const logActor = {
    operatorId: actor.id,
    operatorName: actor.name || "",
    operator: [actor.id, actor.name].filter(Boolean).join(" ")
  };
  const sku = normalizeCode(operation.sku);
  const batch = normalizeCode(operation.batch);
  const location = normalizeCode(operation.location);
  const targetLocation = normalizeCode(operation.targetLocation);
  const status = operation.status || "可用";
  const qty = parseSystemQty(operation.qty);

  if (!db.materials.some((item) => item.sku === sku)) return { error: "物料必须从主数据选择" };
  if (!db.locations.some((item) => item.code === location)) return { error: "库位必须从主数据选择" };
  if (!batch || qty === null || qty < 0) return { error: "数量只能使用系统数字格式，最多 6 位小数，例如 1000 或 1000.123456" };

  if (type === "in") {
    if (qty <= 0) return { error: "入库数量必须大于 0" };
    addStock(db, { sku, batch, location, status, qty });
  } else if (type === "out") {
    if (qty <= 0) return { error: "出库数量必须大于 0" };
    const row = findStock(db, { sku, batch, location, status });
    if (!row || row.qty < qty) return { error: "库存不足或状态不匹配" };
    const versionError = assertVersion(row, operation.expectedVersion);
    if (versionError) return versionError;
    row.qty = roundQty(row.qty - qty);
    touchStock(row);
  } else if (type === "move") {
    if (qty <= 0) return { error: "移库数量必须大于 0" };
    const target = db.locations.find((item) => item.code === targetLocation);
    if (!target) return { error: "目标库位必须从主数据选择" };
    if (target.status === "冻结") return { error: "目标库位已冻结" };
    const row = findStock(db, { sku, batch, location, status });
    if (!row || row.qty < qty) return { error: "原库位库存不足" };
    const versionError = assertVersion(row, operation.expectedVersion);
    if (versionError) return versionError;
    row.qty = roundQty(row.qty - qty);
    touchStock(row);
    addStock(db, { sku, batch, location: targetLocation, status, qty });
  } else if (type === "count") {
    const row = findStock(db, { sku, batch, location, status });
    const beforeQty = row ? row.qty : 0;
    if (row) {
      const versionError = assertVersion(row, operation.expectedVersion);
      if (versionError) return versionError;
    }
    setStock(db, { sku, batch, location, status, qty });
    db.logs.unshift(makeLog({ ...operation, ...logActor, type: "adjust", sku, batch, location, status, qty, beforeQty }));
    cleanup(db);
    refreshLocationUsage(db);
    return { ok: true };
  } else {
    return { error: "Unknown operation type" };
  }

  cleanup(db);
  refreshLocationUsage(db);
  db.logs.unshift(makeLog({ ...operation, ...logActor, sku, batch, location, targetLocation, status, qty }));
  return { ok: true };
}

function upsertMaterial(db, material) {
  const existing = db.materials.find((item) => item.sku === material.sku);
  if (existing) Object.assign(existing, material);
  else db.materials.push(material);
}

function upsertLocation(db, location) {
  const existing = db.locations.find((item) => item.code === location.code);
  if (!existing) db.locations.push(location);
}

function findStock(db, key) {
  return db.stock.find(
    (item) => item.sku === key.sku && item.batch === key.batch && item.location === key.location && item.status === key.status
  );
}

function addStock(db, row) {
  const existing = findStock(db, row);
  if (existing) {
    existing.qty = roundQty(existing.qty + row.qty);
    touchStock(existing);
  } else {
    db.stock.push({ id: globalThis.crypto.randomUUID(), ...row, qty: roundQty(row.qty), version: 1, updatedAt: new Date().toISOString() });
  }
}

function setStock(db, row) {
  const existing = findStock(db, row);
  if (existing) {
    existing.qty = roundQty(row.qty);
    touchStock(existing);
  } else if (row.qty > 0) {
    db.stock.push({ id: globalThis.crypto.randomUUID(), ...row, qty: roundQty(row.qty), version: 1, updatedAt: new Date().toISOString() });
  }
}

function touchStock(row) {
  row.version = Number(row.version || 0) + 1;
  row.updatedAt = new Date().toISOString();
}

function assertVersion(row, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === "") return null;
  return Number(row.version || 1) === Number(expectedVersion)
    ? null
    : { errorCode: "VERSION_CONFLICT", error: "库存已被其他人更新，请刷新后重试" };
}

function getActor(db, operatorId, password) {
  const user = db.users?.find((item) => item.id === operatorId) || null;
  if (!user) return null;
  if (user.password && user.password !== password) return null;
  return user;
}

function authorizeOperation(actor, type) {
  if (!actor) return "请先登录";
  const role = actor.role === "operator" ? "employee" : actor.role;
  if (role === "admin") return null;
  if (role === "keeper") return ["in", "out", "count"].includes(type) ? null : "仓管无权执行该操作";
  if (role === "employee") return ["in", "out"].includes(type) ? null : "员工无权执行该操作";
  return "账号权限无效";
}

function requireAdmin(db, operatorId, password) {
  const actor = getActor(db, operatorId, password);
  if (!actor) return "请先登录";
  return actor.role === "admin" ? null : "只有管理员可以执行该操作";
}

function cleanup(db) {
  db.stock = db.stock.filter((item) => item.qty > 0);
}

function refreshLocationUsage(db) {
  for (const location of db.locations) {
    if (location.status !== "冻结") {
      location.status = db.stock.some((item) => item.location === location.code) ? "占用" : "空闲";
    }
  }
}

function makeLog(payload) {
  const time = new Date();
  return {
    id: globalThis.crypto.randomUUID(),
    time: formatMinute(time),
    operatorId: payload.operatorId || "",
    operatorName: payload.operatorName || "",
    operator: payload.operator || "system",
    type: payload.type,
    sku: payload.sku || "",
    batch: payload.batch || "",
    qty: Number(payload.qty || 0),
    beforeQty: payload.beforeQty,
    location: payload.location || "",
    targetLocation: payload.targetLocation || "",
    status: payload.status || "",
    note: payload.note || "",
    gps: payload.gps || null
  };
}

function makeAuditLog(payload) {
  const actor = payload.actor || {};
  return {
    id: globalThis.crypto.randomUUID(),
    time: formatMinute(),
    operatorId: actor.id || payload.operatorId || "",
    operatorName: actor.name || payload.operatorName || "",
    action: payload.action || "",
    entity: payload.entity || "",
    key: payload.key || "",
    before: payload.before ?? null,
    after: payload.after ?? null,
    note: payload.note || ""
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.role };
}

function formatMinute(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function pickField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function parseSystemQty(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return null;
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(text)) return null;
  return Number(text);
}

function roundQty(value) {
  return Number(Number(value).toFixed(6));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf-8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(status === 204 ? "" : JSON.stringify(data));
}

function sendState(req, res, db) {
  if (req.headers["x-wms-lite-summary"] === "1") return sendJson(res, 200, stateSummary(db));
  return sendJson(res, 200, db);
}

function stateSummary(db) {
  return {
    materials: db.materials.length,
    locations: db.locations.length,
    stockRows: db.stock.length,
    logs: db.logs.length,
    auditLogs: db.auditLogs?.length || 0,
    users: db.users.length,
    totalQty: roundQty(db.stock.reduce((sum, item) => sum + Number(item.qty || 0), 0)),
    lastLog: db.logs[0] || null,
    lastAuditLog: db.auditLogs?.[0] || null
  };
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-WMS-Lite-Summary,X-WMS-Lite-Lite");
}

async function serveStatic(res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const requested = requestedPath === "/runtime.js" ? "/app.js" : requestedPath;
  const fullPath = normalize(join(projectRoot, requested));
  if (!fullPath.startsWith(projectRoot)) return sendJson(res, 403, { error: "Forbidden" });
  try {
    const info = await stat(fullPath);
    if (!info.isFile()) return sendJson(res, 404, { error: "Not found" });
    res.writeHead(200, { "Content-Type": contentTypes[extname(fullPath)] || "application/octet-stream" });
    createReadStream(fullPath).pipe(res);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}
