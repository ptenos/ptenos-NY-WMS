import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const appTimeZone = "Asia/Jakarta";

const defaultUsers = [
  { id: "admin", name: "管理员", role: "admin", password: "admin123" },
  { id: "WH-001", name: "仓库员工", role: "employee", password: "123456" },
  { id: "WH-MGR", name: "仓管", role: "keeper", password: "123456" }
];

const emptyState = {
  materials: [],
  locations: [],
  stock: [],
  logs: [],
  auditLogs: [],
  sessions: [],
  users: defaultUsers,
  currentUserId: "admin"
};

function migrateDb(data = {}) {
  const merged = { ...emptyState, ...data };
  merged.materials = (Array.isArray(merged.materials) ? merged.materials : []).map((item) => ({
    sku: item.sku,
    name: item.name
  }));
  merged.locations = Array.isArray(merged.locations) ? merged.locations : [];
  merged.stock = (Array.isArray(merged.stock) ? merged.stock : []).map((row) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    ...row
  }));
  merged.logs = Array.isArray(merged.logs) ? merged.logs : [];
  merged.auditLogs = Array.isArray(merged.auditLogs) ? merged.auditLogs : [];
  merged.sessions = Array.isArray(merged.sessions) ? merged.sessions : [];
  merged.users = (Array.isArray(data.users) && data.users.length ? data.users : defaultUsers).map((user) => ({ ...user }));
  defaultUsers.forEach((user) => {
    if (!merged.users.some((item) => item.id === user.id)) merged.users.push({ ...user });
  });
  merged.users.forEach((user) => {
    if (user.role === "operator") user.role = "employee";
    if (!user.passwordHash) user.passwordHash = hashPassword(user.password || (user.role === "admin" ? "admin123" : "123456"));
    delete user.password;
  });
  cleanupSessions(merged);
  return merged;
}

async function handleApiRequest({ method, pathname, query, headers = {}, body = {}, storage }) {
  if (method === "GET" && pathname === "/api/health") {
    return json(200, { ok: true, time: new Date().toISOString() });
  }

  if (method === "POST" && pathname === "/api/login") {
    const db = await storage.readDb();
    const user = findUserById(db, body.userId);
    if (!user || !verifyPassword(user, body.password)) return json(401, { error: "账号或密码错误" });
    cleanupSessions(db);
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.sessions.unshift({ token, userId: user.id, expiresAt, createdAt: new Date().toISOString() });
    await storage.writeDb(db);
    const mustChangePassword = isDefaultAdminPassword(user);
    return json(200, {
      user: { ...sanitizeUser(user), mustChangePassword },
      token,
      expiresAt,
      mustChangePassword,
      state: liteState(db)
    });
  }

  if (method === "POST" && pathname === "/api/logout") {
    const db = await storage.readDb();
    const token = authToken(body, headers);
    if (token) {
      db.sessions = db.sessions.filter((session) => session.token !== token);
      await storage.writeDb(db);
    }
    return json(200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/state") {
    return json(200, statePayload(headers, await storage.readDb(), query));
  }

  if (method === "GET" && pathname === "/api/backup") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, "", "", authToken(body, headers));
    if (denied) return json(403, { error: denied });
    return json(200, backupPayload(db));
  }

  if (method === "GET" && pathname === "/api/auto-backup") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, "", "", authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const backup = await storage.readBackup?.("latest");
    if (!backup) return json(404, { error: "暂无自动备份" });
    return json(200, backup);
  }

  if (method === "POST" && pathname === "/api/restore-backup") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
    const restored = restorePayload(body);
    if (restored.error) return json(422, { error: restored.error });
    const nextDb = restored.db;
    nextDb.sessions = db.sessions;
    nextDb.auditLogs.unshift(makeAuditLog({
      actor,
      action: "恢复备份",
      entity: "系统数据",
      key: "RESTORE",
      before: stateSummary(db),
      after: stateSummary(nextDb),
      note: "管理员从备份文件恢复"
    }));
    await storage.writeDb(nextDb);
    return json(200, statePayload(headers, nextDb));
  }

  if (method === "GET" && pathname === "/api/stock") {
    return json(200, stockPayload(await storage.readDb(), query));
  }

  if (method === "GET" && pathname === "/api/logs") {
    return json(200, logPayload(await storage.readDb(), query, "logs"));
  }

  if (method === "GET" && pathname === "/api/audit-logs") {
    return json(200, logPayload(await storage.readDb(), query, "auditLogs"));
  }

  if (method === "GET" && pathname === "/api/materials") {
    return json(200, materialListPayload(await storage.readDb(), query));
  }

  if (method === "GET" && pathname === "/api/locations") {
    return json(200, locationListPayload(await storage.readDb(), query));
  }

  if (method === "GET" && pathname === "/api/material-search") {
    return json(200, materialSearchPayload(await storage.readDb(), query));
  }

  if (method === "GET" && pathname === "/api/location-search") {
    return json(200, locationSearchPayload(await storage.readDb(), query));
  }

  if (method === "PUT" && pathname === "/api/state") {
    return json(405, { error: "state cannot be overwritten; use operation APIs" });
  }

  if (method === "POST" && pathname === "/api/materials") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
    const sku = normalizeCode(body.sku);
    if (!sku || !body.name) return json(422, { error: "sku and name are required" });
    const previousSku = normalizeCode(body.previousSku);
    if (previousSku && previousSku !== sku && db.materials.some((item) => item.sku === sku)) {
      return json(409, { error: "物料编码已存在" });
    }
    if (!previousSku && db.materials.some((item) => item.sku === sku)) {
      return json(409, { error: "物料编码已存在，请搜索后修改" });
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/locations") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
    const code = normalizeCode(body.code);
    if (!code) return json(422, { error: "code is required" });
    const previousCode = normalizeCode(body.previousCode);
    if (previousCode && previousCode !== code && db.locations.some((item) => item.code === code)) {
      return json(409, { error: "库位编码已存在" });
    }
    if (!previousCode && db.locations.some((item) => item.code === code)) {
      return json(409, { error: "库位已存在，请搜索后修改" });
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/operations") {
    const db = await storage.readDb();
    const result = applyOperation(db, body, authToken(body, headers));
    if (result.error) return json(422, result);
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/users") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
    const id = normalizeCode(body.id);
    const name = String(body.name || "").trim();
    const role = String(body.role || "").trim();
    const userPassword = String(body.userPassword || "").trim();
    if (!id || !name || !["employee", "keeper", "admin"].includes(role)) return json(422, { error: "账号、姓名和角色不能为空" });
    const existing = db.users.find((user) => user.id === id);
    if (!existing && !userPassword) return json(422, { error: "新增账号必须设置密码" });
    const user = { id, name, role };
    if (userPassword) user.passwordHash = hashPassword(userPassword);
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/users/delete") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
    const targetId = normalizeCode(body.targetId);
    if (targetId === "ADMIN") return json(422, { error: "不能删除管理员账号" });
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/import-materials") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/import-locations") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/import-inventory") {
    const db = await storage.readDb();
    const denied = requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = getActor(db, body.operatorId, body.password, authToken(body, headers));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const groupedRows = new Map();
    for (const row of rows) {
      const sku = normalizeCode(pickField(row, ["sku", "SKU", "物料编码", "存货编码"]));
      const name = String(pickField(row, ["name", "物料名称", "存货名称"]) || "").trim();
      const batch = normalizeCode(pickField(row, ["batch", "批号"]));
      const location = normalizeCode(pickField(row, ["location", "库位", "库位编码", "仓库名称", "仓库"]));
      const qty = parseSystemQty(pickField(row, ["qty", "数量", "可用数量", "现存量"]));
      const status = String(pickField(row, ["status", "状态", "库存状态"]) || "可用").trim();
      if (!sku || !name || !batch || !location || qty === null) continue;
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
      operator: actor ? `${actor.id} ${actor.name}` : body.operator || "system",
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
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/clear-master-data") {
    return json(403, { error: "清空基础数据接口已关闭" });
  }

  return json(404, { error: "Not found" });
}

function json(status, data) {
  return { status, data };
}

function statePayload(headers, db, query) {
  if (headerValue(headers, "x-wms-lite-summary") === "1") return stateSummary(db);
  if (isLiteState(headers, query)) return liteState(db);
  return publicState(db);
}

function headerValue(headers, key) {
  const lowerKey = key.toLowerCase();
  if (headers?.get) return headers.get(key) || headers.get(lowerKey) || "";
  return headers?.[key] || headers?.[lowerKey] || "";
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

function liteState(db) {
  return {
    materials: [],
    locations: [],
    stock: [],
    logs: [],
    auditLogs: [],
    users: db.users.map(sanitizeUser),
    currentUserId: "",
    summary: stateSummary(db)
  };
}

function publicState(db) {
  return {
    ...db,
    users: db.users.map(sanitizeUser),
    sessions: [],
    currentUserId: ""
  };
}

function backupPayload(db) {
  const data = {
    ...db,
    sessions: []
  };
  return {
    backupAt: new Date().toISOString(),
    backupAtLocal: formatMinute(),
    timeZone: appTimeZone,
    version: 1,
    data
  };
}

function restorePayload(body = {}) {
  const candidate = body.data || body.backup?.data || body.backup || body;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "备份文件格式不正确" };
  const db = migrateDb(candidate);
  if (!Array.isArray(db.materials) || !Array.isArray(db.locations) || !Array.isArray(db.stock)) {
    return { error: "备份文件缺少库存基础数据" };
  }
  return { db };
}

function isLiteState(headers, query) {
  return headerValue(headers, "x-wms-lite-lite") === "1" || queryValue(query, "lite") === "1";
}

function stockPayload(db, query) {
  const keyword = String(queryValue(query, "query") || "").trim();
  const sort = allowedValue(queryValue(query, "sort"), ["sku", "name", "batch", "location", "status", "qty"], "sku");
  const dir = allowedValue(queryValue(query, "dir"), ["asc", "desc"], "asc");
  const exportAll = queryValue(query, "export") === "1";
  const page = exportAll ? 1 : positiveInt(queryValue(query, "page"), 1, 1, 1000000);
  const pageSize = exportAll ? 1000000 : positiveInt(queryValue(query, "pageSize"), 50, 1, 200);
  const exact = {
    sku: normalizeCode(queryValue(query, "sku")),
    batch: normalizeCode(queryValue(query, "batch")),
    location: normalizeCode(queryValue(query, "location")),
    status: String(queryValue(query, "status") || "").trim()
  };
  const materialBySku = new Map(db.materials.map((item) => [item.sku, item]));
  const rows = db.stock
    .map((row) => {
      const material = materialBySku.get(row.sku);
      return { ...row, name: material?.name || row.name || "" };
    })
    .filter((row) => stockMatches(row, keyword, exact))
    .sort((a, b) => compareStockRows(a, b, keyword, sort, dir));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  const pageRows = exportAll ? rows : rows.slice(start, start + pageSize);
  const allLocations = [...new Set(rows.map((row) => row.location).filter(Boolean))];
  return {
    rows: pageRows,
    page: safePage,
    pageSize,
    pages,
    total,
    totalQty: roundQty(rows.reduce((sum, row) => sum + Number(row.qty || 0), 0)),
    locations: allLocations.slice(0, 30),
    locationCount: allLocations.length,
    sort,
    dir,
    query: keyword
  };
}

function logPayload(db, query, key) {
  const keyword = String(queryValue(query, "query") || "").trim();
  const page = positiveInt(queryValue(query, "page"), 1, 1, 1000000);
  const pageSize = positiveInt(queryValue(query, "pageSize"), 50, 1, 200);
  const source = Array.isArray(db[key]) ? db[key] : [];
  const rows = source.filter((row) => fuzzyMatchText(logSearchText(row, key), keyword));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    pages,
    total,
    query: keyword
  };
}

function materialSearchPayload(db, query) {
  const keyword = String(queryValue(query, "query") || "").trim();
  const limit = positiveInt(queryValue(query, "limit"), 20, 1, 50);
  const rows = db.materials
    .filter((row) => fuzzyMatchText(`${row.sku} ${row.name}`, keyword))
    .sort((a, b) => optionMatchRank([a.sku, a.name], keyword) - optionMatchRank([b.sku, b.name], keyword) || compareText(a.sku, b.sku))
    .slice(0, limit);
  return { rows, total: db.materials.length, query: keyword };
}

function materialListPayload(db, query) {
  const keyword = String(queryValue(query, "query") || "").trim();
  const page = positiveInt(queryValue(query, "page"), 1, 1, 1000000);
  const pageSize = positiveInt(queryValue(query, "pageSize"), 50, 1, 200);
  const rows = db.materials
    .filter((row) => fuzzyMatchText(`${row.sku} ${row.name}`, keyword))
    .sort((a, b) => optionMatchRank([a.sku, a.name], keyword) - optionMatchRank([b.sku, b.name], keyword) || compareText(a.sku, b.sku));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: safePage, pageSize, pages, total, query: keyword };
}

function locationSearchPayload(db, query) {
  const keyword = String(queryValue(query, "query") || "").trim();
  const limit = positiveInt(queryValue(query, "limit"), 20, 1, 50);
  const rows = db.locations
    .filter((row) => fuzzyMatchText(`${row.code} ${row.status || ""}`, keyword))
    .sort((a, b) => optionMatchRank([a.code, a.status], keyword) - optionMatchRank([b.code, b.status], keyword) || compareText(a.code, b.code))
    .slice(0, limit);
  return { rows, total: db.locations.length, query: keyword };
}

function locationListPayload(db, query) {
  const keyword = String(queryValue(query, "query") || "").trim();
  const page = positiveInt(queryValue(query, "page"), 1, 1, 1000000);
  const pageSize = positiveInt(queryValue(query, "pageSize"), 50, 1, 200);
  const stockCountByLocation = new Map();
  for (const row of db.stock) {
    stockCountByLocation.set(row.location, (stockCountByLocation.get(row.location) || 0) + 1);
  }
  const rows = db.locations
    .filter((row) => fuzzyMatchText(`${row.code} ${row.status || ""}`, keyword))
    .sort((a, b) => optionMatchRank([a.code, a.status], keyword) - optionMatchRank([b.code, b.status], keyword) || compareText(a.code, b.code))
    .map((row) => ({ ...row, stockRows: stockCountByLocation.get(row.code) || 0 }));
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const start = (safePage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: safePage, pageSize, pages, total, query: keyword };
}

function optionMatchRank(fields, keyword) {
  const text = normalizeSearch(keyword);
  if (!text) return 0;
  const compactText = text.replace(/\s+/g, "");
  const values = fields.map((field) => normalizeSearch(field));
  if (values.some((field) => field === text || field.replace(/\s+/g, "") === compactText)) return 0;
  if (values.some((field) => field.startsWith(text) || field.replace(/\s+/g, "").startsWith(compactText))) return 1;
  return 2;
}

function stockMatches(row, keyword, exact) {
  if (exact.sku && row.sku !== exact.sku) return false;
  if (exact.batch && row.batch !== exact.batch) return false;
  if (exact.location && row.location !== exact.location) return false;
  if (exact.status && row.status !== exact.status) return false;
  return fuzzyMatchText(`${row.sku} ${row.name || ""} ${row.batch} ${row.location} ${row.status}`, keyword);
}

function compareStockRows(a, b, keyword, sort, dir) {
  const rankDiff = stockMatchRank(a, keyword) - stockMatchRank(b, keyword);
  if (rankDiff) return rankDiff;
  let result = 0;
  if (sort === "qty") result = Number(a.qty || 0) - Number(b.qty || 0);
  else result = compareText(stockField(a, sort), stockField(b, sort));
  if (dir === "desc") result *= -1;
  return result ||
    compareText(a.sku, b.sku) ||
    compareText(a.batch, b.batch) ||
    compareText(a.location, b.location);
}

function stockMatchRank(row, keyword) {
  const text = normalizeSearch(keyword);
  if (!text) return 0;
  const compactText = text.replace(/\s+/g, "");
  const fields = ["sku", "name", "batch", "location", "status"].map((key) => normalizeSearch(stockField(row, key)));
  if (fields.some((field) => field === text || field.replace(/\s+/g, "") === compactText)) return 0;
  if (fields.some((field) => field.startsWith(text) || field.replace(/\s+/g, "").startsWith(compactText))) return 1;
  if (fields.some((field) => field.includes(text) || field.replace(/\s+/g, "").includes(compactText))) return 2;
  return 3;
}

function stockField(row, key) {
  if (key === "name") return row.name || "";
  return row[key] ?? "";
}

function compareText(a, b) {
  return String(a || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .localeCompare(String(b || "").replace(/\s+/g, " ").trim().toUpperCase(), "zh-CN", { numeric: true, sensitivity: "base" });
}

function logSearchText(row, key) {
  if (key === "auditLogs") {
    return `${row.operatorId || ""} ${row.operatorName || ""} ${formatMinute(row.time)} ${row.action || ""} ${row.entity || ""} ${row.key || ""} ${auditValue(row.before)} ${auditValue(row.after)} ${row.note || ""}`;
  }
  return `${row.operatorId || ""} ${row.operatorName || ""} ${row.operator || ""} ${formatMinute(row.time)} ${typeLabel(row.type)} ${Object.values(row).join(" ")}`;
}

function auditValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "object") return String(value);
  return Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== "")
    .map(([key, entryValue]) => `${key}:${entryValue}`)
    .join(" / ");
}

function typeLabel(type) {
  return { in: "入库", out: "出库", move: "移库", count: "盘点", adjust: "盘点调整", initial: "期初" }[type] || type || "";
}

function fuzzyMatchText(text, keyword) {
  const tokens = normalizeSearch(keyword).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const normalized = normalizeSearch(text);
  const compact = normalized.replace(/\s+/g, "");
  return tokens.every((token) => {
    const compactToken = token.replace(/\s+/g, "");
    return normalized.includes(token) || compact.includes(compactToken);
  });
}

function fuzzySequence(text, token) {
  if (!token) return true;
  let index = 0;
  for (const char of text) {
    if (char === token[index]) index += 1;
    if (index === token.length) return true;
  }
  return false;
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function allowedValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function positiveInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function queryValue(query, key) {
  if (!query) return "";
  if (query.get) return query.get(key) || "";
  return query[key] || "";
}

function applyOperation(db, operation, token = "") {
  const type = operation.type;
  const actor = getActor(db, operation.operatorId, operation.password, operation.sessionToken || operation.token || token);
  const denied = authorizeOperation(actor, type);
  if (denied) return { error: denied };
  const logActor = {
    operatorId: actor.id,
    operatorName: actor.name,
    operator: `${actor.id} ${actor.name}`
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
    if (versionError) return { error: versionError };
    row.qty = roundQty(row.qty - qty);
    touchStock(row);
  } else if (type === "move") {
    if (qty <= 0) return { error: "移库数量必须大于 0" };
    const target = db.locations.find((item) => item.code === targetLocation);
    if (!target) return { error: "目标库位必须从主数据选择" };
    if (target.status === "冻结") return { error: "目标库位已冻结" };
    if (targetLocation === location) return { error: "目标库位不能和原库位相同" };
    const row = findStock(db, { sku, batch, location, status });
    if (!row || row.qty < qty) return { error: "原库位库存不足" };
    const versionError = assertVersion(row, operation.expectedVersion);
    if (versionError) return { error: versionError };
    row.qty = roundQty(row.qty - qty);
    touchStock(row);
    addStock(db, { sku, batch, location: targetLocation, status, qty });
  } else if (type === "count") {
    const sourceSku = normalizeCode(operation.sourceSku || operation.sku);
    const sourceBatch = normalizeCode(operation.sourceBatch || operation.batch);
    const sourceLocation = normalizeCode(operation.sourceLocation || operation.location);
    const sourceStatus = operation.sourceStatus || status;
    if (sourceSku !== sku || sourceBatch !== batch || sourceStatus !== status) return { error: "盘点只能调整选中的库存明细" };
    const target = db.locations.find((item) => item.code === location);
    if (!target) return { error: "盘点库位必须从主数据选择" };
    if (sourceLocation !== location && target.status === "冻结") return { error: "盘点库位已冻结，请换一个库位" };
    const row = findStock(db, { sku: sourceSku, batch: sourceBatch, location: sourceLocation, status: sourceStatus });
    if (!row) return { error: "请先选择要盘点的库存明细" };
    const beforeQty = row.qty;
    const versionError = assertVersion(row, operation.expectedVersion);
    if (versionError) return { error: versionError };
    if (sourceLocation === location) {
      row.qty = roundQty(qty);
      touchStock(row);
    } else {
      row.qty = 0;
      touchStock(row);
      if (qty > 0) addStock(db, { sku, batch, location, status, qty });
    }
    db.logs.unshift(makeLog({ ...operation, ...logActor, type: "adjust", sku, batch, location: sourceLocation, targetLocation: sourceLocation === location ? "" : location, status, qty, beforeQty }));
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
    db.stock.push({ id: randomUUID(), ...row, qty: roundQty(row.qty), version: 1, updatedAt: new Date().toISOString() });
  }
}

function setStock(db, row) {
  const existing = findStock(db, row);
  if (existing) {
    existing.qty = roundQty(row.qty);
    touchStock(existing);
  } else if (row.qty > 0) {
    db.stock.push({ id: randomUUID(), ...row, qty: roundQty(row.qty), version: 1, updatedAt: new Date().toISOString() });
  }
}

function touchStock(row) {
  row.version = Number(row.version || 0) + 1;
  row.updatedAt = new Date().toISOString();
}

function assertVersion(row, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === "") return null;
  return Number(row.version || 1) === Number(expectedVersion) ? null : "库存已被其他人更新，请刷新后重试";
}

function getActor(db, operatorId, password, token = "") {
  const sessionActor = getActorByToken(db, token);
  if (sessionActor) return sessionActor;
  const user = findUserById(db, operatorId);
  if (!user) return null;
  if (!password || !verifyPassword(user, password)) return null;
  return user;
}

function getActorByToken(db, token) {
  const value = String(token || "").trim();
  if (!value) return null;
  cleanupSessions(db);
  const session = db.sessions.find((item) => item.token === value);
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function authorizeOperation(actor, type) {
  if (!actor) return "请先登录";
  const role = actor.role === "operator" ? "employee" : actor.role;
  if (role === "admin") return null;
  if (role === "keeper") return ["in", "out", "count"].includes(type) ? null : "仓管无权执行该操作";
  if (role === "employee") return ["in", "out"].includes(type) ? null : "员工无权执行该操作";
  return "账号权限无效";
}

function requireAdmin(db, operatorId, password, token = "") {
  const actor = getActor(db, operatorId, password, token);
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
    id: randomUUID(),
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
    id: randomUUID(),
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

function isDefaultAdminPassword(user) {
  return String(user?.id || "").toLowerCase() === "admin" && verifyPassword(user, "admin123");
}

function findUserById(db, userId) {
  const key = String(userId || "").trim().toLowerCase();
  if (!key) return null;
  return db.users?.find((item) => String(item.id).toLowerCase() === key) || null;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const iterations = 100000;
  const hash = pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function verifyPassword(user, password) {
  const stored = String(user?.passwordHash || "");
  const legacy = user?.password;
  if (!stored && legacy !== undefined) return String(legacy) === String(password || "");
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], "hex");
  const actual = pbkdf2Sync(String(password || ""), salt, iterations, expected.length, "sha256");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cleanupSessions(db) {
  const now = Date.now();
  db.sessions = (Array.isArray(db.sessions) ? db.sessions : []).filter((session) => {
    const expiresAt = new Date(session.expiresAt).getTime();
    return session.token && session.userId && Number.isFinite(expiresAt) && expiresAt > now;
  });
}

function authToken(body = {}, headers = {}) {
  const auth = headerValue(headers, "authorization");
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return String(body.sessionToken || body.token || "").trim();
}

function formatMinute(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: appTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23"
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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

export {
  applyOperation,
  cleanup,
  emptyState,
  handleApiRequest,
  makeLog,
  migrateDb,
  refreshLocationUsage,
  roundQty
};
