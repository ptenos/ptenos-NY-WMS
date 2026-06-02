window.__runtimeBooted = true;
const storeKey = "wms-lite-state-v4";
const authKey = "wms-lite-auth-v2";
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("wms-lite-sync") : null;
const serverRequired = location.protocol !== "file:";
const materialCache = new Map();
const locationCache = new Map();

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

function safeStorage(name) {
  try {
    const storage = window[name];
    const key = "__wms_storage_test__";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return storage;
  } catch {
    return createMemoryStorage();
  }
}

const wmsLocalStorage = safeStorage("localStorage");
const wmsSessionStorage = safeStorage("sessionStorage");

const state = loadState();
const frontendBuildVersion = "runtime-userflow-20260603";
let sessionAuth = loadSessionAuth();
if (!sessionAuth.token || sessionAuth.userId !== state.currentUserId) state.currentUserId = "";
let operationType = "in";
let apiAvailable = false;
let apiSyncAttempted = false;
let apiConnectionState = "connecting";
let remoteSaveTimer = null;
let currentStockRows = [];
let selectedOperationVersion = null;
let selectedCountVersion = null;
let editingMaterialSku = "";
let editingLocationCode = "";
let installPromptEvent = null;
let stockSortBy = "sku";
let stockSortDir = "asc";
let stockPage = { page: 1, pageSize: 50, pages: 1, total: 0 };
let logPage = { page: 1, pageSize: 50, pages: 1, total: 0 };
let materialPage = { page: 1, pageSize: 50, pages: 1, total: 0 };
let locationPage = { page: 1, pageSize: 50, pages: 1, total: 0 };
let stockRequestId = 0;
let logRequestId = 0;
let materialRequestId = 0;
let locationRequestId = 0;
let operationStockRequestId = 0;
let countStockRequestId = 0;
let operationStockTimer = null;
let countStockTimer = null;
let materialOptionTimer = null;
let locationOptionTimer = null;
let selectedOperationStock = null;
let selectedCountStock = null;
let pendingOperationPayload = null;
window.__loginJustCompleted = false;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => bindLoginButton());
} else {
  bindLoginButton();
}

function bindLoginButton() {
  const loginButton = document.getElementById("loginButton");
  if (!loginButton) {
    return;
  }
  if (loginButton.dataset.bound === "1") {
    return;
  }
  loginButton.dataset.bound = "1";
  loginButton.addEventListener("click", (event) => {
    event.preventDefault();
    login();
  });
}

function defaultState() {
  return {
    materials: [],
    locations: [],
    stock: [],
    logs: [],
    auditLogs: [],
    users: [
      { id: "admin", name: "管理员", role: "admin" },
      { id: "WH-001", name: "仓库员工", role: "employee" },
      { id: "WH-MGR", name: "仓管", role: "keeper" }
    ],
    currentUserId: ""
  };
}

function loadState() {
  const saved = wmsLocalStorage.getItem(storeKey);
  const loaded = saved ? { ...defaultState(), ...JSON.parse(saved) } : defaultState();
  return migrateState(loaded);
}

function loadSessionAuth() {
  try {
    return JSON.parse(wmsSessionStorage.getItem(authKey) || "{}");
  } catch {
    return {};
  }
}

function saveSessionAuth(userId, token, expiresAt = "", mustChangePassword = false) {
  sessionAuth = { userId, token, expiresAt, mustChangePassword: !!mustChangePassword };
  wmsSessionStorage.setItem(authKey, JSON.stringify(sessionAuth));
}

function clearSessionAuth() {
  sessionAuth = {};
  wmsSessionStorage.removeItem(authKey);
}

function migrateState(data) {
  const defaults = defaultState().users;
  data.users = Array.isArray(data.users) ? data.users : defaults;
  data.users.forEach((user) => {
    if (user.role === "operator") user.role = "employee";
    delete user.password;
    delete user.passwordHash;
  });
  defaults.forEach((user) => {
    if (!data.users.some((item) => item.id === user.id)) data.users.push(user);
  });
  data.materials = (Array.isArray(data.materials) ? data.materials : []).map((item) => ({
    sku: item.sku,
    name: item.name
  }));
  data.locations = Array.isArray(data.locations) ? data.locations : [];
  cacheMaterials(data.materials);
  cacheLocations(data.locations);
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.stock = (Array.isArray(data.stock) ? data.stock : []).map((row) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    ...row
  }));
  return data;
}

function ensureAdminAccount() {
  if (serverRequired) {
    showToast("正式服务不能在手机端重置管理员密码，请在账号权限里修改密码");
    return;
  }
  let admin = state.users.find((user) => String(user.id).toLowerCase() === "admin");
  if (!admin) {
    admin = { id: "admin", name: "管理员", role: "admin" };
    state.users.unshift(admin);
  }
  admin.id = "admin";
  admin.name = admin.name || "管理员";
  admin.role = "admin";
  delete admin.password;
  delete admin.passwordHash;
  saveState();
  render();
  showToast("管理员密码已重置为 admin123");
}

function currentUser() {
  if (!state.currentUserId) return null;
  const user = state.users.find((item) => item.id === state.currentUserId);
  if (!user) return null;
  if (user?.role === "operator") user.role = "employee";
  return user;
}

function currentAuthPayload() {
  const user = currentUser();
  if (!user) return { operatorId: "", sessionToken: "", operator: "" };
  const sessionToken = sessionAuth.userId === user.id ? sessionAuth.token : "";
  return {
    operatorId: user.id,
    sessionToken,
    operator: `${user.id} ${user.name}`
  };
}

function isAdmin() {
  return currentUser()?.role === "admin";
}

function isKeeper() {
  return ["keeper", "admin"].includes(currentUser()?.role);
}

function canOpenView(viewId) {
  if (isAdmin()) return true;
  if (currentUser()?.role === "keeper") return ["operate", "count", "stock"].includes(viewId);
  return ["operate", "stock"].includes(viewId);
}

function roleLabel(role) {
  return { employee: "员工", keeper: "仓管", admin: "管理员", operator: "员工" }[role] || role;
}

function saveState(sync = true) {
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  if (sync && channel) channel.postMessage({ type: "state-updated", state });
  setSyncStatus(syncStatusText());
}

function debugLogin(message) {
  return message;
}

async function initApiSync() {
  try {
    const healthResponse = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const healthData = await healthResponse.json().catch(() => null);
    if (!healthResponse.ok || !healthData?.ok) throw new Error("API unavailable");
    apiAvailable = true;
    apiSyncAttempted = true;
    apiConnectionState = "connected";
    try {
      const response = await fetch("/api/state?lite=1", { headers: { Accept: "application/json" } });
      if (response.ok) {
        const preservedUserId = state.currentUserId;
        const preservedAuth = { ...sessionAuth };
        Object.assign(state, migrateState({ ...defaultState(), ...(await response.json()) }));
        if (preservedUserId) {
          state.currentUserId = preservedUserId;
        } else if (preservedAuth.token && preservedAuth.userId) {
          state.currentUserId = preservedAuth.userId;
        } else {
          state.currentUserId = "";
        }
        wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
      }
    } catch {
      // Keep the connection status online even if state sync is temporarily unavailable.
    }
    setSyncStatus(syncStatusText());
    render();
  } catch {
    apiAvailable = false;
    apiSyncAttempted = true;
    apiConnectionState = "failed";
    setSyncStatus(syncStatusText());
    renderRuntimeState();
  }
}

function scheduleRemoteSave() {
  if (!apiAvailable) return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(pushRemoteState, 250);
}

async function pushRemoteState() {
  if (!apiAvailable) return;
  try {
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
    if (!response.ok) throw new Error("Remote save failed");
    setSyncStatus("服务器同步");
  } catch {
    apiAvailable = false;
    setSyncStatus("本机演示");
  }
}

function setSyncStatus(text) {
  $("#syncStatus").textContent = text;
  renderRuntimeState();
}

function syncStatusText() {
  if (apiConnectionState === "connecting" && !apiSyncAttempted) return "连接中";
  if (apiAvailable || apiConnectionState === "connected") return "服务器已连接";
  if (apiConnectionState === "failed") return serverRequired ? "服务器连接失败" : "本机演示";
  return serverRequired ? "服务器未连接" : "本机演示";
}

function requireLiveServer(action = "操作") {
  if (!serverRequired || apiAvailable) return true;
  showToast(`服务器未连接，${action}暂不能执行`);
  return false;
}

function renderRuntimeState() {
  const blocked = serverRequired && !apiAvailable;
  $("#connectionBanner")?.classList.toggle("hidden", !blocked || !currentUser());
  $$(".server-write").forEach((button) => {
    button.disabled = blocked || button.dataset.logicDisabled === "1";
  });
  $("#seedDemo")?.classList.toggle("hidden", serverRequired || !isAdmin());
  $("#resetAdminButton")?.classList.toggle("hidden", serverRequired);
  updateInstallButton();
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase();
}

function fuzzyMatchText(text, keyword) {
  const normalized = normalizeSearch(text);
  const compact = normalized.replace(/\s+/g, "");
  const tokens = normalizeSearch(keyword).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
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

function formatMinute(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseSystemQty(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return null;
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(text)) return null;
  return Number(text);
}

function qtyErrorText(value) {
  const text = String(value ?? "").trim();
  if (text.includes(",")) return "数量不能使用逗号，请不要输入印尼小数格式，例如 1.000,5";
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return "数量不能使用印尼千分位格式，例如 1.000";
  return "数量只能输入普通数字，最多 6 位小数，例如 1000 或 1000.123456";
}

function roundQty(value) {
  return Number(Number(value).toFixed(6));
}

function findMaterial(value) {
  const key = normalize(value);
  return state.materials.find((item) => item.sku === key) ||
    materialCache.get(key) ||
    state.materials.find((item) => normalize(item.name) === key) ||
    [...materialCache.values()].find((item) => normalize(item.name) === key);
}

function getMaterialMatches(keyword, limit = 8) {
  const text = String(keyword || "").trim();
  if (!text) return [];
  const exact = findMaterial(text);
  const candidates = [...new Map([...state.materials, ...materialCache.values()].map((item) => [item.sku, item])).values()];
  const rows = candidates
    .filter((item) => fuzzyMatchText(`${item.sku} ${item.name}`, text))
    .sort((a, b) => {
      const key = normalize(text);
      const aExact = a.sku === key || normalize(a.name) === key ? 0 : 1;
      const bExact = b.sku === key || normalize(b.name) === key ? 0 : 1;
      return aExact - bExact || a.sku.localeCompare(b.sku);
    });
  if (exact && !rows.some((item) => item.sku === exact.sku)) rows.unshift(exact);
  return rows.slice(0, limit);
}

function findLocation(code) {
  const key = normalize(code);
  return state.locations.find((item) => item.code === key) || locationCache.get(key);
}

function cacheMaterials(rows = []) {
  rows.forEach((item) => {
    if (item?.sku) materialCache.set(normalize(item.sku), { sku: normalize(item.sku), name: item.name || "" });
  });
}

function cacheLocations(rows = []) {
  rows.forEach((item) => {
    if (item?.code) locationCache.set(normalize(item.code), { code: normalize(item.code), status: item.status || "" });
  });
}

function findStock(sku, batch, location, status) {
  return state.stock.find(
    (item) => item.sku === sku && item.batch === batch && item.location === location && item.status === status
  );
}

function upsertStock({ sku, batch, location, status, qty }) {
  const row = findStock(sku, batch, location, status);
  if (row) {
    row.qty = roundQty(row.qty + qty);
    touchStock(row);
  } else {
    state.stock.push({ id: uid(), sku, batch, location, status, qty, version: 1, updatedAt: new Date().toISOString() });
  }
  removeZeroStock();
}

function touchStock(row) {
  row.version = Number(row.version || 0) + 1;
  row.updatedAt = new Date().toISOString();
}

async function postOperation(payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("服务器未连接，请恢复网络后重试");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch("/api/operations", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postMasterData(path, payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("服务器未连接，请恢复网络后重试");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存失败");
  const currentUserId = state.currentUserId;
  if (data.materials || data.locations || data.stock) {
    Object.assign(state, migrateState({ ...defaultState(), ...data }));
    state.currentUserId = currentUserId;
  } else if (path.endsWith("/materials")) {
    state.materials = data;
  } else if (path.endsWith("/locations")) {
    state.locations = data;
  }
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postUserData(path, payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("服务器未连接，请恢复网络后重试");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "账号保存失败");
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

function authHeaders(auth = currentAuthPayload()) {
  const headers = { "Content-Type": "application/json", "X-WMS-Lite-Lite": "1" };
  if (auth.sessionToken) headers.Authorization = `Bearer ${auth.sessionToken}`;
  return headers;
}

async function fetchApiPage(path, params = {}) {
  const url = new URL(path, location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(`${url.pathname}${url.search}`, { headers: { Accept: "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "数据加载失败");
  return data;
}

function removeZeroStock() {
  state.stock = state.stock.filter((item) => item.qty > 0);
}

function refreshLocationUsage() {
  state.locations.forEach((location) => {
    if (location.status !== "冻结") {
      location.status = state.stock.some((item) => item.location === location.code) ? "占用" : "空闲";
    }
  });
}

function addLog(payload) {
  const user = currentUser();
  state.logs.unshift({
    id: uid(),
    operatorId: user?.id || "",
    operatorName: user?.name || "",
    operator: user ? `${user.id} ${user.name}` : "未选择",
    time: formatMinute(),
    ...payload
  });
}

function addAuditLog(payload) {
  const user = currentUser();
  state.auditLogs.unshift({
    id: uid(),
    time: formatMinute(),
    operatorId: user?.id || "",
    operatorName: user?.name || "",
    ...payload
  });
}

async function submitOperation(event, overridePayload = null) {
  event.preventDefault();
  if (event.target.dataset.submitting === "1") return;
  const inputSku = normalize($("#skuInput").value);
  const material = findMaterial($("#skuInput").value) ||
    (selectedOperationSourceMatches(inputSku, normalize($("#batchInput").value), $("#statusInput").value)
      ? { sku: selectedOperationStock.sku, name: selectedOperationStock.name }
      : null);
  const sku = material?.sku || "";
  const batch = normalize($("#batchInput").value);
  const rawQty = $("#qtyInput").value;
  const qty = parseSystemQty(rawQty);
  const location = normalize($("#locationInput").value);
  const targetLocation = normalize($("#targetLocationInput").value);
  const status = $("#statusInput").value;
  const note = $("#noteInput").value.trim();

  if (!material) return showToast("物料必须从主数据搜索选择");
  if (!findLocation(location)) return showToast("库位必须从主数据搜索选择");
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (qty <= 0) return showToast(operationType === "in" ? "入库数量必须大于 0" : "本次数量必须大于 0");
  const selectedRow = selectedOperationSourceMatches(sku, batch, status) ? selectedOperationStock : null;
  if (["out", "move"].includes(operationType)) {
    if (!selectedRow) return showToast("请先选择要操作的库存明细");
    if (qty > Number(selectedRow.qty || 0)) return showToast("本次数量不能超过现有库存");
  }
  if (operationType === "move") {
    if (!targetLocation || !findLocation(targetLocation)) return showToast("请选择有效目标库位");
    if (findLocation(targetLocation)?.status === "冻结") return showToast("目标库位已冻结");
    if (targetLocation === (selectedRow?.location || location)) return showToast("目标库位不能和原库位相同");
  }

  const sourceLocation = selectedRow?.location || location;
  const operationPayload = overridePayload || { type: operationType, sku, batch, qty: rawQty, location: sourceLocation, targetLocation, status, note, expectedVersion: selectedOperationVersion };

  if (!overridePayload) {
    openOperationConfirm({
      ...operationPayload,
      name: material?.name || selectedOperationStock?.name || ""
    });
    return;
  }

  setFormSubmitting(event.target, true);
  try {
    try {
      const remote = await postOperation(operationPayload);
      if (remote) {
        resetOperationForm(event.target);
        selectedOperationVersion = null;
        selectedOperationStock = null;
        render();
        return showToast("作业已提交");
      }
    } catch (error) {
      return showToast(error.message);
    }

    if (operationType === "in") {
      if (qty <= 0) return showToast("入库数量必须大于 0");
      upsertStock({ sku, batch, location, status, qty });
    }

    if (operationType === "out") {
      if (qty <= 0) return showToast("出库数量必须大于 0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("库存不足或状态不匹配");
      row.qty = roundQty(row.qty - qty);
      touchStock(row);
    }

    if (operationType === "move") {
      if (qty <= 0) return showToast("移库数量必须大于 0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("原库位库存不足");
      row.qty = roundQty(row.qty - qty);
      touchStock(row);
      upsertStock({ sku, batch, location: targetLocation, status, qty });
    }

    removeZeroStock();
    refreshLocationUsage();
    addLog({ type: operationType, sku, batch, qty, location: selectedRow?.location || location, targetLocation, status, note });
    saveState();
    resetOperationForm(event.target);
    selectedOperationVersion = null;
    selectedOperationStock = null;
    render();
    showToast("作业已提交");
  } finally {
    setFormSubmitting(event.target, false);
  }
}

function getOperationStockRows() {
  if (!["out", "move"].includes(operationType)) return [];
  const material = findMaterial($("#skuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#batchInput").value);
  const location = normalize($("#locationInput").value);
  const status = $("#statusInput").value;
  const keyword = $("#operationStockSearch").value.trim().toLowerCase();
  return state.stock.filter((item) => {
    const itemMaterial = findMaterial(item.sku);
    const haystack = `${item.sku} ${itemMaterial?.name || ""} ${item.batch} ${item.location} ${item.status}`.toLowerCase();
    if (!fuzzyMatchText(haystack, keyword)) return false;
    if (sku && item.sku !== sku) return false;
    if (batch && item.batch !== batch) return false;
    if (location && item.location !== location) return false;
    if (status && item.status !== status) return false;
    return true;
  });
}

function updateOperationStockList() {
  const useStockPicker = ["out", "move"].includes(operationType);
  $("#operationStockWrap").classList.toggle("hidden", !useStockPicker);
  $$(".operation-field").forEach((item) => item.classList.toggle("hidden", useStockPicker));
  $("#targetLocationWrap").classList.toggle("hidden", operationType !== "move");
  $("#operationStockHint").textContent = operationType === "move" ? "搜索并选择要移库的库存。" : "搜索并选择要出库的库存。";
  updateOperationHelper();
  if (!useStockPicker) return;
  syncOperationSelection();
  renderSelectedStockInfo();
  if (apiAvailable) {
    scheduleOperationStockLoad();
    return;
  }
  const rows = getOperationStockRows();
  renderOperationStockRows(rows);
}

function scheduleOperationStockLoad() {
  clearTimeout(operationStockTimer);
  operationStockTimer = setTimeout(loadOperationStockRows, 180);
}

async function loadOperationStockRows() {
  if (!["out", "move"].includes(operationType)) return;
  const requestId = ++operationStockRequestId;
  $("#operationStockList").innerHTML = `<div class="empty-state">库存加载中...</div>`;
  try {
    const material = findMaterial($("#skuInput").value);
    const data = await fetchApiPage("/api/stock", {
      query: $("#operationStockSearch").value.trim(),
      sku: material?.sku || "",
      batch: normalize($("#batchInput").value),
      location: normalize($("#locationInput").value),
      status: $("#statusInput").value,
      sort: "sku",
      dir: "asc",
      page: 1,
      pageSize: 20
    });
    if (requestId !== operationStockRequestId) return;
    renderOperationStockRows(data.rows || []);
  } catch (error) {
    $("#operationStockList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderOperationStockRows(rows) {
  cacheMaterials(rows.filter((item) => item.sku && item.name).map((item) => ({ sku: item.sku, name: item.name })));
  $("#operationStockList").innerHTML = rows.length
    ? rows.map((item) => {
        const material = findMaterial(item.sku);
        const selected = selectedOperationStock &&
          selectedOperationStock.sku === item.sku &&
          selectedOperationStock.batch === item.batch &&
          selectedOperationStock.location === item.location &&
          selectedOperationStock.status === item.status;
        return `
          <button class="data-card compact-stock ${selected ? "selected" : ""}" type="button" data-op-stock="1" aria-pressed="${selected ? "true" : "false"}" data-sku="${escapeHtml(item.sku)}" data-name="${escapeHtml(item.name || material?.name || "")}" data-batch="${escapeHtml(item.batch)}" data-location="${escapeHtml(item.location)}" data-status="${escapeHtml(item.status)}" data-qty="${item.qty}" data-version="${item.version || 1}">
            <div>
              <strong>${escapeHtml(item.location)}</strong>
              <span>${escapeHtml(item.sku)} / ${escapeHtml(item.name || material?.name || "")} / ${escapeHtml(item.batch)} / ${escapeHtml(item.status)}</span>
            </div>
            <div class="card-meta">
              <b>${item.qty}</b>
            </div>
          </button>`;
      }).join("")
    : `<div class="empty-state">${escapeHtml(operationEmptyText())}</div>`;
}

function updateMaterialPicker() {
  const wrap = $("#materialPickerWrap");
  const list = $("#materialPickerList");
  if (!wrap || !list) return;
  const usePicker = operationType === "in";
  const keyword = $("#skuInput").value.trim();
  const exact = findMaterial(keyword);
  const rows = usePicker && !exact ? getMaterialMatches(keyword) : [];
  wrap.classList.toggle("hidden", !usePicker || !keyword || !rows.length);
  list.innerHTML = rows.map((item) => `
    <button class="mini-list-item" type="button" data-pick-material="${escapeHtml(item.sku)}">
      <strong>${escapeHtml(item.sku)}</strong>
      <span>${escapeHtml(item.name)}</span>
    </button>
  `).join("");
}

function selectMaterialFromPicker(event) {
  const button = event.target.closest("[data-pick-material]");
  if (!button) return;
  const material = findMaterial(button.dataset.pickMaterial);
  if (!material) return;
  $("#skuInput").value = material.sku;
  $("#materialNameInput").value = material.name;
  updateMaterialPicker();
  updateOperationStockList();
  $("#batchInput").focus();
}

function selectOperationStock(event) {
  const card = event.target.closest("[data-op-stock]");
  if (!card) return;
  $("#skuInput").value = card.dataset.sku;
  $("#materialNameInput").value = findMaterial(card.dataset.sku)?.name || card.dataset.name || "";
  $("#batchInput").value = card.dataset.batch;
  $("#locationInput").value = card.dataset.location;
  $("#statusInput").value = card.dataset.status;
  $("#qtyInput").value = "";
  $("#qtyInput").dataset.maxQty = card.dataset.qty;
  $("#qtyInput").placeholder = `最多 ${card.dataset.qty}`;
  $("#operationStockSearch").value = `${card.dataset.sku} ${card.dataset.batch} ${card.dataset.location}`;
  selectedOperationVersion = Number(card.dataset.version || 1);
  selectedOperationStock = stockFromDataset(card.dataset);
  renderSelectedStockInfo();
  updateOperationStockList();
  $("#qtyInput").focus();
}

function renderSelectedStockInfo() {
  const material = findMaterial($("#skuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#batchInput").value);
  const location = normalize($("#locationInput").value);
  const status = $("#statusInput").value;
  const row = selectedOperationMatches(sku, batch, location, status) ? selectedOperationStock : findStock(sku, batch, location, status);
  $("#selectedStockInfo").classList.toggle("hidden", !row);
  $("#selectedStockInfo").innerHTML = row
    ? `<strong>已选择库存明细</strong>
      <span>物料：${escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>批号：${escapeHtml(batch)} / 库位：${escapeHtml(location)} / 状态：${escapeHtml(status)}</span>
      <span>现有库存：${row.qty}，请在下方输入本次数量。</span>`
    : "";
  updateOperationHelper();
}

function operationEmptyText() {
  const keyword = $("#operationStockSearch")?.value.trim();
  if (!keyword) return "请先扫码或输入物料编码、批号、库位，查询可操作库存。";
  return "未找到可操作库存，请确认物料编码、批号或库位是否正确。";
}

function updateOperationHelper() {
  const guide = $("#operationGuide");
  const qtyHint = $("#qtyHint");
  const qtyInput = $("#qtyInput");
  const submitButton = $("#operationSubmitButton");
  if (!guide || !qtyHint || !qtyInput || !submitButton) return;

  const labels = { in: "入库", out: "出库", move: "移库" };
  const steps = {
    in: ["选择物料", "选择库位", "输入数量", "确认提交"],
    out: ["选择库存明细", "输入数量", "确认提交"],
    move: ["选择库存明细", "输入数量", "选择目标库位", "确认提交"]
  }[operationType] || ["填写信息", "确认提交"];

  const inputSku = normalize($("#skuInput").value);
  const batch = normalize($("#batchInput").value);
  const location = normalize($("#locationInput").value);
  const status = $("#statusInput").value;
  const qty = parseSystemQty(qtyInput.value);
  const targetLocation = normalize($("#targetLocationInput").value);
  const selectedRow = selectedOperationSourceMatches(inputSku, batch, status) ? selectedOperationStock : null;

  let activeStep = 0;
  let ready = false;
  let nextText = "";
  if (operationType === "in") {
    if (findMaterial($("#skuInput").value)) activeStep = 1;
    if (findLocation(location)) activeStep = 2;
    if (qty !== null && qty > 0) activeStep = 3;
    delete qtyInput.dataset.maxQty;
    qtyInput.placeholder = "如 1000 或 1000.123456";
    ready = !!findMaterial($("#skuInput").value) && !!findLocation(location) && !!batch && qty !== null && qty > 0;
    nextText = ready ? "可先确认，再提交入库。" : "请先选择物料、库位，再输入数量。";
  } else {
    if (selectedRow) activeStep = 1;
    if (qty !== null && qty > 0 && selectedRow && qty <= Number(selectedRow.qty || 0)) activeStep = 2;
    if (operationType === "move" && findLocation(targetLocation) && targetLocation !== location) activeStep = 3;
    if (selectedRow) {
      qtyInput.dataset.maxQty = selectedRow.qty;
      qtyInput.placeholder = `最多 ${selectedRow.qty}`;
      if (selectedRow.location !== location) {
        nextText = `已选中 ${selectedRow.location} 的库存明细，请继续输入数量。`;
      } else if (qty !== null && qty > Number(selectedRow.qty || 0)) {
        nextText = "数量超过现有库存，请改小。";
      } else if (operationType === "move" && targetLocation && targetLocation === location) {
        nextText = "目标库位不能和原库位相同。";
      } else {
        nextText = `现有库存 ${selectedRow.qty}，请继续输入数量。`;
      }
    } else {
      delete qtyInput.dataset.maxQty;
      qtyInput.placeholder = "先选择库存明细";
      nextText = operationType === "move" ? "请先选择要移库的库存明细。" : "请先选择要出库的库存明细。";
    }
    ready = !!selectedRow && qty !== null && qty > 0 && qty <= Number(selectedRow.qty || 0);
    if (operationType === "move") {
      const target = findLocation(targetLocation);
      ready = ready && !!target && targetLocation !== location && target.status !== "冻结";
      if (target?.status === "冻结") nextText = "目标库位已冻结，请换一个库位。";
    }
  }

  guide.innerHTML = steps.map((step, index) => `<span class="step-pill ${index <= activeStep ? "active" : ""}">${index + 1}. ${escapeHtml(step)}</span>`).join("");
  qtyHint.textContent = nextText;
  submitButton.textContent = `${labels[operationType] || "作业"}提交`;
  submitButton.dataset.logicDisabled = ready ? "" : "1";
  submitButton.disabled = (serverRequired && !apiAvailable) || !ready || submitButton.dataset.busy === "1";
}

function stockFromDataset(dataset) {
  return {
    sku: dataset.sku || "",
    name: dataset.name || "",
    batch: dataset.batch || "",
    location: dataset.location || "",
    status: dataset.status || "",
    qty: Number(dataset.qty || 0),
    version: Number(dataset.version || 1)
  };
}

function selectedOperationMatches(sku, batch, location, status) {
  return selectedOperationStock &&
    selectedOperationStock.sku === sku &&
    selectedOperationStock.batch === batch &&
    selectedOperationStock.location === location &&
    selectedOperationStock.status === status;
}

function selectedOperationSourceMatches(sku, batch, status) {
  return selectedOperationStock &&
    selectedOperationStock.sku === sku &&
    selectedOperationStock.batch === batch &&
    selectedOperationStock.status === status;
}

function syncOperationSelection() {
  const material = findMaterial($("#skuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#batchInput").value);
  const location = normalize($("#locationInput").value);
  const status = $("#statusInput").value;
  const matches = operationType === "in"
    ? selectedOperationMatches(sku, batch, location, status)
    : selectedOperationSourceMatches(sku, batch, status);
  if (!matches) {
    selectedOperationStock = null;
    selectedOperationVersion = null;
  }
}

async function submitCount(event) {
  event.preventDefault();
  if (event.target.dataset.submitting === "1") return;
  const inputSku = normalize($("#countSkuInput").value);
  const selected = selectedCountStock && selectedCountStock.sku === inputSku ? selectedCountStock : null;
  const material = selected ? { sku: selected.sku, name: selected.name } : findMaterial($("#countSkuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#countBatchInput").value);
  const status = $("#countStatusInput").value;
  const rawQty = $("#countQtyInput").value;
  const qty = parseSystemQty(rawQty);
  const location = normalize($("#countLocationInput").value);
  const note = $("#countNoteInput").value.trim();

  if (!material) return showToast("物料必须从主数据搜索选择");
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (!status) return showToast("请选择盘点状态");
  if (!findLocation(location)) return showToast("盘点库位必须从主数据搜索选择");
  if (!selectedCountStock || selectedCountStock.sku !== sku || selectedCountStock.batch !== batch || selectedCountStock.status !== status) {
    return showToast("请先选择要盘点的库存明细");
  }
  const targetLocation = findLocation(location);
  if (selectedCountStock.location !== location && targetLocation?.status === "冻结") return showToast("盘点库位已冻结，请换一个库位");

  setFormSubmitting(event.target, true);
  try {
    const operationPayload = {
      type: "count",
      sku: selectedCountStock.sku,
      batch: selectedCountStock.batch,
      status: selectedCountStock.status,
      qty: rawQty,
      location,
      note,
      expectedVersion: selectedCountVersion,
      sourceSku: selectedCountStock.sku,
      sourceBatch: selectedCountStock.batch,
      sourceLocation: selectedCountStock.location,
      sourceStatus: selectedCountStock.status
    };
    const remote = await postOperation(operationPayload);
    if (remote) {
      selectedCountVersion = null;
      selectedCountStock = null;
      event.target.reset();
      $("#countMaterialNameInput").value = "";
      $("#selectedCountInfo").classList.add("hidden");
      $("#selectedCountInfo").innerHTML = "";
      render();
      return showToast("盘点已调整");
    }

    const row = findStock(sku, batch, location, status);
    const beforeQty = row ? row.qty : 0;
    if (row) {
      row.qty = qty;
      touchStock(row);
    } else if (qty > 0) {
      upsertStock({ sku, batch, location, status, qty });
    }

    addLog({ type: "adjust", sku, batch, qty, beforeQty, location, targetLocation: "", status, note });
    removeZeroStock();
    refreshLocationUsage();
    saveState();
    event.target.reset();
    selectedCountVersion = null;
    selectedCountStock = null;
    $("#countMaterialNameInput").value = "";
    $("#selectedCountInfo").classList.add("hidden");
    $("#selectedCountInfo").innerHTML = "";
    render();
    updateCountPreview();
    showToast("盘点已调整");
  } catch (error) {
    return showToast(error.message);
  } finally {
    setFormSubmitting(event.target, false);
  }
}

function updateCountPreview() {
  const material = findMaterial($("#countSkuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#countBatchInput").value);
  const status = $("#countStatusInput").value;
  const keyword = ($("#countStockSearch")?.value || "").trim().toLowerCase();
  $("#countMaterialNameInput").value = material?.name || "";
  syncCountSelection();
  updateCountHelper();

  if (apiAvailable) {
    scheduleCountStockLoad();
    return;
  }

  const rows = state.stock.filter((item) => {
    const itemMaterial = findMaterial(item.sku);
    const haystack = `${item.sku} ${itemMaterial?.name || ""} ${item.batch} ${item.location} ${item.status}`.toLowerCase();
    if (!fuzzyMatchText(haystack, keyword)) return false;
    if (sku && item.sku !== sku) return false;
    if (batch && item.batch !== batch) return false;
    if (status && item.status !== status) return false;
    return true;
  });
  const total = rows.reduce((sum, item) => sum + item.qty, 0);
  const locations = [...new Set(rows.map((item) => item.location))].join(" / ");
  $("#currentCountQty").textContent = rows.length ? roundQty(total) : "-";
  $("#currentCountLocation").textContent = rows.length ? locations : "-";
  renderCountStockList(rows);
  renderSelectedCountInfo();
}

function countEmptyText() {
  const keyword = $("#countStockSearch")?.value.trim();
  if (!keyword) return "请先扫码或输入物料编码、批号、库位，查询盘点库存。";
  return "未找到可盘点库存，请确认物料编码、批号或库位是否正确。";
}

function scheduleCountStockLoad() {
  clearTimeout(countStockTimer);
  countStockTimer = setTimeout(loadCountStockRows, 180);
}

async function loadCountStockRows() {
  const requestId = ++countStockRequestId;
  $("#countStockList").innerHTML = `<div class="empty-state">库存加载中...</div>`;
  try {
    const material = findMaterial($("#countSkuInput").value);
    const data = await fetchApiPage("/api/stock", {
      query: $("#countStockSearch").value.trim(),
      sku: material?.sku || "",
      batch: normalize($("#countBatchInput").value),
      status: $("#countStatusInput").value,
      sort: "sku",
      dir: "asc",
      page: 1,
      pageSize: 20
    });
    if (requestId !== countStockRequestId) return;
    $("#currentCountQty").textContent = data.total ? data.totalQty : "-";
    $("#currentCountLocation").textContent = data.total ? formatLocations(data.locations || [], data.locationCount || 0) : "-";
    renderCountStockList(data.rows || []);
    renderSelectedCountInfo();
  } catch (error) {
    $("#countStockList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function formatLocations(locations, total) {
  const text = locations.join(" / ");
  if (!total || total <= locations.length) return text;
  return `${text} 等 ${total} 个库位`;
}

function renderCountStockList(rows = []) {
  cacheMaterials(rows.filter((item) => item.sku && item.name).map((item) => ({ sku: item.sku, name: item.name })));
  $("#countStockList").innerHTML = rows.length
    ? rows.map((item) => {
        const material = findMaterial(item.sku);
        const selected = selectedCountStock &&
          selectedCountStock.sku === item.sku &&
          selectedCountStock.batch === item.batch &&
          selectedCountStock.location === item.location &&
          selectedCountStock.status === item.status;
        return `
        <button class="data-card compact-stock ${selected ? "selected" : ""}" type="button" aria-pressed="${selected ? "true" : "false"}" data-sku="${escapeHtml(item.sku)}" data-name="${escapeHtml(item.name || material?.name || "")}" data-batch="${escapeHtml(item.batch)}" data-location="${escapeHtml(item.location)}" data-status="${escapeHtml(item.status)}" data-qty="${item.qty}" data-version="${item.version || 1}">
          <div>
            <strong>${escapeHtml(item.location)}</strong>
            <span>${escapeHtml(item.sku)} / ${escapeHtml(item.name || material?.name || "")}</span>
            <small>${escapeHtml(item.batch)} / ${escapeHtml(item.status)}</small>
          </div>
          <div class="card-meta">
            <b>${item.qty}</b>
          </div>
        </button>`;
      }).join("")
    : `<div class="empty-state">${escapeHtml(countEmptyText())}</div>`;
}

function selectCountStock(event) {
  const card = event.target.closest("[data-sku]");
  if (!card) return;
  $("#countSkuInput").value = card.dataset.sku;
  $("#countMaterialNameInput").value = findMaterial(card.dataset.sku)?.name || card.dataset.name || "";
  $("#countBatchInput").value = card.dataset.batch;
  $("#countStatusInput").value = card.dataset.status;
  $("#countLocationInput").value = card.dataset.location;
  $("#countQtyInput").value = card.dataset.qty;
  $("#countStockSearch").value = `${card.dataset.sku} ${card.dataset.batch} ${card.dataset.location}`;
  selectedCountVersion = Number(card.dataset.version || 1);
  selectedCountStock = stockFromDataset(card.dataset);
  updateCountPreview();
}

function renderSelectedCountInfo() {
  const material = findMaterial($("#countSkuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#countBatchInput").value);
  const location = normalize($("#countLocationInput").value);
  const status = $("#countStatusInput").value;
  const row = selectedCountSourceMatches(sku, batch, status) ? selectedCountStock : findStock(sku, batch, location, status);
  const selected = $("#selectedCountInfo");
  selected.classList.toggle("hidden", !row);
  selected.innerHTML = row
    ? `<strong>已选择盘点明细</strong>
      <span>物料：${escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>批号：${escapeHtml(batch)} / 原库位：${escapeHtml(row.location)} / 状态：${escapeHtml(status)}</span>
      <span>账面数量：${row.qty}，下方填写实际数量和实际库位。</span>`
    : "";
  updateCountHelper();
}

function selectedCountMatches(sku, batch, location, status) {
  return selectedCountStock &&
    selectedCountStock.sku === sku &&
    selectedCountStock.batch === batch &&
    selectedCountStock.location === location &&
    selectedCountStock.status === status;
}

function selectedCountSourceMatches(sku, batch, status) {
  return selectedCountStock &&
    selectedCountStock.sku === sku &&
    selectedCountStock.batch === batch &&
    selectedCountStock.status === status;
}

function updateCountHelper() {
  const hint = $("#countQtyHint");
  const submitButton = $("#countSubmitButton");
  if (!hint || !submitButton) return;
  const inputSku = normalize($("#countSkuInput").value);
  const batch = normalize($("#countBatchInput").value);
  const status = $("#countStatusInput").value;
  const location = normalize($("#countLocationInput").value);
  const qty = parseSystemQty($("#countQtyInput").value);
  const selected = selectedCountStock &&
    selectedCountStock.sku === inputSku &&
    selectedCountStock.batch === batch &&
    selectedCountStock.status === status
    ? selectedCountStock
    : null;
  const target = findLocation(location);
  let ready = !!selected && qty !== null && !!target;
  let text = "";
  if (!selected) text = "先选择要盘点的库存明细。";
  else if (qty === null) text = "输入实际数量，允许 0，最多 6 位小数。";
  else if (!target) text = "盘点库位必须从主数据选择。";
  else if (selected.location !== location && target.status === "冻结") {
    ready = false;
    text = "盘点库位已冻结，请换一个库位。";
  } else {
    const locationText = selected.location === location ? "库位不变" : `库位将从 ${selected.location} 调整到 ${location}`;
    text = `账面 ${selected.qty}，实际 ${qty}，${locationText}。`;
  }
  hint.textContent = text;
  submitButton.dataset.logicDisabled = ready ? "" : "1";
  submitButton.disabled = (serverRequired && !apiAvailable) || !ready || submitButton.dataset.busy === "1";
}

function syncCountSelection() {
  const material = findMaterial($("#countSkuInput").value);
  const sku = material?.sku || "";
  const batch = normalize($("#countBatchInput").value);
  const status = $("#countStatusInput").value;
  if (!selectedCountSourceMatches(sku, batch, status)) {
    selectedCountStock = null;
    selectedCountVersion = null;
  }
}

function resetOperationForm(form) {
  form.reset();
  $("#statusInput").value = "可用";
  $("#materialNameInput").value = "";
  delete $("#qtyInput").dataset.maxQty;
  updateMaterialPicker();
  updateOperationHelper();
}

function seedDemo() {
  if (serverRequired) return showToast("正式服务不允许载入演示数据");
  if (!isAdmin()) return showToast("只有管理员可以载入演示");
  state.materials = [
    { sku: "RM-1001", name: "甘油" },
    { sku: "PK-2030", name: "外箱" },
    { sku: "FG-8801", name: "防晒霜成品" }
  ];
  state.locations = [
    { code: "A-01-01", status: "占用" },
    { code: "A-01-02", status: "空闲" },
    { code: "B-02-01", status: "占用" },
    { code: "QC-HOLD", status: "冻结" }
  ];
  state.stock = [
    { id: uid(), sku: "RM-1001", batch: "B20260501", location: "A-01-01", status: "可用", qty: 120, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "PK-2030", batch: "P260528", location: "B-02-01", status: "可用", qty: 560, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "FG-8801", batch: "F260527", location: "QC-HOLD", status: "待检", qty: 48, version: 1, updatedAt: new Date().toISOString() }
  ];
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: 3, location: "", targetLocation: "", status: "", note: "演示数据初始化" });
  addAuditLog({ action: "载入演示数据", entity: "系统数据", key: "DEMO", before: null, after: { materials: state.materials.length, locations: state.locations.length, stock: state.stock.length }, note: "演示数据初始化" });
  refreshLocationUsage();
  saveState();
  render();
  showToast("演示数据已载入");
}

function renderPermissions() {
  const loggedIn = !!currentUser();
  const admin = isAdmin();
  const keeper = isKeeper();
  const passwordWarning = admin && sessionAuth.userId === currentUser()?.id && sessionAuth.mustChangePassword;
  const lockdown = passwordWarning;
  $("#loginPanel").classList.toggle("hidden", loggedIn);
  $("#logoutButton").classList.toggle("hidden", !loggedIn);
  $(".tabbar").classList.toggle("hidden", !loggedIn);
  $("#passwordWarning")?.classList.toggle("hidden", !passwordWarning);
  $$(".view").forEach((item) => item.classList.toggle("hidden", !loggedIn));
  $("#accountBadge").textContent = loggedIn ? `${currentUser().id} / ${roleLabel(currentUser().role)}` : "未登录";
  if (!loggedIn) return;
  if (lockdown) {
    $$(".tab").forEach((item) => item.classList.toggle("hidden", item.dataset.view !== "users"));
    $$(".view").forEach((item) => item.classList.toggle("hidden", item.id !== "users"));
    activateView("users");
    $("#mobileHome").classList.toggle("hidden", true);
    return;
  }
  $$(".admin-only, .admin-view").forEach((item) => item.classList.toggle("hidden", !admin));
  $$(".keeper-only").forEach((item) => item.classList.toggle("hidden", !keeper));
  $$(".admin-option").forEach((item) => item.hidden = !admin);
  const activeView = $(".view.active");
  if (activeView && !canOpenView(activeView.id)) activateView("operate");
  $("#mobileHome").classList.toggle("hidden", !loggedIn);
}

function renderUserSelect() {
  // Login uses typed account/password. This render hook is kept for the wider render flow.
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function homeActionToView(action) {
  const map = { in: "operate", out: "operate", move: "operate", stock: "stock", count: "count" };
  return map[action] || "operate";
}

function selectHomeAction(action) {
  const view = homeActionToView(action);
  activateView(view);
  if (view === "operate") {
    operationType = action;
    $("#operationTypeInput").value = action;
    updateOperationStockList();
    updateOperationHelper();
  }
  if (view === "stock") {
    renderStock();
  }
  if (view === "count") {
    updateCountPreview();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openOperationConfirm(payload) {
  pendingOperationPayload = payload;
  const rows = [
    ["操作类型", typeLabel(payload.type)],
    ["物料编码", payload.sku],
    ["物料名称", payload.name || findMaterial(payload.sku)?.name || ""],
    ["批号", payload.batch],
    ["原库位", payload.location],
    ["目标库位", payload.targetLocation || "-"],
    ["状态", payload.status],
    ["数量", payload.qty]
  ];
  $("#operationConfirmText").textContent = `请确认本次${typeLabel(payload.type)}信息。`;
  $("#operationConfirmGrid").innerHTML = rows.map(([label, value]) => `<div class="confirm-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`).join("");
  $("#operationConfirmSheet").classList.remove("hidden");
}

function closeOperationConfirm() {
  pendingOperationPayload = null;
  $("#operationConfirmSheet").classList.add("hidden");
}

async function commitPendingOperation() {
  if (!pendingOperationPayload) return;
  const event = { target: $("#operationForm") };
  const payload = pendingOperationPayload;
  closeOperationConfirm();
  await submitOperation(event, payload);
}

function renderOptions() {
  renderMaterialOptions([...materialCache.values()].slice(0, 20));
  renderLocationOptions([...locationCache.values()].slice(0, 20));
}

function renderMaterialOptions(rows) {
  $("#materialOptions").innerHTML = rows
    .map((item) => `<option value="${escapeHtml(item.sku)}">${escapeHtml(item.name)}</option>`)
    .join("");
}

function renderLocationOptions(rows) {
  $("#locationOptions").innerHTML = rows
    .map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.status || "")}</option>`)
    .join("");
  $("#targetLocationOptions").innerHTML = rows
    .filter((item) => item.status !== "冻结")
    .map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(item.status || "")}</option>`)
    .join("");
}

function scheduleMaterialOptionSearch(keyword) {
  clearTimeout(materialOptionTimer);
  materialOptionTimer = setTimeout(() => loadMaterialOptions(keyword), 160);
}

function scheduleLocationOptionSearch(keyword) {
  clearTimeout(locationOptionTimer);
  locationOptionTimer = setTimeout(() => loadLocationOptions(keyword), 160);
}

async function loadMaterialOptions(keyword = "") {
  if (!apiAvailable) {
    renderMaterialOptions((keyword ? getMaterialMatches(keyword, 20) : state.materials.slice(0, 20)));
    syncMaterialNameFields();
    return;
  }
  try {
    const data = await fetchApiPage("/api/material-search", { query: keyword, limit: 20 });
    cacheMaterials(data.rows || []);
    renderMaterialOptions(data.rows || []);
    syncMaterialNameFields();
    updateMaterialPicker();
  } catch {
    renderMaterialOptions((keyword ? getMaterialMatches(keyword, 20) : [...materialCache.values()].slice(0, 20)));
  }
}

async function loadLocationOptions(keyword = "") {
  const localRows = keyword
    ? state.locations.filter((item) => fuzzyMatchText(`${item.code} ${item.status || ""}`, keyword)).slice(0, 20)
    : state.locations.slice(0, 20);
  if (!apiAvailable) return renderLocationOptions(localRows);
  try {
    const data = await fetchApiPage("/api/location-search", { query: keyword, limit: 20 });
    cacheLocations(data.rows || []);
    renderLocationOptions(data.rows || []);
  } catch {
    renderLocationOptions(localRows.length ? localRows : [...locationCache.values()].slice(0, 20));
  }
}

function syncMaterialNameFields() {
  const materialInput = $("#skuInput");
  const countInput = $("#countSkuInput");
  if (materialInput) $("#materialNameInput").value = findMaterial(materialInput.value)?.name || "";
  if (countInput) $("#countMaterialNameInput").value = findMaterial(countInput.value)?.name || "";
}

function getFilteredStockRows() {
  const keyword = $("#stockSearch").value.trim();
  return state.stock
    .filter((item) => {
      const material = findMaterial(item.sku);
      return fuzzyMatchText(`${item.sku} ${material?.name || ""} ${item.batch} ${item.location} ${item.status}`, keyword);
    })
    .sort((a, b) => compareStockRows(a, b, keyword));
}

function stockQueryParams(extra = {}) {
  return {
    query: $("#stockSearch")?.value.trim() || "",
    sort: stockSortBy,
    dir: stockSortDir,
    page: stockPage.page,
    pageSize: stockPage.pageSize,
    ...extra
  };
}

function stockFields(row) {
  const material = findMaterial(row.sku);
  return {
    sku: row.sku || "",
    name: material?.name || row.name || "",
    batch: row.batch || "",
    location: row.location || "",
    status: row.status || "",
    qty: Number(row.qty || 0)
  };
}

function stockMatchRank(row, keyword) {
  const text = normalizeSearch(keyword);
  if (!text) return 0;
  const compactText = text.replace(/\s+/g, "");
  const fields = Object.values(stockFields(row))
    .filter((value) => typeof value !== "number")
    .map((value) => normalizeSearch(value));
  if (fields.some((field) => field === text || field.replace(/\s+/g, "") === compactText)) return 0;
  if (fields.some((field) => field.startsWith(text) || field.replace(/\s+/g, "").startsWith(compactText))) return 1;
  if (fields.some((field) => field.includes(text) || field.replace(/\s+/g, "").includes(compactText))) return 2;
  return 3;
}

function compareStockRows(a, b, keyword) {
  const rankDiff = stockMatchRank(a, keyword) - stockMatchRank(b, keyword);
  if (rankDiff) return rankDiff;
  const fieldsA = stockFields(a);
  const fieldsB = stockFields(b);
  let result = 0;
  if (stockSortBy === "qty") result = fieldsA.qty - fieldsB.qty;
  else {
    const key = ["sku", "name", "batch", "location", "status"].includes(stockSortBy) ? stockSortBy : "sku";
    result = compareText(fieldsA[key], fieldsB[key]);
  }
  if (stockSortDir === "desc") result *= -1;
  return result ||
    compareText(fieldsA.sku, fieldsB.sku) ||
    compareText(fieldsA.batch, fieldsB.batch) ||
    compareText(fieldsA.location, fieldsB.location);
}

function compareText(a, b) {
  return sortableText(a).localeCompare(sortableText(b), "zh-CN", { numeric: true, sensitivity: "base" });
}

function sortableText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function renderMetrics() {
  const total = state.stock.reduce((sum, item) => sum + item.qty, 0);
  if ($("#totalQty")) $("#totalQty").textContent = roundQty(total);
  if ($("#skuCount")) $("#skuCount").textContent = new Set(state.stock.map((item) => item.sku)).size;
  if ($("#holdCount")) $("#holdCount").textContent = state.stock.filter((item) => item.status !== "可用").length;
}

function renderStock() {
  if (apiAvailable) {
    loadStockPage();
    return;
  }
  currentStockRows = getFilteredStockRows();
  stockPage = { page: 1, pageSize: currentStockRows.length || 50, pages: 1, total: currentStockRows.length };
  renderStockRows(currentStockRows);
  renderStockPager();
}

async function loadStockPage() {
  const requestId = ++stockRequestId;
  $("#stockList").innerHTML = `<div class="empty-state">库存加载中...</div>`;
  renderStockPager();
  try {
    const data = await fetchApiPage("/api/stock", stockQueryParams());
    if (requestId !== stockRequestId) return;
    currentStockRows = data.rows || [];
    stockPage = { page: data.page || 1, pageSize: data.pageSize || 50, pages: data.pages || 1, total: data.total || 0 };
    renderStockRows(currentStockRows);
    renderStockPager();
  } catch (error) {
    $("#stockList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderStockRows(rows) {
  cacheMaterials(rows.filter((item) => item.sku && item.name).map((item) => ({ sku: item.sku, name: item.name })));
  const mobile = isMobileViewport();
  $("#stockList").innerHTML = rows.length
    ? mobile
      ? `
        <div class="cards-list">
          ${rows.map((item) => {
            const material = findMaterial(item.sku);
            return `
              <article class="data-card stock-card">
                <div>
                  <strong>${escapeHtml(item.sku)}</strong>
                  <span>${escapeHtml(item.name || material?.name || "未知物料")}</span>
                  <span>批号：${escapeHtml(item.batch)}</span>
                  <span>库位：${escapeHtml(item.location)}</span>
                </div>
                <div class="card-meta">
                  <b>${item.qty}</b>
                  <span>${escapeHtml(item.status)}</span>
                </div>
              </article>`;
          }).join("")}
        </div>`
      : `
      <div class="table-wrap">
        <table class="data-table stock-table">
          <thead>
            <tr>
              <th class="sortable-th ${stockSortClass("sku")}" data-stock-sort="sku">物料编码</th>
              <th class="sortable-th ${stockSortClass("name")}" data-stock-sort="name">名称</th>
              <th class="sortable-th ${stockSortClass("batch")}" data-stock-sort="batch">批号</th>
              <th class="sortable-th ${stockSortClass("location")}" data-stock-sort="location">位置</th>
              <th class="sortable-th ${stockSortClass("status")}" data-stock-sort="status">状态</th>
              <th class="num-cell sortable-th ${stockSortClass("qty")}" data-stock-sort="qty">数量</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => {
              const material = findMaterial(item.sku);
              return `
                <tr>
                  <td>${escapeHtml(item.sku)}</td>
                  <td>${escapeHtml(item.name || material?.name || "未知物料")}</td>
                  <td>${escapeHtml(item.batch)}</td>
                  <td>${escapeHtml(item.location)}</td>
                  <td>${escapeHtml(item.status)}</td>
                  <td class="num-cell">${item.qty}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state">当前没有库存数据。你可以先从库存页搜索物料、批号或库位。</div>`;
}

function renderStockPager() {
  renderPager("#stockPager", stockPage, "stock");
}

function renderPager(selector, pageState, prefix) {
  const target = $(selector);
  if (!target) return;
  if (!pageState.total) {
    target.innerHTML = "";
    return;
  }
  const from = (pageState.page - 1) * pageState.pageSize + 1;
  const to = Math.min(pageState.page * pageState.pageSize, pageState.total);
  target.innerHTML = `
    <span>显示 ${from}-${to} / ${pageState.total}</span>
    <div class="pager-actions">
      <button class="ghost-button" type="button" data-${prefix}-page="prev" ${pageState.page <= 1 ? "disabled" : ""}>上一页</button>
      <span>${pageState.page} / ${pageState.pages}</span>
      <button class="ghost-button" type="button" data-${prefix}-page="next" ${pageState.page >= pageState.pages ? "disabled" : ""}>下一页</button>
    </div>`;
}

function stockSortClass(key) {
  if (stockSortBy !== key) return "";
  return stockSortDir === "desc" ? "desc" : "asc";
}

function setStockSort(key) {
  if (stockSortBy === key) stockSortDir = stockSortDir === "asc" ? "desc" : "asc";
  else {
    stockSortBy = key;
    stockSortDir = key === "qty" ? "desc" : "asc";
  }
  stockPage.page = 1;
  renderStock();
}

function renderMaterials() {
  if (!currentUser() || !isAdmin()) {
    $("#materialList").innerHTML = "";
    $("#materialPager").innerHTML = "";
    return;
  }
  if (apiAvailable) {
    loadMaterialPage();
    return;
  }
  const keyword = $("#materialSearch")?.value || "";
  const rows = state.materials.filter((item) => fuzzyMatchText(`${item.sku} ${item.name}`, keyword));
  materialPage = { page: 1, pageSize: rows.length || 50, pages: 1, total: rows.length };
  renderMaterialRows(rows);
  renderPager("#materialPager", materialPage, "material");
}

async function loadMaterialPage() {
  const requestId = ++materialRequestId;
  $("#materialList").innerHTML = `<div class="empty-state">加载中...</div>`;
  try {
    const data = await fetchApiPage("/api/materials", {
      query: $("#materialSearch")?.value.trim() || "",
      page: materialPage.page,
      pageSize: materialPage.pageSize
    });
    if (requestId !== materialRequestId) return;
    materialPage = { page: data.page, pageSize: data.pageSize, pages: data.pages, total: data.total };
    cacheMaterials(data.rows || []);
    renderMaterialRows(data.rows || []);
    renderPager("#materialPager", materialPage, "material");
  } catch (error) {
    $("#materialList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    $("#materialPager").innerHTML = "";
  }
}

function renderMaterialRows(rows) {
  $("#materialList").innerHTML = rows.length
    ? rows.map((item) => `
        <article class="data-card">
          <div>
            <strong>${escapeHtml(item.sku)}</strong>
            <span>${escapeHtml(item.name)}</span>
          </div>
          <div class="card-meta">
            <button class="secondary-button mini-action" type="button" data-edit-material="${escapeHtml(item.sku)}">修改</button>
          </div>
        </article>`).join("")
    : emptyHtml();
}

function renderLocations() {
  if (!currentUser() || !isAdmin()) {
    $("#locationList").innerHTML = "";
    $("#locationPager").innerHTML = "";
    return;
  }
  if (apiAvailable) {
    loadLocationPage();
    return;
  }
  const keyword = $("#locationSearch")?.value || "";
  const rows = state.locations.filter((item) => fuzzyMatchText(`${item.code} ${item.status}`, keyword));
  locationPage = { page: 1, pageSize: rows.length || 50, pages: 1, total: rows.length };
  renderLocationRows(rows);
  renderPager("#locationPager", locationPage, "location");
}

async function loadLocationPage() {
  const requestId = ++locationRequestId;
  $("#locationList").innerHTML = `<div class="empty-state">加载中...</div>`;
  try {
    const data = await fetchApiPage("/api/locations", {
      query: $("#locationSearch")?.value.trim() || "",
      page: locationPage.page,
      pageSize: locationPage.pageSize
    });
    if (requestId !== locationRequestId) return;
    locationPage = { page: data.page, pageSize: data.pageSize, pages: data.pages, total: data.total };
    cacheLocations(data.rows || []);
    renderLocationRows(data.rows || []);
    renderPager("#locationPager", locationPage, "location");
  } catch (error) {
    $("#locationList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    $("#locationPager").innerHTML = "";
  }
}

function renderLocationRows(rows) {
  $("#locationList").innerHTML = rows.length
    ? rows.map((item) => `
        <article class="data-card">
          <div>
            <strong>${escapeHtml(item.code)}</strong>
            <span>${Number(item.stockRows ?? state.stock.filter((stock) => stock.location === item.code).length)} 条库存</span>
          </div>
          <div class="card-meta">
            <span>${escapeHtml(item.status)}</span>
            <button class="secondary-button mini-action" type="button" data-edit-location="${escapeHtml(item.code)}">修改</button>
          </div>
        </article>`).join("")
    : emptyHtml();
}

function renderUsers() {
  $("#userList").innerHTML = state.users.length
    ? state.users.map((user) => `
        <article class="data-card">
          <div>
            <strong>${escapeHtml(user.id)}</strong>
            <span>${escapeHtml(user.name)}</span>
          </div>
          <div class="card-meta">
            <span>${roleLabel(user.role)}</span>
            ${user.id === "admin" ? "" : `<button class="mini-danger" type="button" data-delete-user="${escapeHtml(user.id)}">删除</button>`}
          </div>
        </article>`).join("")
    : emptyHtml();
}

function renderLogs() {
  if (apiAvailable) {
    loadLogPage();
    return;
  }
  const keyword = $("#logSearch").value.trim();
  const rows = state.logs.filter((item) => fuzzyMatchText(`${ledgerAccount(item)} ${formatMinute(item.time)} ${typeLabel(item.type)} ${Object.values(item).join(" ")}`, keyword));
  logPage = { page: 1, pageSize: rows.length || 50, pages: 1, total: rows.length };
  renderLogRows(rows);
  renderLogPager();
}

async function loadLogPage() {
  const requestId = ++logRequestId;
  $("#logList").innerHTML = `<div class="empty-state">流水加载中...</div>`;
  renderLogPager();
  try {
    const data = await fetchApiPage("/api/logs", {
      query: $("#logSearch").value.trim(),
      page: logPage.page,
      pageSize: logPage.pageSize
    });
    if (requestId !== logRequestId) return;
    logPage = { page: data.page || 1, pageSize: data.pageSize || 50, pages: data.pages || 1, total: data.total || 0 };
    renderLogRows(data.rows || []);
    renderLogPager();
  } catch (error) {
    $("#logList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderLogRows(rows) {
  $("#logList").innerHTML = rows.length
    ? `
      <div class="table-wrap">
        <table class="data-table ledger-table">
          <thead>
            <tr>
              <th>操作日期</th>
              <th>账号</th>
              <th>类型</th>
              <th>物料编码</th>
              <th>批号</th>
              <th>库位</th>
              <th>目标库位</th>
              <th>状态</th>
              <th class="num-cell">数量</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => `
              <tr>
                <td>${escapeHtml(formatMinute(item.time))}</td>
                <td>${escapeHtml(ledgerAccount(item))}</td>
                <td>${escapeHtml(typeLabel(item.type))}</td>
                <td>${escapeHtml(item.sku || "")}</td>
                <td>${escapeHtml(item.batch || "")}</td>
                <td>${escapeHtml(item.location || "")}</td>
                <td>${escapeHtml(item.targetLocation || "")}</td>
                <td>${escapeHtml(item.status || "")}</td>
                <td class="num-cell">${escapeHtml(ledgerQty(item))}</td>
                <td>${escapeHtml(item.note || "")}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : emptyHtml();
}

function renderLogPager() {
  renderPager("#logPager", logPage, "log");
}

function renderAuditLogs() {
  const keyword = $("#auditSearch").value.trim();
  const rows = state.auditLogs.filter((item) => fuzzyMatchText(`${auditAccount(item)} ${formatMinute(item.time)} ${item.action} ${item.entity} ${item.key} ${auditValue(item.before)} ${auditValue(item.after)} ${item.note || ""}`, keyword));
  $("#auditList").innerHTML = rows.length
    ? `
      <div class="table-wrap">
        <table class="data-table audit-table">
          <thead>
            <tr>
              <th>操作日期</th>
              <th>账号</th>
              <th>对象</th>
              <th>操作</th>
              <th>主键</th>
              <th>修改前</th>
              <th>修改后</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => `
              <tr>
                <td>${escapeHtml(formatMinute(item.time))}</td>
                <td>${escapeHtml(auditAccount(item))}</td>
                <td>${escapeHtml(item.entity || "")}</td>
                <td>${escapeHtml(item.action || "")}</td>
                <td>${escapeHtml(item.key || "")}</td>
                <td>${escapeHtml(auditValue(item.before))}</td>
                <td>${escapeHtml(auditValue(item.after))}</td>
                <td>${escapeHtml(item.note || "")}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
    : emptyHtml();
}

function auditAccount(item) {
  return `${item.operatorId || ""}${item.operatorName ? ` ${item.operatorName}` : ""}`.trim();
}

function auditValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "object") return String(value);
  return Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && entryValue !== "")
    .map(([key, entryValue]) => `${key}:${entryValue}`)
    .join(" / ");
}

function ledgerAccount(item) {
  if (item.operatorId || item.operatorName) return `${item.operatorId || ""}${item.operatorName ? ` ${item.operatorName}` : ""}`.trim();
  return item.operator || "";
}

function ledgerQty(item) {
  if (item.type === "adjust" && item.beforeQty !== undefined && item.beforeQty !== null) return `${item.beforeQty} -> ${item.qty}`;
  return item.qty || "";
}

function typeLabel(type) {
  return { in: "入库", out: "出库", move: "移库", count: "盘点", adjust: "盘点调整", initial: "期初" }[type] || type;
}

function emptyHtml() {
  return $("#emptyTemplate").innerHTML;
}

function render() {
  renderUserSelect();
  renderPermissions();
  renderRuntimeState();
  renderOptions();
  renderMetrics();
  renderStock();
  renderMaterials();
  renderLocations();
  renderUsers();
  renderLogs();
  renderAuditLogs();
  updateCountPreview();
  updateCountHelper();
  updateMaterialPicker();
  updateOperationHelper();
  updateOperationStockList();
}

function showToast(text) {
  let toast = $(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function setButtonBusy(button, busy, busyText = "处理中") {
  if (!button) return;
  if (busy) {
    button.dataset.busy = "1";
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.dataset.busy = "";
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = button.dataset.logicDisabled === "1" || (serverRequired && !apiAvailable);
  }
}

function setFormSubmitting(form, busy) {
  if (!form) return;
  form.dataset.submitting = busy ? "1" : "";
  form.querySelectorAll("button[type='submit']").forEach((button) => {
    button.disabled = busy;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = "提交中";
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
    if (!busy) button.disabled = button.dataset.logicDisabled === "1" || (serverRequired && !apiAvailable);
  });
}

async function withButtonBusy(button, busyText, action) {
  if (button?.dataset.busy === "1") return;
  setButtonBusy(button, true, busyText);
  try {
    await action();
  } finally {
    setButtonBusy(button, false);
  }
}

async function exportStock() {
  let sourceRows = currentStockRows;
  if (apiAvailable) {
    try {
      const data = await fetchApiPage("/api/stock", stockQueryParams({ export: "1", page: 1 }));
      sourceRows = data.rows || [];
    } catch (error) {
      return showToast(error.message);
    }
  }
  const rows = sourceRows.map((item) => {
    const material = findMaterial(item.sku);
    return {
      物料编码: item.sku,
      物料名称: item.name || material?.name || "",
      批号: item.batch,
      数量: item.qty,
      库位: item.location,
      状态: item.status
    };
  });
  downloadCsv(rows, `库存导出-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadTemplate() {
  downloadCsv([{ 物料编码: "RM-1001", 物料名称: "甘油", 批号: "B20260501", 数量: "120", 库位: "A-01-01", 状态: "可用" }], "库存导入模板.csv");
}

function downloadMaterialTemplate() {
  downloadCsv([{ 物料编码: "RM-1001", 物料名称: "甘油" }], "物料主数据模板.csv");
}

function downloadLocationTemplate() {
  downloadCsv([{ 库位: "A-01-01", 状态: "空闲" }], "库位主数据模板.csv");
}

function downloadCsv(rows, filename) {
  const headers = Object.keys(rows[0] || { 空: "" });
  const csv = `\uFEFF${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function importInventory() {
  if (!isAdmin()) return showToast("没有权限");
  const rows = await readSelectedRows("#inventoryFile");
  if (!rows.length) return showToast("文件没有可导入数据");
  const report = validateInventoryRows(rows);
  renderImportReport("期初库存校验报告", report);
  if (!report.validRows) return showToast("没有有效库存行，请检查文件");
  if (!confirm(importConfirmText("期初库存", report))) return;
  try {
    const remote = await postMasterData("/api/import-inventory", { rows });
    if (remote) {
      render();
      return showToast("库存导入已提交");
    }
  } catch (error) {
    return showToast(error.message);
  }
  const groupedRows = new Map();
  let rejected = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["物料编码", "存货编码", "sku", "SKU"]));
    const name = String(pickField(row, ["物料名称", "存货名称", "name"]) || "").trim();
    const batch = normalize(pickField(row, ["批号", "batch"]));
    const rawQty = pickField(row, ["数量", "可用数量", "现存量", "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["库位", "库位编码", "仓库名称", "仓库", "location"]));
    const status = String(pickField(row, ["状态", "库存状态", "status"]) || "可用").trim();
    if (!sku || !name || !batch || !location || qty === null) {
      rejected += 1;
      return;
    }
    const key = `${sku}||${batch}||${location}||${status}`;
    const existing = groupedRows.get(key);
    if (existing) {
      existing.qty = roundQty(existing.qty + qty);
    } else {
      groupedRows.set(key, { sku, name, batch, location, status, qty });
    }
  });
  groupedRows.forEach((item) => {
    upsertMaterial({ sku: item.sku, name: item.name });
    if (!findLocation(item.location)) state.locations.push({ code: item.location, status: "空闲" });
    const existing = findStock(item.sku, item.batch, item.location, item.status);
    if (existing) {
      existing.qty = item.qty;
      touchStock(existing);
    } else {
      state.stock.push({ id: uid(), sku: item.sku, batch: item.batch, location: item.location, status: item.status, qty: item.qty, version: 1, updatedAt: new Date().toISOString() });
    }
  });
  const imported = groupedRows.size;
  refreshLocationUsage();
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: imported, location: "", targetLocation: "", status: "", note: `导入期初库存 ${imported} 行，拒绝 ${rejected} 行` });
  addAuditLog({ action: "导入期初库存", entity: "库存导入", key: "IMPORT", before: null, after: { imported, rejected, sourceRows: rows.length }, note: `导入期初库存 ${imported} 行，拒绝 ${rejected} 行` });
  saveState();
  render();
  showToast(`已导入 ${imported} 行，拒绝 ${rejected} 行`);
}

async function importMaterials() {
  if (!isAdmin()) return showToast("没有权限");
  const rows = await readSelectedRows("#materialFile");
  if (!rows.length) return showToast("文件没有可导入数据");
  const report = validateMaterialRows(rows);
  renderImportReport("物料主数据校验报告", report);
  if (!report.validRows) return showToast("没有有效物料行，请检查文件");
  if (!confirm(importConfirmText("物料主数据", report))) return;
  try {
    const remote = await postMasterData("/api/import-materials", { rows });
    if (remote) {
      render();
      return showToast("物料主数据导入已提交");
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["物料编码", "存货编码", "sku", "SKU"]));
    const name = String(pickField(row, ["物料名称", "存货名称", "name"]) || "").trim();
    if (!sku || !name) return;
    upsertMaterial({ sku, name });
    imported += 1;
  });
  addAuditLog({ action: "导入物料主数据", entity: "物料主数据", key: "IMPORT", before: null, after: { imported }, note: `导入物料 ${imported} 行` });
  saveState();
  render();
  showToast(`已导入物料 ${imported} 行`);
}

async function importLocations() {
  if (!isAdmin()) return showToast("没有权限");
  const rows = await readSelectedRows("#locationFile");
  if (!rows.length) return showToast("文件没有可导入数据");
  const report = validateLocationRows(rows);
  renderImportReport("库位主数据校验报告", report);
  if (!report.validRows) return showToast("没有有效库位行，请检查文件");
  if (!confirm(importConfirmText("库位主数据", report))) return;
  try {
    const remote = await postMasterData("/api/import-locations", { rows });
    if (remote) {
      render();
      return showToast("库位主数据导入已提交");
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const code = normalize(row["库位"] || row["库位编码"] || row.location || row.code);
    const status = String(row["状态"] || row.status || "空闲").trim();
    if (!code) return;
    const existing = findLocation(code);
    if (existing) existing.status = status;
    else state.locations.push({ code, status });
    imported += 1;
  });
  refreshLocationUsage();
  addAuditLog({ action: "导入库位主数据", entity: "库位主数据", key: "IMPORT", before: null, after: { imported }, note: `导入库位 ${imported} 行` });
  saveState();
  render();
  showToast(`已导入库位 ${imported} 行`);
}

async function downloadBackup() {
  if (!isAdmin()) return showToast("没有权限");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "备份失败");
    const filename = `wms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("备份已下载");
  } catch (error) {
    showToast(error.message);
  }
}

async function downloadAutoBackup() {
  if (!isAdmin()) return showToast("没有权限");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/auto-backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "自动备份下载失败");
    const filename = `wms-auto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("自动备份已下载");
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreBackup() {
  if (!isAdmin()) return showToast("没有权限");
  if (!requireLiveServer("恢复备份")) return;
  const file = $("#restoreFile").files[0];
  if (!file) return showToast("请选择备份 JSON 文件");
  if (!confirm("恢复备份会覆盖当前库存、主数据、账号和流水，确定继续吗？")) return;
  try {
    const backup = JSON.parse(await readTextFile(file));
    const auth = currentAuthPayload();
    const response = await fetch("/api/restore-backup", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ backup, operatorId: auth.operatorId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "恢复失败");
    const currentUserId = state.currentUserId;
    Object.assign(state, migrateState({ ...defaultState(), ...data }));
    state.currentUserId = currentUserId;
    wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
    $("#restoreFile").value = "";
    render();
    showToast("备份已恢复");
  } catch (error) {
    showToast(error.message || "备份文件无法读取");
  }
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file, "utf-8");
  });
}

function validateInventoryRows(rows) {
  const report = createReport(rows.length);
  const grouped = new Map();
  rows.forEach((row, index) => {
    const sku = normalize(pickField(row, ["物料编码", "存货编码", "sku", "SKU"]));
    const name = String(pickField(row, ["物料名称", "存货名称", "name"]) || "").trim();
    const batch = normalize(pickField(row, ["批号", "batch"]));
    const rawQty = pickField(row, ["数量", "可用数量", "现存量", "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["库位", "库位编码", "仓库名称", "仓库", "location"]));
    const status = String(pickField(row, ["状态", "库存状态", "status"]) || "可用").trim();
    const reasons = [];
    if (!sku) reasons.push("缺少物料编码");
    if (!name) reasons.push("缺少物料名称");
    if (!batch) reasons.push("缺少批号");
    if (!location) reasons.push("缺少库位");
    if (qty === null) reasons.push(qtyErrorText(rawQty));
    if (reasons.length) return addInvalid(report, index, reasons);
    report.validRows += 1;
    report.totalQty = roundQty(report.totalQty + qty);
    const key = `${sku}||${batch}||${location}||${status}`;
    if (grouped.has(key)) report.duplicateRows += 1;
    grouped.set(key, true);
  });
  report.mergedRows = grouped.size;
  return report;
}

function validateMaterialRows(rows) {
  const report = createReport(rows.length);
  const seen = new Set();
  rows.forEach((row, index) => {
    const sku = normalize(pickField(row, ["物料编码", "存货编码", "sku", "SKU"]));
    const name = String(pickField(row, ["物料名称", "存货名称", "name"]) || "").trim();
    const reasons = [];
    if (!sku) reasons.push("缺少物料编码");
    if (!name) reasons.push("缺少物料名称");
    if (reasons.length) return addInvalid(report, index, reasons);
    report.validRows += 1;
    if (seen.has(sku)) report.duplicateRows += 1;
    seen.add(sku);
  });
  report.mergedRows = seen.size;
  return report;
}

function validateLocationRows(rows) {
  const report = createReport(rows.length);
  const seen = new Set();
  rows.forEach((row, index) => {
    const code = normalize(pickField(row, ["库位", "库位编码", "仓库名称", "仓库", "location", "code"]));
    if (!code) return addInvalid(report, index, ["缺少库位编码"]);
    report.validRows += 1;
    if (seen.has(code)) report.duplicateRows += 1;
    seen.add(code);
  });
  report.mergedRows = seen.size;
  return report;
}

function createReport(sourceRows) {
  return { sourceRows, validRows: 0, invalidRows: 0, duplicateRows: 0, mergedRows: 0, totalQty: 0, invalidSamples: [] };
}

function addInvalid(report, index, reasons) {
  report.invalidRows += 1;
  if (report.invalidSamples.length < 8) report.invalidSamples.push(`第 ${index + 2} 行：${reasons.join("；")}`);
}

function renderImportReport(title, report) {
  const target = $("#importReport");
  if (!target) return;
  target.classList.remove("hidden");
  const invalid = report.invalidSamples.length ? `<br>${report.invalidSamples.map(escapeHtml).join("<br>")}` : "";
  target.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    原始 ${report.sourceRows} 行；有效 ${report.validRows} 行；无效 ${report.invalidRows} 行；重复合并 ${report.duplicateRows} 行；最终导入 ${report.mergedRows} 行。
    ${report.totalQty ? `<br>有效数量合计：${report.totalQty}` : ""}
    ${invalid}`;
}

function importConfirmText(title, report) {
  return `${title}导入校验：\n原始 ${report.sourceRows} 行\n有效 ${report.validRows} 行\n无效 ${report.invalidRows} 行\n重复合并 ${report.duplicateRows} 行\n最终导入 ${report.mergedRows} 行\n\n是否继续导入有效数据？`;
}

async function readSelectedRows(selector) {
  const file = $(selector).files[0];
  if (!file) {
    showToast("请选择 Excel 或 CSV 文件");
    return [];
  }
  return readRows(file);
}

function readRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (file.name.toLowerCase().endsWith(".csv") || !window.XLSX) return resolve(parseCsv(String(reader.result)));
        const workbook = XLSX.read(reader.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(sheetToRows(sheet));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    if (file.name.toLowerCase().endsWith(".csv") || !window.XLSX) reader.readAsText(file, "utf-8");
    else reader.readAsArrayBuffer(file);
  });
}

function sheetToRows(sheet) {
  const matrix = sheetToTextMatrix(sheet);
  const headerIndex = matrix.findIndex((row) => row.filter((cell) => String(cell).trim()).length >= 3);
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map((cell) => String(cell).trim());
  return matrix.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell).trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header || `__EMPTY_${index}`, row[index] ?? ""])));
}

function sheetToTextMatrix(sheet) {
  if (!sheet?.["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      row.push(cellDisplayText(sheet[address]));
    }
    rows.push(row);
  }
  return rows;
}

function cellDisplayText(cell) {
  if (!cell) return "";
  if (cell.w !== undefined) return String(cell.w).trim();
  if (cell.v !== undefined) return String(cell.v).trim();
  return "";
}

function pickField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = splitCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = cells[index] || "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function upsertMaterial(material) {
  const existing = state.materials.find((item) => item.sku === material.sku);
  if (existing) Object.assign(existing, material);
  else state.materials.push(material);
}

async function addMaterial(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("没有权限");
  const sku = normalize($("#newSku").value);
  const name = $("#newName").value.trim();
  const previousSku = editingMaterialSku;
  if (!sku || !name) return showToast("物料编码和名称不能为空");
  if (!previousSku && state.materials.some((item) => item.sku === sku)) return showToast("物料编码已存在，请搜索后点修改");
  if (previousSku && previousSku !== sku && state.materials.some((item) => item.sku === sku)) return showToast("物料编码已存在");
  try {
    const remote = await postMasterData("/api/materials", { previousSku, sku, name });
    if (!remote) {
      const existing = state.materials.find((item) => item.sku === (previousSku || sku));
      const before = existing ? { ...existing } : null;
      if (existing) Object.assign(existing, { sku, name });
      else upsertMaterial({ sku, name });
      if (previousSku && previousSku !== sku) state.stock.forEach((row) => {
        if (row.sku === previousSku) {
          row.sku = sku;
          touchStock(row);
        }
      });
      addAuditLog({ action: existing ? (previousSku && previousSku !== sku ? "修改物料编码" : "修改物料") : "新增物料", entity: "物料主数据", key: sku, before, after: { sku, name } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheMaterials([{ sku, name }]);
  materialPage.page = 1;
  resetMaterialEdit();
  render();
  showToast("物料主数据已保存");
}

async function addLocation(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("没有权限");
  const code = normalize($("#newLocation").value);
  const previousCode = editingLocationCode;
  const status = $("#newLocationStatus").value;
  if (!code) return showToast("库位编码不能为空");
  if (!previousCode && state.locations.some((item) => item.code === code)) return showToast("库位已存在，请搜索后点修改");
  if (previousCode && previousCode !== code && state.locations.some((item) => item.code === code)) return showToast("库位编码已存在");
  try {
    const remote = await postMasterData("/api/locations", { previousCode, code, status });
    if (!remote) {
      const existing = findLocation(previousCode || code);
      const before = existing ? { ...existing } : null;
      if (existing) Object.assign(existing, { code, status });
      else state.locations.push({ code, status });
      if (previousCode && previousCode !== code) state.stock.forEach((row) => {
        if (row.location === previousCode) {
          row.location = code;
          touchStock(row);
        }
        if (row.targetLocation === previousCode) row.targetLocation = code;
      });
      refreshLocationUsage();
      addAuditLog({ action: existing ? (previousCode && previousCode !== code ? "修改库位编码" : "修改库位") : "新增库位", entity: "库位主数据", key: code, before, after: findLocation(code) || { code, status } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheLocations([{ code, status }]);
  locationPage.page = 1;
  resetLocationEdit();
  render();
  showToast("库位主数据已保存");
}

function editMaterial(sku) {
  const material = findMaterial(sku);
  if (!material) return;
  editingMaterialSku = material.sku;
  $("#newSku").value = material.sku;
  $("#newName").value = material.name;
  $("#materialSaveButton").textContent = "保存修改";
  $("#cancelMaterialEdit").classList.remove("hidden");
  $("#newName").focus();
}

function resetMaterialEdit() {
  editingMaterialSku = "";
  $("#materialForm").reset();
  $("#materialSaveButton").textContent = "保存";
  $("#cancelMaterialEdit").classList.add("hidden");
}

function editLocation(code) {
  const location = findLocation(code);
  if (!location) return;
  editingLocationCode = location.code;
  $("#newLocation").value = location.code;
  $("#newLocationStatus").value = location.status || "空闲";
  $("#locationSaveButton").textContent = "保存修改";
  $("#cancelLocationEdit").classList.remove("hidden");
  $("#newLocation").focus();
}

function resetLocationEdit() {
  editingLocationCode = "";
  $("#locationForm").reset();
  $("#locationSaveButton").textContent = "保存";
  $("#cancelLocationEdit").classList.add("hidden");
}

async function addUser(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("没有权限");
  const id = normalize($("#newUserId").value);
  const existing = state.users.find((user) => user.id === id);
  const password = $("#newUserPassword").value.trim();
  const user = { id, name: $("#newUserName").value.trim(), role: $("#newUserRole").value };
  if (!existing && !password) return showToast("新增账号必须设置密码");
  try {
    const remote = await postUserData("/api/users", { id, name: user.name, role: user.role, userPassword: password });
    if (!remote) {
      const before = existing ? { id: existing.id, name: existing.name, role: existing.role } : null;
      if (existing) Object.assign(existing, user);
      else state.users.push(user);
      const afterUser = state.users.find((item) => item.id === id);
      addAuditLog({ action: existing ? "修改账号" : "新增账号", entity: "账号权限", key: id, before, after: { id: afterUser.id, name: afterUser.name, role: afterUser.role } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  if (id.toLowerCase() === "admin" && password && sessionAuth.userId?.toLowerCase() === "admin") {
    sessionAuth = { ...sessionAuth, mustChangePassword: false };
    wmsSessionStorage.setItem(authKey, JSON.stringify(sessionAuth));
  }
  event.target.reset();
  render();
}

function login() {
  debugLogin("login clicked");
  loginAsync();
}

async function loginAsync() {
  const userId = $("#loginUserInput").value.trim();
  const password = $("#loginPasswordInput").value;
  const button = $("#loginButton");
  if (button.dataset.busy === "1") return;
  setButtonBusy(button, true, "登录中");
  try {
    debugLogin("sending /api/login");
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WMS-Lite-Lite": "1" },
      body: JSON.stringify({ userId, password })
    });
    const data = await response.json();
    debugLogin(`/api/login status ${response.status}`);
    if (!response.ok) throw new Error(data.error || "账号或密码错误");
    debugLogin(`/api/login response user ${data.user?.id || ""}`);
    Object.assign(state, migrateState({ ...defaultState(), ...(data.state || {}) }));
    state.currentUserId = data.user.id;
    window.__loginJustCompleted = true;
    saveSessionAuth(data.user.id, data.token, data.expiresAt, data.mustChangePassword);
    apiAvailable = true;
    apiSyncAttempted = true;
    apiConnectionState = "connected";
    $("#loginPasswordInput").value = "";
    saveState();
    debugLogin(`currentUserId after login ${state.currentUserId}`);
    render();
    debugLogin("render called after login");
    if (data.mustChangePassword) {
      activateView("users");
      showToast("管理员仍在使用默认密码，请先修改密码");
    }
  } catch (error) {
    debugLogin(`login error ${error?.message || "unknown"}`);
    showToast(error.message);
  } finally {
    setButtonBusy(button, false);
  }
}

function logout() {
  const token = sessionAuth.token;
  if (apiAvailable && token) {
    fetch("/api/logout", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({})
    }).catch(() => {});
  }
  state.currentUserId = "";
  clearSessionAuth();
  saveState();
  activateView("operate");
  render();
}

async function deleteUser(userId) {
  if (!isAdmin()) return showToast("没有权限");
  if (userId === "admin") return showToast("不能删除管理员账号");
  if (!confirm(`确定删除账号 ${userId}？`)) return;
  try {
    const remote = await postUserData("/api/users/delete", { targetId: userId });
    if (!remote) {
      const before = state.users.find((user) => user.id === userId);
      state.users = state.users.filter((user) => user.id !== userId);
      if (state.currentUserId === userId) state.currentUserId = "";
      if (before) addAuditLog({ action: "删除账号", entity: "账号权限", key: userId, before: { id: before.id, name: before.name, role: before.role }, after: null });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  render();
}

function activateView(viewId) {
  $$(".tab").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === viewId));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}

function updateInstallButton() {
  const button = $("#installAppButton");
  if (!button) return;
  button.classList.toggle("hidden", !installPromptEvent || isStandaloneMode());
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPromptEvent = event;
    updateInstallButton();
  });
  $("#installAppButton")?.addEventListener("click", async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    updateInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    installPromptEvent = null;
    updateInstallButton();
  });
}

function registerServiceWorker() {
  if (!serverRequired || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

$$(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    if (!isAdmin() && !["operate", "count", "stock"].includes(button.dataset.view)) return showToast("没有权限");
    if (!canOpenView(button.dataset.view)) return showToast("没有权限");
    activateView(button.dataset.view);
  });
});

$("#operationTypeInput").addEventListener("change", (event) => {
  operationType = event.target.value;
  $("#operationStockSearch").value = "";
  $("#selectedStockInfo").innerHTML = "";
  selectedOperationStock = null;
  selectedOperationVersion = null;
  resetOperationForm($("#operationForm"));
  $("#operationTypeInput").value = operationType;
  updateMaterialPicker();
  updateOperationStockList();
});

$$("#mobileHome [data-home-action]").forEach((button) => {
  button.addEventListener("click", () => selectHomeAction(button.dataset.homeAction));
});

$("#operationConfirmCancel").addEventListener("click", closeOperationConfirm);
$("#operationConfirmSubmit").addEventListener("click", commitPendingOperation);

bindLoginButton();
$("#resetAdminButton").addEventListener("click", ensureAdminAccount);
$("#logoutButton").addEventListener("click", logout);
$("#skuInput").addEventListener("input", () => {
  scheduleMaterialOptionSearch($("#skuInput").value);
  $("#materialNameInput").value = findMaterial($("#skuInput").value)?.name || "";
  updateMaterialPicker();
  updateOperationStockList();
});
$("#materialPickerList").addEventListener("click", selectMaterialFromPicker);
$("#batchInput").addEventListener("input", updateOperationStockList);
$("#locationInput").addEventListener("input", () => {
  scheduleLocationOptionSearch($("#locationInput").value);
  updateOperationStockList();
});
$("#targetLocationInput").addEventListener("input", () => {
  scheduleLocationOptionSearch($("#targetLocationInput").value);
  updateOperationHelper();
});
$("#statusInput").addEventListener("change", updateOperationStockList);
$("#operationStockSearch").addEventListener("input", updateOperationStockList);
$("#operationStockList").addEventListener("click", selectOperationStock);
$("#qtyInput").addEventListener("blur", (event) => {
  if (event.target.value && parseSystemQty(event.target.value) === null) showToast(qtyErrorText(event.target.value));
  const qty = parseSystemQty(event.target.value);
  const maxQty = Number(event.target.dataset.maxQty || 0);
  if (qty !== null && maxQty && qty > maxQty) showToast("本次数量不能超过现有库存");
});
$("#qtyInput").addEventListener("input", updateOperationHelper);
$("#operationForm").addEventListener("submit", submitOperation);
$("#countForm").addEventListener("submit", submitCount);
$("#countStockList").addEventListener("click", selectCountStock);
$("#countStockSearch").addEventListener("input", updateCountPreview);
$("#countSkuInput").addEventListener("input", () => {
  scheduleMaterialOptionSearch($("#countSkuInput").value);
  updateCountPreview();
});
$("#countBatchInput").addEventListener("input", updateCountPreview);
$("#countStatusInput").addEventListener("change", updateCountPreview);
$("#countLocationInput").addEventListener("input", () => {
  scheduleLocationOptionSearch($("#countLocationInput").value);
  updateCountHelper();
});
$("#countQtyInput").addEventListener("blur", (event) => {
  if (event.target.value && parseSystemQty(event.target.value) === null) showToast(qtyErrorText(event.target.value));
});
$("#countQtyInput").addEventListener("input", updateCountHelper);
$("#seedDemo").addEventListener("click", seedDemo);
$("#stockSearch").addEventListener("input", () => {
  stockPage.page = 1;
  renderStock();
});
$("#stockList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-stock-sort]");
  if (button) setStockSort(button.dataset.stockSort);
});
$("#stockPager")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-stock-page]");
  if (!button) return;
  stockPage.page += button.dataset.stockPage === "next" ? 1 : -1;
  renderStock();
});
$("#logSearch").addEventListener("input", () => {
  logPage.page = 1;
  renderLogs();
});
$("#logPager")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-log-page]");
  if (!button) return;
  logPage.page += button.dataset.logPage === "next" ? 1 : -1;
  renderLogs();
});
$("#auditSearch").addEventListener("input", renderAuditLogs);
$("#materialSearch").addEventListener("input", () => {
  materialPage.page = 1;
  renderMaterials();
});
$("#locationSearch").addEventListener("input", () => {
  locationPage.page = 1;
  renderLocations();
});
$("#materialPager")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-material-page]");
  if (!button) return;
  materialPage.page += button.dataset.materialPage === "next" ? 1 : -1;
  renderMaterials();
});
$("#locationPager")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-location-page]");
  if (!button) return;
  locationPage.page += button.dataset.locationPage === "next" ? 1 : -1;
  renderLocations();
});
$("#exportStock").addEventListener("click", exportStock);
$("#downloadTemplate").addEventListener("click", downloadTemplate);
$("#downloadMaterialTemplate").addEventListener("click", downloadMaterialTemplate);
$("#downloadLocationTemplate").addEventListener("click", downloadLocationTemplate);
$("#importInventory").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "导入中", importInventory));
$("#importMaterials").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "导入中", importMaterials));
$("#importLocations").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "导入中", importLocations));
$("#downloadBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "备份中", downloadBackup));
$("#downloadAutoBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "下载中", downloadAutoBackup));
$("#restoreBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "恢复中", restoreBackup));
$("#materialForm").addEventListener("submit", addMaterial);
$("#locationForm").addEventListener("submit", addLocation);
$("#cancelMaterialEdit").addEventListener("click", resetMaterialEdit);
$("#cancelLocationEdit").addEventListener("click", resetLocationEdit);
$("#materialList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-material]");
  if (button) editMaterial(button.dataset.editMaterial);
});
$("#locationList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-location]");
  if (button) editLocation(button.dataset.editLocation);
});
$("#userForm").addEventListener("submit", addUser);
$("#userList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-user]");
  if (button) deleteUser(button.dataset.deleteUser);
});
window.addEventListener("storage", (event) => {
  if (event.key !== storeKey || !event.newValue) return;
  Object.assign(state, JSON.parse(event.newValue));
  setSyncStatus("收到更新");
  render();
});

window.addEventListener("online", initApiSync);
window.addEventListener("offline", () => {
  apiAvailable = false;
  setSyncStatus(syncStatusText());
});

if (channel) {
  channel.addEventListener("message", (event) => {
    if (event.data?.type !== "state-updated") return;
    Object.assign(state, event.data.state);
    saveState(false);
    setSyncStatus("收到更新");
    render();
  });
}

setupInstallPrompt();
registerServiceWorker();
render();
initApiSync();

