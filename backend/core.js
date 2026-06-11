const appTimeZone = "Asia/Jakarta";

const defaultUsers = [
  { id: "admin", role: "admin", password: "admin123" },
  { id: "WH-001", role: "employee", password: "123456" },
  { id: "WH-MGR", role: "keeper", password: "123456" }
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

async function migrateDb(data = {}) {
  const merged = { ...emptyState, ...data };
  merged.materials = (Array.isArray(merged.materials) ? merged.materials : []).map((item) => ({
    sku: item.sku,
    name: item.name
  }));
  merged.locations = (Array.isArray(merged.locations) ? merged.locations : []).map((item) => ({
    ...item,
    status: normalizeLocationStatus(item.status)
  }));
  merged.stock = (Array.isArray(merged.stock) ? merged.stock : []).map((row) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    ...row,
    status: normalizeStockStatus(row.status)
  }));
  merged.logs = Array.isArray(merged.logs) ? merged.logs : [];
  merged.auditLogs = Array.isArray(merged.auditLogs) ? merged.auditLogs : [];
  merged.sessions = Array.isArray(merged.sessions) ? merged.sessions : [];
  merged.users = (Array.isArray(data.users) && data.users.length ? data.users : defaultUsers).map((user) => ({ ...user }));
  defaultUsers.forEach((user) => {
    if (!merged.users.some((item) => item.id === user.id)) merged.users.push({ ...user });
  });
  for (const user of merged.users) {
    if (user.role === "operator") user.role = "employee";
    delete user.name;
    if (!user.passwordHash) {
      user.passwordHash = await hashPassword(user.password || (user.role === "admin" ? "admin123" : "123456"));
    }
    delete user.password;
  }
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
    if (!user || !(await verifyPassword(user, body.password))) return json(401, { errorCode: "INVALID_LOGIN", error: "Invalid username or password" });
    cleanupSessions(db);
    const token = globalThis.crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const session = { token, userId: user.id, expiresAt, createdAt: new Date().toISOString() };
    db.sessions.unshift(session);
    if (storage.createSession) await storage.createSession(session);
    else await storage.writeDb(db);
    const mustChangePassword = await isDefaultAdminPassword(user);
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
      if (storage.deleteSession) await storage.deleteSession(token);
      else await storage.writeDb(db);
    }
    return json(200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/session") {
    const db = await storage.readDb();
    const actor = getActorByToken(db, authToken(body, headers));
    if (!actor) return json(401, { errorCode: "UNAUTHORIZED", error: "Session expired" });
    const mustChangePassword = await isDefaultAdminPassword(actor);
    return json(200, {
      user: { ...sanitizeUser(actor), mustChangePassword },
      mustChangePassword,
      state: liteState(db)
    });
  }

  if (method === "GET" && pathname === "/api/state") {
    return json(200, statePayload(headers, await storage.readDb(), query));
  }

  if (method === "GET" && pathname === "/api/backup") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, "", "", authToken(body, headers));
    if (denied) return json(403, { error: denied });
    return json(200, backupPayload(db));
  }

  if (method === "GET" && pathname === "/api/auto-backup") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, "", "", authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const backup = await storage.readBackup?.("latest");
    if (!backup) return json(404, { errorCode: "USER_NOT_FOUND", error: "No auto backup available" });
    return json(200, backup);
  }

  if (method === "POST" && pathname === "/api/restore-backup") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const restored = await restorePayload(body);
    if (restored.error) return json(422, { errorCode: "INVALID_FILE", error: restored.error });
    const nextDb = restored.db;
    nextDb.sessions = db.sessions;
    nextDb.auditLogs.unshift(makeAuditLog({
      actor,
      action: "Restore Backup",
      entity: "System Data",
      key: "RESTORE",
      before: stateSummary(db),
      after: stateSummary(nextDb),
      note: "Admin restored data from backup file"
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
    return json(405, { errorCode: "FORBIDDEN", error: "state cannot be overwritten; use operation APIs" });
  }

  if (method === "POST" && pathname === "/api/materials") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const sku = normalizeCode(body.sku);
    if (!sku || !body.name) return json(422, { errorCode: "INVALID_QTY", error: "sku and name are required" });
    const previousSku = normalizeCode(body.previousSku);
    if (previousSku && previousSku !== sku && db.materials.some((item) => item.sku === sku)) {
      return json(409, { errorCode: "MATERIAL_EXISTS", error: "Material code already exists" });
    }
    if (!previousSku && db.materials.some((item) => item.sku === sku)) {
      return json(409, { errorCode: "MATERIAL_EXISTS", error: "Material code already exists; search and edit it" });
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
      action: existing ? (previousSku && previousSku !== sku ? "Edit Material Code" : "Edit Material") : "Add Material",
      entity: "Material Master",
      key: sku,
      before,
      after: { sku, name: body.name }
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/locations") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const code = normalizeCode(body.code);
    if (!code) return json(422, { errorCode: "INVALID_LOCATION", error: "code is required" });
    const previousCode = normalizeCode(body.previousCode);
    if (previousCode && previousCode !== code && db.locations.some((item) => item.code === code)) {
      return json(409, { errorCode: "LOCATION_EXISTS", error: "Location code already exists" });
    }
    if (!previousCode && db.locations.some((item) => item.code === code)) {
      return json(409, { errorCode: "LOCATION_EXISTS", error: "Location already exists; search and edit it" });
    }
    const existing = db.locations.find((item) => item.code === (previousCode || code));
    const before = existing ? { ...existing } : null;
    if (existing) {
      Object.assign(existing, { code, status: normalizeLocationStatus(body.status || existing.status || "empty") });
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
      db.locations.push({ code, status: normalizeLocationStatus(body.status || "empty") });
    }
    refreshLocationUsage(db);
    const after = db.locations.find((item) => item.code === code) || { code, status: normalizeLocationStatus(body.status || "empty") };
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: existing ? (previousCode && previousCode !== code ? "Edit Location Code" : "Edit Location") : "Add Location",
      entity: "Location Master",
      key: code,
      before,
      after
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/operations") {
    const db = await storage.readDb();
    const result = await applyOperation(db, body, authToken(body, headers));
    if (result.error) return json(422, result);
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/operations/batch") {
    const db = await storage.readDb();
    const batchItems = Array.isArray(body.batchItems) ? body.batchItems : [];
    if (!batchItems.length) return json(422, { errorCode: "INVALID_QTY", error: "batchItems are required" });
    const working = await migrateDb(db);
    for (const item of batchItems) {
      const result = await applyOperation(working, {
        ...body,
        batchItems: undefined,
        batch: item.batch,
        location: item.location,
        targetLocation: item.targetLocation,
        qty: item.qty,
        status: item.status,
        expectedVersion: item.expectedVersion,
        note: item.note
      }, authToken(body, headers));
      if (result.error) return json(422, { ...result, lineNo: item.lineNo });
    }
    await storage.writeDb(working);
    return json(200, statePayload(headers, working));
  }

  if (method === "POST" && pathname === "/api/users") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const id = normalizeCode(body.id);
    const role = String(body.role || "").trim();
    const userPassword = String(body.userPassword || "").trim();
    const name = String(body.name || id).trim() || id;
    if (!id || !["employee", "keeper", "admin"].includes(role)) return json(422, { errorCode: "INVALID_LOGIN", error: "Account and role are required" });
    const existing = db.users.find((user) => user.id === id);
    if (!existing && !userPassword) return json(422, { errorCode: "PASSWORD_REQUIRED", error: "Password is required for new account" });
    const user = { id, name, role };
    if (userPassword) user.passwordHash = await hashPassword(userPassword);
    const before = existing ? sanitizeUser(existing) : null;
    if (existing) Object.assign(existing, user);
    else db.users.push(user);
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: existing ? "Edit Account" : "Add Account",
      entity: "Account Permissions",
      key: id,
      before,
      after: sanitizeUser(db.users.find((item) => item.id === id))
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/users/password") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const targetId = normalizeCode(body.targetId);
    const userPassword = String(body.userPassword || "").trim();
    if (!targetId) return json(422, { errorCode: "USER_NOT_FOUND", error: "Account is required" });
    if (userPassword.length < 6) return json(422, { errorCode: "PASSWORD_TOO_SHORT", error: "Password must be at least 6 characters" });
    const target = findUserById(db, targetId);
    if (!target) return json(404, { errorCode: "USER_NOT_FOUND", error: "Account does not exist" });
    const before = sanitizeUser(target);
    target.passwordHash = await hashPassword(userPassword);
    delete target.password;
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: "Change Password",
      entity: "Account Permissions",
      key: targetId,
      before,
      after: sanitizeUser(target),
      note: "Admin reset account password"
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/users/delete") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const targetId = normalizeCode(body.targetId);
    const target = findUserById(db, targetId);
    if (target?.role === "admin") return json(422, { errorCode: "ADMIN_CANNOT_BE_DELETED", error: "Admin account cannot be deleted" });
    const before = sanitizeUser(target);
    db.users = db.users.filter((user) => user.id !== targetId);
    if (before) {
      db.auditLogs.unshift(makeAuditLog({
        actor,
        action: "Delete Account",
        entity: "Account Permissions",
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
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
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
      action: "Import Material Master",
      entity: "Material Master",
      key: "IMPORT",
      before: null,
      after: { imported, sourceRows: rows.length },
      note: `Imported ${imported} material rows`
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/import-locations") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    let imported = 0;
    for (const row of rows) {
      const code = normalizeCode(pickField(row, ["code", "location", "库位", "库位编码", "仓库名称", "仓库"]));
      const status = normalizeLocationStatus(pickField(row, ["status", "状态", "库位状态"]) || "empty");
      if (!code) continue;
      const existing = db.locations.find((item) => item.code === code);
      if (existing) existing.status = status || existing.status || "empty";
      else db.locations.push({ code, status: status || "empty" });
      imported += 1;
    }
    refreshLocationUsage(db);
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: "Import Location Master",
      entity: "Location Master",
      key: "IMPORT",
      before: null,
      after: { imported, sourceRows: rows.length },
      note: `Imported ${imported} location rows`
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/import-inventory") {
    const db = await storage.readDb();
    const denied = await requireAdmin(db, body.operatorId, body.password, authToken(body, headers));
    if (denied) return json(403, { error: denied });
    const actor = await getActor(db, body.operatorId, body.password, authToken(body, headers));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const groupedRows = new Map();
    for (const row of rows) {
      const sku = normalizeCode(pickField(row, ["sku", "SKU", "物料编码", "存货编码"]));
      const name = String(pickField(row, ["name", "物料名称", "存货名称"]) || "").trim();
      const batch = normalizeCode(pickField(row, ["batch", "批号"]));
      const location = normalizeCode(pickField(row, ["location", "库位", "库位编码", "仓库名称", "仓库"]));
      const qty = parseSystemQty(pickField(row, ["qty", "数量", "可用数量", "现存量"]));
      const status = normalizeStockStatus(pickField(row, ["status", "状态", "库存状态"]) || "available");
      if (!sku || !name || !batch || !location || qty === null) continue;
      const key = `${sku}||${batch}||${location}||${status}`;
      const existing = groupedRows.get(key);
      if (existing) existing.qty = roundQty(existing.qty + qty);
      else groupedRows.set(key, { sku, name, batch, location, status, qty });
    }
    for (const row of groupedRows.values()) {
      upsertMaterial(db, { sku: row.sku, name: row.name });
      upsertLocation(db, { code: row.location, status: "empty" });
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
      note: `Imported ${imported} initial stock rows`
    }));
    db.auditLogs.unshift(makeAuditLog({
      actor,
      action: "Import Initial Stock",
      entity: "Stock Import",
      key: "IMPORT",
      before: null,
      after: { imported, sourceRows: rows.length },
      note: `Imported ${imported} initial stock rows`
    }));
    await storage.writeDb(db);
    return json(200, statePayload(headers, db));
  }

  if (method === "POST" && pathname === "/api/clear-master-data") {
    return json(403, { errorCode: "FORBIDDEN", error: "Clear master data API is disabled" });
  }

  return json(404, { errorCode: "USER_NOT_FOUND", error: "Not found" });
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

async function restorePayload(body = {}) {
  const candidate = body.data || body.backup?.data || body.backup || body;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { error: "Invalid backup file format" };
  const db = await migrateDb(candidate);
  if (!Array.isArray(db.materials) || !Array.isArray(db.locations) || !Array.isArray(db.stock)) {
    return { error: "Backup file is missing required WMS data" };
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
  return { in: "Inbound", out: "Outbound", move: "Move", count: "Stock Count", adjust: "Stock Adjustment", initial: "Initial Stock" }[type] || type || "";
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

async function applyOperation(db, operation, token = "") {
  const type = operation.type;
  const actor = await getActor(db, operation.operatorId, operation.password, operation.sessionToken || operation.token || token);
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
  const status = normalizeStockStatus(operation.status || "available");
  const qty = parseSystemQty(operation.qty);

  if (!db.materials.some((item) => item.sku === sku)) return { errorCode: "MATERIAL_NOT_FOUND", error: "Material must be selected from master data" };
  if (!db.locations.some((item) => item.code === location)) return { errorCode: "INVALID_LOCATION", error: "Location must be selected from master data" };
  if (!batch || qty === null || qty < 0) return { errorCode: "INVALID_QTY", error: "Use standard quantity format, up to 6 decimals, e.g. 1000 or 1000.123456" };

  if (type === "in") {
    if (qty <= 0) return { errorCode: "INVALID_QTY", error: "Inbound quantity must be greater than 0" };
    addStock(db, { sku, batch, location, status, qty });
  } else if (type === "out") {
    if (qty <= 0) return { errorCode: "INVALID_QTY", error: "Outbound quantity must be greater than 0" };
    const row = findStock(db, { sku, batch, location, status });
    if (!row) return { errorCode: "STOCK_NOT_ENOUGH", error: "Stock not found or status mismatch" };
    if (Number(row.qty || 0) < qty) return { errorCode: "STOCK_NOT_ENOUGH", error: "Stock not enough for outbound" };
    const versionError = assertVersion(row, operation.expectedVersion);
    if (versionError) return { error: versionError };
    row.qty = roundQty(row.qty - qty);
    touchStock(row);
  } else if (type === "move") {
    if (qty <= 0) return { errorCode: "INVALID_QTY", error: "Move quantity must be greater than 0" };
    const target = db.locations.find((item) => item.code === targetLocation);
    if (!target) return { errorCode: "INVALID_LOCATION", error: "Target location must be selected from master data" };
    if (normalizeLocationStatus(target.status) === "frozen") return { errorCode: "TARGET_LOCATION_FROZEN", error: "Target location is frozen" };
    if (targetLocation === location) return { errorCode: "TARGET_LOCATION_SAME", error: "Target location cannot equal source location" };
    const row = findStock(db, { sku, batch, location, status });
    if (!row) return { errorCode: "STOCK_NOT_ENOUGH", error: "Source stock not found" };
    if (Number(row.qty || 0) < qty) return { errorCode: "STOCK_NOT_ENOUGH", error: "Source stock not enough for move" };
    const versionError = assertVersion(row, operation.expectedVersion);
    if (versionError) return { error: versionError };
    row.qty = roundQty(row.qty - qty);
    touchStock(row);
    addStock(db, { sku, batch, location: targetLocation, status, qty });
  } else if (type === "count") {
    const sourceSku = normalizeCode(operation.sourceSku || operation.sku);
    const sourceBatch = normalizeCode(operation.sourceBatch || operation.batch);
    const sourceLocation = normalizeCode(operation.sourceLocation || operation.location);
    const sourceStatus = normalizeStockStatus(operation.sourceStatus || status);
    if (sourceSku !== sku || sourceBatch !== batch || sourceStatus !== status) return { errorCode: "INVALID_QTY", error: "Stock count can only adjust selected stock detail" };
    const target = db.locations.find((item) => item.code === location);
    if (!target) return { errorCode: "INVALID_LOCATION", error: "Count location must be selected from master data" };
    if (sourceLocation !== location && normalizeLocationStatus(target.status) === "frozen") return { errorCode: "TARGET_LOCATION_FROZEN", error: "Count location is frozen" };
    const row = findStock(db, { sku: sourceSku, batch: sourceBatch, location: sourceLocation, status: sourceStatus });
    if (!row) return { errorCode: "INVALID_QTY", error: "Select stock detail before count" };
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
    return { errorCode: "FORBIDDEN", error: "Unknown operation type" };
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
    (item) => item.sku === key.sku &&
      item.batch === key.batch &&
      item.location === key.location &&
      normalizeStockStatus(item.status) === normalizeStockStatus(key.status)
  );
}

function addStock(db, row) {
  row.status = normalizeStockStatus(row.status);
  const existing = findStock(db, row);
  if (existing) {
    existing.qty = roundQty(existing.qty + row.qty);
    touchStock(existing);
  } else {
    db.stock.push({ id: globalThis.crypto.randomUUID(), ...row, qty: roundQty(row.qty), version: 1, updatedAt: new Date().toISOString() });
  }
}

function setStock(db, row) {
  row.status = normalizeStockStatus(row.status);
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
  return Number(row.version || 1) === Number(expectedVersion) ? null : "Stock has changed. Refresh and try again.";
}

async function getActor(db, operatorId, password, token = "") {
  const sessionActor = getActorByToken(db, token);
  if (sessionActor) return sessionActor;
  const user = findUserById(db, operatorId);
  if (!user) return null;
  if (!password || !(await verifyPassword(user, password))) return null;
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
  if (!actor) return "UNAUTHORIZED";
  const role = actor.role === "operator" ? "employee" : actor.role;
  if (role === "admin") return null;
  if (role === "keeper") return ["in", "out", "move", "count"].includes(type) ? null : "FORBIDDEN";
  if (role === "employee") return ["in", "out", "move"].includes(type) ? null : "FORBIDDEN";
  return "FORBIDDEN";
}

async function requireAdmin(db, operatorId, password, token = "") {
  const actor = await getActor(db, operatorId, password, token);
  if (!actor) return "UNAUTHORIZED";
  return actor.role === "admin" ? null : "FORBIDDEN";
}

function cleanup(db) {
  db.stock = db.stock.filter((item) => item.qty > 0);
}

function refreshLocationUsage(db) {
  for (const location of db.locations) {
    if (normalizeLocationStatus(location.status) !== "frozen") {
      location.status = db.stock.some((item) => item.location === location.code) ? "occupied" : "empty";
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
  return { id: user.id, role: user.role };
}

async function isDefaultAdminPassword(user) {
  return String(user?.id || "").toLowerCase() === "admin" && await verifyPassword(user, "admin123");
}

function findUserById(db, userId) {
  const key = String(userId || "").trim().toLowerCase();
  if (!key) return null;
  return db.users?.find((item) => String(item.id).toLowerCase() === key) || null;
}

async function hashPassword(password) {
  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const salt = bytesToHex(saltBytes);
  const digest = await digestText(`${salt}:${String(password || "")}`);
  return `sha256$${salt}$${digest}`;
}

async function verifyPassword(user, password) {
  const stored = String(user?.passwordHash || "");
  const legacy = user?.password;
  if (!stored && legacy !== undefined) return String(legacy) === String(password || "");
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "sha256") return false;
  const salt = parts[1];
  const expected = parts[2];
  const actual = await digestText(`${salt}:${String(password || "")}`);
  return timingSafeEqualText(expected, actual);
}

async function digestText(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualText(leftValue, rightValue) {
  const left = String(leftValue || "");
  const right = String(rightValue || "");
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
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

function normalizeStockStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (/^\?+$/.test(value)) return "available";
  const map = {
    available: "available",
    released: "available",
    release: "available",
    "可用": "available",
    pending: "pending",
    quarantine: "pending",
    "待检": "pending",
    hold: "hold",
    frozen: "hold",
    "冻结": "hold",
    reserved: "hold",
    "保留": "hold",
    reject: "reject",
    rejected: "reject",
    "不良": "reject"
  };
  return map[value] || value || "available";
}

function normalizeLocationStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  if (/^\?+$/.test(value)) return "empty";
  const map = {
    empty: "empty",
    "空闲": "empty",
    kosong: "empty",
    occupied: "occupied",
    "占用": "occupied",
    terisi: "occupied",
    frozen: "frozen",
    "冻结": "frozen",
    dibekukan: "frozen"
  };
  return map[value] || value || "empty";
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
