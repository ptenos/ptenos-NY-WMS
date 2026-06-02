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
      { id: "admin", name: "绠＄悊鍛?, role: "admin" },
      { id: "WH-001", name: "浠撳簱鍛樺伐", role: "employee" },
      { id: "WH-MGR", name: "浠撶", role: "keeper" }
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
    showToast("姝ｅ紡鏈嶅姟涓嶈兘鍦ㄦ墜鏈虹閲嶇疆绠＄悊鍛樺瘑鐮侊紝璇峰湪璐﹀彿鏉冮檺閲屼慨鏀瑰瘑鐮?);
    return;
  }
  let admin = state.users.find((user) => String(user.id).toLowerCase() === "admin");
  if (!admin) {
    admin = { id: "admin", name: "绠＄悊鍛?, role: "admin" };
    state.users.unshift(admin);
  }
  admin.id = "admin";
  admin.name = admin.name || "绠＄悊鍛?;
  admin.role = "admin";
  delete admin.password;
  delete admin.passwordHash;
  saveState();
  render();
  showToast("绠＄悊鍛樺瘑鐮佸凡閲嶇疆涓?admin123");
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
  return { employee: "鍛樺伐", keeper: "浠撶", admin: "绠＄悊鍛?, operator: "鍛樺伐" }[role] || role;
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
    setSyncStatus("鏈嶅姟鍣ㄥ悓姝?);
  } catch {
    apiAvailable = false;
    setSyncStatus("鏈満婕旂ず");
  }
}

function setSyncStatus(text) {
  $("#syncStatus").textContent = text;
  renderRuntimeState();
}

function syncStatusText() {
  if (apiConnectionState === "connecting" && !apiSyncAttempted) return "杩炴帴涓?;
  if (apiAvailable || apiConnectionState === "connected") return "鏈嶅姟鍣ㄥ凡杩炴帴";
  if (apiConnectionState === "failed") return serverRequired ? "鏈嶅姟鍣ㄨ繛鎺ュけ璐? : "鏈満婕旂ず";
  return serverRequired ? "鏈嶅姟鍣ㄦ湭杩炴帴" : "鏈満婕旂ず";
}

function requireLiveServer(action = "鎿嶄綔") {
  if (!serverRequired || apiAvailable) return true;
  showToast(`鏈嶅姟鍣ㄦ湭杩炴帴锛?{action}鏆備笉鑳芥墽琛宍);
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
  if (text.includes(",")) return "鏁伴噺涓嶈兘浣跨敤閫楀彿锛岃涓嶈杈撳叆鍗板凹灏忔暟鏍煎紡锛屼緥濡?1.000,5";
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return "鏁伴噺涓嶈兘浣跨敤鍗板凹鍗冨垎浣嶆牸寮忥紝渚嬪 1.000";
  return "鏁伴噺鍙兘杈撳叆鏅€氭暟瀛楋紝鏈€澶?6 浣嶅皬鏁帮紝渚嬪 1000 鎴?1000.123456";
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
    if (serverRequired) throw new Error("鏈嶅姟鍣ㄦ湭杩炴帴锛岃鎭㈠缃戠粶鍚庨噸璇?);
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch("/api/operations", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "鎿嶄綔澶辫触");
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postMasterData(path, payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("鏈嶅姟鍣ㄦ湭杩炴帴锛岃鎭㈠缃戠粶鍚庨噸璇?);
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "淇濆瓨澶辫触");
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
    if (serverRequired) throw new Error("鏈嶅姟鍣ㄦ湭杩炴帴锛岃鎭㈠缃戠粶鍚庨噸璇?);
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "璐﹀彿淇濆瓨澶辫触");
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
  if (!response.ok) throw new Error(data.error || "鏁版嵁鍔犺浇澶辫触");
  return data;
}

function removeZeroStock() {
  state.stock = state.stock.filter((item) => item.qty > 0);
}

function refreshLocationUsage() {
  state.locations.forEach((location) => {
    if (location.status !== "鍐荤粨") {
      location.status = state.stock.some((item) => item.location === location.code) ? "鍗犵敤" : "绌洪棽";
    }
  });
}

function addLog(payload) {
  const user = currentUser();
  state.logs.unshift({
    id: uid(),
    operatorId: user?.id || "",
    operatorName: user?.name || "",
    operator: user ? `${user.id} ${user.name}` : "鏈€夋嫨",
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

  if (!material) return showToast("鐗╂枡蹇呴』浠庝富鏁版嵁鎼滅储閫夋嫨");
  if (!findLocation(location)) return showToast("搴撲綅蹇呴』浠庝富鏁版嵁鎼滅储閫夋嫨");
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (qty <= 0) return showToast(operationType === "in" ? "鍏ュ簱鏁伴噺蹇呴』澶т簬 0" : "鏈鏁伴噺蹇呴』澶т簬 0");
  const selectedRow = selectedOperationSourceMatches(sku, batch, status) ? selectedOperationStock : null;
  if (["out", "move"].includes(operationType)) {
    if (!selectedRow) return showToast("璇峰厛閫夋嫨瑕佹搷浣滅殑搴撳瓨鏄庣粏");
    if (qty > Number(selectedRow.qty || 0)) return showToast("鏈鏁伴噺涓嶈兘瓒呰繃鐜版湁搴撳瓨");
  }
  if (operationType === "move") {
    if (!targetLocation || !findLocation(targetLocation)) return showToast("璇烽€夋嫨鏈夋晥鐩爣搴撲綅");
    if (findLocation(targetLocation)?.status === "鍐荤粨") return showToast("鐩爣搴撲綅宸插喕缁?);
    if (targetLocation === (selectedRow?.location || location)) return showToast("鐩爣搴撲綅涓嶈兘鍜屽師搴撲綅鐩稿悓");
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
        return showToast("浣滀笟宸叉彁浜?);
      }
    } catch (error) {
      return showToast(error.message);
    }

    if (operationType === "in") {
      if (qty <= 0) return showToast("鍏ュ簱鏁伴噺蹇呴』澶т簬 0");
      upsertStock({ sku, batch, location, status, qty });
    }

    if (operationType === "out") {
      if (qty <= 0) return showToast("鍑哄簱鏁伴噺蹇呴』澶т簬 0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("搴撳瓨涓嶈冻鎴栫姸鎬佷笉鍖归厤");
      row.qty = roundQty(row.qty - qty);
      touchStock(row);
    }

    if (operationType === "move") {
      if (qty <= 0) return showToast("绉诲簱鏁伴噺蹇呴』澶т簬 0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("鍘熷簱浣嶅簱瀛樹笉瓒?);
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
    showToast("浣滀笟宸叉彁浜?);
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
  $("#operationStockHint").textContent = operationType === "move" ? "鎼滅储骞堕€夋嫨瑕佺Щ搴撶殑搴撳瓨銆? : "鎼滅储骞堕€夋嫨瑕佸嚭搴撶殑搴撳瓨銆?;
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
  $("#operationStockList").innerHTML = `<div class="empty-state">搴撳瓨鍔犺浇涓?..</div>`;
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
  $("#qtyInput").placeholder = `鏈€澶?${card.dataset.qty}`;
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
    ? `<strong>宸查€夋嫨搴撳瓨鏄庣粏</strong>
      <span>鐗╂枡锛?{escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>鎵瑰彿锛?{escapeHtml(batch)} / 搴撲綅锛?{escapeHtml(location)} / 鐘舵€侊細${escapeHtml(status)}</span>
      <span>鐜版湁搴撳瓨锛?{row.qty}锛岃鍦ㄤ笅鏂硅緭鍏ユ湰娆℃暟閲忋€?/span>`
    : "";
  updateOperationHelper();
}

function operationEmptyText() {
  const keyword = $("#operationStockSearch")?.value.trim();
  if (!keyword) return "璇峰厛鎵爜鎴栬緭鍏ョ墿鏂欑紪鐮併€佹壒鍙枫€佸簱浣嶏紝鏌ヨ鍙搷浣滃簱瀛樸€?;
  return "鏈壘鍒板彲鎿嶄綔搴撳瓨锛岃纭鐗╂枡缂栫爜銆佹壒鍙锋垨搴撲綅鏄惁姝ｇ‘銆?;
}

function updateOperationHelper() {
  const guide = $("#operationGuide");
  const qtyHint = $("#qtyHint");
  const qtyInput = $("#qtyInput");
  const submitButton = $("#operationSubmitButton");
  if (!guide || !qtyHint || !qtyInput || !submitButton) return;

  const labels = { in: "鍏ュ簱", out: "鍑哄簱", move: "绉诲簱" };
  const steps = {
    in: ["閫夋嫨鐗╂枡", "閫夋嫨搴撲綅", "杈撳叆鏁伴噺", "纭鎻愪氦"],
    out: ["閫夋嫨搴撳瓨鏄庣粏", "杈撳叆鏁伴噺", "纭鎻愪氦"],
    move: ["閫夋嫨搴撳瓨鏄庣粏", "杈撳叆鏁伴噺", "閫夋嫨鐩爣搴撲綅", "纭鎻愪氦"]
  }[operationType] || ["濉啓淇℃伅", "纭鎻愪氦"];

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
    qtyInput.placeholder = "濡?1000 鎴?1000.123456";
    ready = !!findMaterial($("#skuInput").value) && !!findLocation(location) && !!batch && qty !== null && qty > 0;
    nextText = ready ? "鍙厛纭锛屽啀鎻愪氦鍏ュ簱銆? : "璇峰厛閫夋嫨鐗╂枡銆佸簱浣嶏紝鍐嶈緭鍏ユ暟閲忋€?;
  } else {
    if (selectedRow) activeStep = 1;
    if (qty !== null && qty > 0 && selectedRow && qty <= Number(selectedRow.qty || 0)) activeStep = 2;
    if (operationType === "move" && findLocation(targetLocation) && targetLocation !== location) activeStep = 3;
    if (selectedRow) {
      qtyInput.dataset.maxQty = selectedRow.qty;
      qtyInput.placeholder = `鏈€澶?${selectedRow.qty}`;
      if (selectedRow.location !== location) {
        nextText = `宸查€変腑 ${selectedRow.location} 鐨勫簱瀛樻槑缁嗭紝璇风户缁緭鍏ユ暟閲忋€俙;
      } else if (qty !== null && qty > Number(selectedRow.qty || 0)) {
        nextText = "鏁伴噺瓒呰繃鐜版湁搴撳瓨锛岃鏀瑰皬銆?;
      } else if (operationType === "move" && targetLocation && targetLocation === location) {
        nextText = "鐩爣搴撲綅涓嶈兘鍜屽師搴撲綅鐩稿悓銆?;
      } else {
        nextText = `鐜版湁搴撳瓨 ${selectedRow.qty}锛岃缁х画杈撳叆鏁伴噺銆俙;
      }
    } else {
      delete qtyInput.dataset.maxQty;
      qtyInput.placeholder = "鍏堥€夋嫨搴撳瓨鏄庣粏";
      nextText = operationType === "move" ? "璇峰厛閫夋嫨瑕佺Щ搴撶殑搴撳瓨鏄庣粏銆? : "璇峰厛閫夋嫨瑕佸嚭搴撶殑搴撳瓨鏄庣粏銆?;
    }
    ready = !!selectedRow && qty !== null && qty > 0 && qty <= Number(selectedRow.qty || 0);
    if (operationType === "move") {
      const target = findLocation(targetLocation);
      ready = ready && !!target && targetLocation !== location && target.status !== "鍐荤粨";
      if (target?.status === "鍐荤粨") nextText = "鐩爣搴撲綅宸插喕缁擄紝璇锋崲涓€涓簱浣嶃€?;
    }
  }

  guide.innerHTML = steps.map((step, index) => `<span class="step-pill ${index <= activeStep ? "active" : ""}">${index + 1}. ${escapeHtml(step)}</span>`).join("");
  qtyHint.textContent = nextText;
  submitButton.textContent = `${labels[operationType] || "浣滀笟"}鎻愪氦`;
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

  if (!material) return showToast("鐗╂枡蹇呴』浠庝富鏁版嵁鎼滅储閫夋嫨");
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (!status) return showToast("璇烽€夋嫨鐩樼偣鐘舵€?);
  if (!findLocation(location)) return showToast("鐩樼偣搴撲綅蹇呴』浠庝富鏁版嵁鎼滅储閫夋嫨");
  if (!selectedCountStock || selectedCountStock.sku !== sku || selectedCountStock.batch !== batch || selectedCountStock.status !== status) {
    return showToast("璇峰厛閫夋嫨瑕佺洏鐐圭殑搴撳瓨鏄庣粏");
  }
  const targetLocation = findLocation(location);
  if (selectedCountStock.location !== location && targetLocation?.status === "鍐荤粨") return showToast("鐩樼偣搴撲綅宸插喕缁擄紝璇锋崲涓€涓簱浣?);

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
      return showToast("鐩樼偣宸茶皟鏁?);
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
    showToast("鐩樼偣宸茶皟鏁?);
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
  if (!keyword) return "璇峰厛鎵爜鎴栬緭鍏ョ墿鏂欑紪鐮併€佹壒鍙枫€佸簱浣嶏紝鏌ヨ鐩樼偣搴撳瓨銆?;
  return "鏈壘鍒板彲鐩樼偣搴撳瓨锛岃纭鐗╂枡缂栫爜銆佹壒鍙锋垨搴撲綅鏄惁姝ｇ‘銆?;
}

function scheduleCountStockLoad() {
  clearTimeout(countStockTimer);
  countStockTimer = setTimeout(loadCountStockRows, 180);
}

async function loadCountStockRows() {
  const requestId = ++countStockRequestId;
  $("#countStockList").innerHTML = `<div class="empty-state">搴撳瓨鍔犺浇涓?..</div>`;
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
  return `${text} 绛?${total} 涓簱浣峘;
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
    ? `<strong>宸查€夋嫨鐩樼偣鏄庣粏</strong>
      <span>鐗╂枡锛?{escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>鎵瑰彿锛?{escapeHtml(batch)} / 鍘熷簱浣嶏細${escapeHtml(row.location)} / 鐘舵€侊細${escapeHtml(status)}</span>
      <span>璐﹂潰鏁伴噺锛?{row.qty}锛屼笅鏂瑰～鍐欏疄闄呮暟閲忓拰瀹為檯搴撲綅銆?/span>`
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
  if (!selected) text = "鍏堥€夋嫨瑕佺洏鐐圭殑搴撳瓨鏄庣粏銆?;
  else if (qty === null) text = "杈撳叆瀹為檯鏁伴噺锛屽厑璁?0锛屾渶澶?6 浣嶅皬鏁般€?;
  else if (!target) text = "鐩樼偣搴撲綅蹇呴』浠庝富鏁版嵁閫夋嫨銆?;
  else if (selected.location !== location && target.status === "鍐荤粨") {
    ready = false;
    text = "鐩樼偣搴撲綅宸插喕缁擄紝璇锋崲涓€涓簱浣嶃€?;
  } else {
    const locationText = selected.location === location ? "搴撲綅涓嶅彉" : `搴撲綅灏嗕粠 ${selected.location} 璋冩暣鍒?${location}`;
    text = `璐﹂潰 ${selected.qty}锛屽疄闄?${qty}锛?{locationText}銆俙;
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
  $("#statusInput").value = "鍙敤";
  $("#materialNameInput").value = "";
  delete $("#qtyInput").dataset.maxQty;
  updateMaterialPicker();
  updateOperationHelper();
}

function seedDemo() {
  if (serverRequired) return showToast("姝ｅ紡鏈嶅姟涓嶅厑璁歌浇鍏ユ紨绀烘暟鎹?);
  if (!isAdmin()) return showToast("鍙湁绠＄悊鍛樺彲浠ヨ浇鍏ユ紨绀?);
  state.materials = [
    { sku: "RM-1001", name: "鐢樻补" },
    { sku: "PK-2030", name: "澶栫" },
    { sku: "FG-8801", name: "闃叉檼闇滄垚鍝? }
  ];
  state.locations = [
    { code: "A-01-01", status: "鍗犵敤" },
    { code: "A-01-02", status: "绌洪棽" },
    { code: "B-02-01", status: "鍗犵敤" },
    { code: "QC-HOLD", status: "鍐荤粨" }
  ];
  state.stock = [
    { id: uid(), sku: "RM-1001", batch: "B20260501", location: "A-01-01", status: "鍙敤", qty: 120, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "PK-2030", batch: "P260528", location: "B-02-01", status: "鍙敤", qty: 560, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "FG-8801", batch: "F260527", location: "QC-HOLD", status: "寰呮", qty: 48, version: 1, updatedAt: new Date().toISOString() }
  ];
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: 3, location: "", targetLocation: "", status: "", note: "婕旂ず鏁版嵁鍒濆鍖? });
  addAuditLog({ action: "杞藉叆婕旂ず鏁版嵁", entity: "绯荤粺鏁版嵁", key: "DEMO", before: null, after: { materials: state.materials.length, locations: state.locations.length, stock: state.stock.length }, note: "婕旂ず鏁版嵁鍒濆鍖? });
  refreshLocationUsage();
  saveState();
  render();
  showToast("婕旂ず鏁版嵁宸茶浇鍏?);
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
  $("#accountBadge").textContent = loggedIn ? `${currentUser().id} / ${roleLabel(currentUser().role)}` : "鏈櫥褰?;
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
    ["鎿嶄綔", typeLabel(payload.type)],
    ["鐗╂枡", `${payload.sku}${payload.name || findMaterial(payload.sku)?.name ? ` / ${payload.name || findMaterial(payload.sku)?.name || ""}` : ""}`],
    ["鎵瑰彿", payload.batch],
    ["搴撲綅", payload.type === "move" ? `${payload.location} 鈫?${payload.targetLocation || "-"}` : payload.location],
    ["鏁伴噺", payload.qty]
  ];
  $("#operationConfirmText").textContent = "璇锋牳瀵瑰悗鎻愪氦銆?;
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
    .filter((item) => item.status !== "鍐荤粨")
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
  if ($("#holdCount")) $("#holdCount").textContent = state.stock.filter((item) => item.status !== "鍙敤").length;
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
  $("#stockList").innerHTML = `<div class="empty-state">搴撳瓨鍔犺浇涓?..</div>`;
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
                  <span>${escapeHtml(item.name || material?.name || "鏈煡鐗╂枡")}</span>
                  <span>鎵瑰彿锛?{escapeHtml(item.batch)}</span>
                  <span>搴撲綅锛?{escapeHtml(item.location)}</span>
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
              <th class="sortable-th ${stockSortClass("sku")}" data-stock-sort="sku">鐗╂枡缂栫爜</th>
              <th class="sortable-th ${stockSortClass("name")}" data-stock-sort="name">鍚嶇О</th>
              <th class="sortable-th ${stockSortClass("batch")}" data-stock-sort="batch">鎵瑰彿</th>
              <th class="sortable-th ${stockSortClass("location")}" data-stock-sort="location">浣嶇疆</th>
              <th class="sortable-th ${stockSortClass("status")}" data-stock-sort="status">鐘舵€?/th>
              <th class="num-cell sortable-th ${stockSortClass("qty")}" data-stock-sort="qty">鏁伴噺</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => {
              const material = findMaterial(item.sku);
              return `
                <tr>
                  <td>${escapeHtml(item.sku)}</td>
                  <td>${escapeHtml(item.name || material?.name || "鏈煡鐗╂枡")}</td>
                  <td>${escapeHtml(item.batch)}</td>
                  <td>${escapeHtml(item.location)}</td>
                  <td>${escapeHtml(item.status)}</td>
                  <td class="num-cell">${item.qty}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state">褰撳墠娌℃湁搴撳瓨鏁版嵁銆備綘鍙互鍏堜粠搴撳瓨椤垫悳绱㈢墿鏂欍€佹壒鍙锋垨搴撲綅銆?/div>`;
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
    <span>鏄剧ず ${from}-${to} / ${pageState.total}</span>
    <div class="pager-actions">
      <button class="ghost-button" type="button" data-${prefix}-page="prev" ${pageState.page <= 1 ? "disabled" : ""}>涓婁竴椤?/button>
      <span>${pageState.page} / ${pageState.pages}</span>
      <button class="ghost-button" type="button" data-${prefix}-page="next" ${pageState.page >= pageState.pages ? "disabled" : ""}>涓嬩竴椤?/button>
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
  $("#materialList").innerHTML = `<div class="empty-state">鍔犺浇涓?..</div>`;
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
            <button class="secondary-button mini-action" type="button" data-edit-material="${escapeHtml(item.sku)}">淇敼</button>
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
  $("#locationList").innerHTML = `<div class="empty-state">鍔犺浇涓?..</div>`;
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
            <span>${Number(item.stockRows ?? state.stock.filter((stock) => stock.location === item.code).length)} 鏉″簱瀛?/span>
          </div>
          <div class="card-meta">
            <span>${escapeHtml(item.status)}</span>
            <button class="secondary-button mini-action" type="button" data-edit-location="${escapeHtml(item.code)}">淇敼</button>
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

          </div>
          <div class="card-meta">
            <span>${roleLabel(user.role)}</span>
            ${user.id === "admin" ? "" : `<button class="mini-danger" type="button" data-delete-user="${escapeHtml(user.id)}">鍒犻櫎</button>`}
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
  $("#logList").innerHTML = `<div class="empty-state">娴佹按鍔犺浇涓?..</div>`;
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
              <th>鎿嶄綔鏃ユ湡</th>
              <th>璐﹀彿</th>
              <th>绫诲瀷</th>
              <th>鐗╂枡缂栫爜</th>
              <th>鎵瑰彿</th>
              <th>搴撲綅</th>
              <th>鐩爣搴撲綅</th>
              <th>鐘舵€?/th>
              <th class="num-cell">鏁伴噺</th>
              <th>澶囨敞</th>
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
              <th>鎿嶄綔鏃ユ湡</th>
              <th>璐﹀彿</th>
              <th>瀵硅薄</th>
              <th>鎿嶄綔</th>
              <th>涓婚敭</th>
              <th>淇敼鍓?/th>
              <th>淇敼鍚?/th>
              <th>澶囨敞</th>
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
  return { in: "鍏ュ簱", out: "鍑哄簱", move: "绉诲簱", count: "鐩樼偣", adjust: "鐩樼偣璋冩暣", initial: "鏈熷垵" }[type] || type;
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

function setButtonBusy(button, busy, busyText = "澶勭悊涓?) {
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
      button.textContent = "鎻愪氦涓?;
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
      鐗╂枡缂栫爜: item.sku,
      鐗╂枡鍚嶇О: item.name || material?.name || "",
      鎵瑰彿: item.batch,
      鏁伴噺: item.qty,
      搴撲綅: item.location,
      鐘舵€? item.status
    };
  });
  downloadCsv(rows, `搴撳瓨瀵煎嚭-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadTemplate() {
  downloadCsv([{ 鐗╂枡缂栫爜: "RM-1001", 鐗╂枡鍚嶇О: "鐢樻补", 鎵瑰彿: "B20260501", 鏁伴噺: "120", 搴撲綅: "A-01-01", 鐘舵€? "鍙敤" }], "搴撳瓨瀵煎叆妯℃澘.csv");
}

function downloadMaterialTemplate() {
  downloadCsv([{ 鐗╂枡缂栫爜: "RM-1001", 鐗╂枡鍚嶇О: "鐢樻补" }], "鐗╂枡涓绘暟鎹ā鏉?csv");
}

function downloadLocationTemplate() {
  downloadCsv([{ 搴撲綅: "A-01-01", 鐘舵€? "绌洪棽" }], "搴撲綅涓绘暟鎹ā鏉?csv");
}

function downloadCsv(rows, filename) {
  const headers = Object.keys(rows[0] || { 绌? "" });
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
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const rows = await readSelectedRows("#inventoryFile");
  if (!rows.length) return showToast("鏂囦欢娌℃湁鍙鍏ユ暟鎹?);
  const report = validateInventoryRows(rows);
  renderImportReport("鏈熷垵搴撳瓨鏍￠獙鎶ュ憡", report);
  if (!report.validRows) return showToast("娌℃湁鏈夋晥搴撳瓨琛岋紝璇锋鏌ユ枃浠?);
  if (!confirm(importConfirmText("鏈熷垵搴撳瓨", report))) return;
  try {
    const remote = await postMasterData("/api/import-inventory", { rows });
    if (remote) {
      render();
      return showToast("搴撳瓨瀵煎叆宸叉彁浜?);
    }
  } catch (error) {
    return showToast(error.message);
  }
  const groupedRows = new Map();
  let rejected = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["鐗╂枡缂栫爜", "瀛樿揣缂栫爜", "sku", "SKU"]));
    const name = String(pickField(row, ["鐗╂枡鍚嶇О", "瀛樿揣鍚嶇О", "name"]) || "").trim();
    const batch = normalize(pickField(row, ["鎵瑰彿", "batch"]));
    const rawQty = pickField(row, ["鏁伴噺", "鍙敤鏁伴噺", "鐜板瓨閲?, "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["搴撲綅", "搴撲綅缂栫爜", "浠撳簱鍚嶇О", "浠撳簱", "location"]));
    const status = String(pickField(row, ["鐘舵€?, "搴撳瓨鐘舵€?, "status"]) || "鍙敤").trim();
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
    if (!findLocation(item.location)) state.locations.push({ code: item.location, status: "绌洪棽" });
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
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: imported, location: "", targetLocation: "", status: "", note: `瀵煎叆鏈熷垵搴撳瓨 ${imported} 琛岋紝鎷掔粷 ${rejected} 琛宍 });
  addAuditLog({ action: "瀵煎叆鏈熷垵搴撳瓨", entity: "搴撳瓨瀵煎叆", key: "IMPORT", before: null, after: { imported, rejected, sourceRows: rows.length }, note: `瀵煎叆鏈熷垵搴撳瓨 ${imported} 琛岋紝鎷掔粷 ${rejected} 琛宍 });
  saveState();
  render();
  showToast(`宸插鍏?${imported} 琛岋紝鎷掔粷 ${rejected} 琛宍);
}

async function importMaterials() {
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const rows = await readSelectedRows("#materialFile");
  if (!rows.length) return showToast("鏂囦欢娌℃湁鍙鍏ユ暟鎹?);
  const report = validateMaterialRows(rows);
  renderImportReport("鐗╂枡涓绘暟鎹牎楠屾姤鍛?, report);
  if (!report.validRows) return showToast("娌℃湁鏈夋晥鐗╂枡琛岋紝璇锋鏌ユ枃浠?);
  if (!confirm(importConfirmText("鐗╂枡涓绘暟鎹?, report))) return;
  try {
    const remote = await postMasterData("/api/import-materials", { rows });
    if (remote) {
      render();
      return showToast("鐗╂枡涓绘暟鎹鍏ュ凡鎻愪氦");
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["鐗╂枡缂栫爜", "瀛樿揣缂栫爜", "sku", "SKU"]));
    const name = String(pickField(row, ["鐗╂枡鍚嶇О", "瀛樿揣鍚嶇О", "name"]) || "").trim();
    if (!sku || !name) return;
    upsertMaterial({ sku, name });
    imported += 1;
  });
  addAuditLog({ action: "瀵煎叆鐗╂枡涓绘暟鎹?, entity: "鐗╂枡涓绘暟鎹?, key: "IMPORT", before: null, after: { imported }, note: `瀵煎叆鐗╂枡 ${imported} 琛宍 });
  saveState();
  render();
  showToast(`宸插鍏ョ墿鏂?${imported} 琛宍);
}

async function importLocations() {
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const rows = await readSelectedRows("#locationFile");
  if (!rows.length) return showToast("鏂囦欢娌℃湁鍙鍏ユ暟鎹?);
  const report = validateLocationRows(rows);
  renderImportReport("搴撲綅涓绘暟鎹牎楠屾姤鍛?, report);
  if (!report.validRows) return showToast("娌℃湁鏈夋晥搴撲綅琛岋紝璇锋鏌ユ枃浠?);
  if (!confirm(importConfirmText("搴撲綅涓绘暟鎹?, report))) return;
  try {
    const remote = await postMasterData("/api/import-locations", { rows });
    if (remote) {
      render();
      return showToast("搴撲綅涓绘暟鎹鍏ュ凡鎻愪氦");
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const code = normalize(row["搴撲綅"] || row["搴撲綅缂栫爜"] || row.location || row.code);
    const status = String(row["鐘舵€?] || row.status || "绌洪棽").trim();
    if (!code) return;
    const existing = findLocation(code);
    if (existing) existing.status = status;
    else state.locations.push({ code, status });
    imported += 1;
  });
  refreshLocationUsage();
  addAuditLog({ action: "瀵煎叆搴撲綅涓绘暟鎹?, entity: "搴撲綅涓绘暟鎹?, key: "IMPORT", before: null, after: { imported }, note: `瀵煎叆搴撲綅 ${imported} 琛宍 });
  saveState();
  render();
  showToast(`宸插鍏ュ簱浣?${imported} 琛宍);
}

async function downloadBackup() {
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "澶囦唤澶辫触");
    const filename = `wms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("澶囦唤宸蹭笅杞?);
  } catch (error) {
    showToast(error.message);
  }
}

async function downloadAutoBackup() {
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/auto-backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "鑷姩澶囦唤涓嬭浇澶辫触");
    const filename = `wms-auto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("鑷姩澶囦唤宸蹭笅杞?);
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreBackup() {
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  if (!requireLiveServer("鎭㈠澶囦唤")) return;
  const file = $("#restoreFile").files[0];
  if (!file) return showToast("璇烽€夋嫨澶囦唤 JSON 鏂囦欢");
  if (!confirm("鎭㈠澶囦唤浼氳鐩栧綋鍓嶅簱瀛樸€佷富鏁版嵁銆佽处鍙峰拰娴佹按锛岀‘瀹氱户缁悧锛?)) return;
  try {
    const backup = JSON.parse(await readTextFile(file));
    const auth = currentAuthPayload();
    const response = await fetch("/api/restore-backup", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ backup, operatorId: auth.operatorId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "鎭㈠澶辫触");
    const currentUserId = state.currentUserId;
    Object.assign(state, migrateState({ ...defaultState(), ...data }));
    state.currentUserId = currentUserId;
    wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
    $("#restoreFile").value = "";
    render();
    showToast("澶囦唤宸叉仮澶?);
  } catch (error) {
    showToast(error.message || "澶囦唤鏂囦欢鏃犳硶璇诲彇");
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
    const sku = normalize(pickField(row, ["鐗╂枡缂栫爜", "瀛樿揣缂栫爜", "sku", "SKU"]));
    const name = String(pickField(row, ["鐗╂枡鍚嶇О", "瀛樿揣鍚嶇О", "name"]) || "").trim();
    const batch = normalize(pickField(row, ["鎵瑰彿", "batch"]));
    const rawQty = pickField(row, ["鏁伴噺", "鍙敤鏁伴噺", "鐜板瓨閲?, "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["搴撲綅", "搴撲綅缂栫爜", "浠撳簱鍚嶇О", "浠撳簱", "location"]));
    const status = String(pickField(row, ["鐘舵€?, "搴撳瓨鐘舵€?, "status"]) || "鍙敤").trim();
    const reasons = [];
    if (!sku) reasons.push("缂哄皯鐗╂枡缂栫爜");
    if (!name) reasons.push("缂哄皯鐗╂枡鍚嶇О");
    if (!batch) reasons.push("缂哄皯鎵瑰彿");
    if (!location) reasons.push("缂哄皯搴撲綅");
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
    const sku = normalize(pickField(row, ["鐗╂枡缂栫爜", "瀛樿揣缂栫爜", "sku", "SKU"]));
    const name = String(pickField(row, ["鐗╂枡鍚嶇О", "瀛樿揣鍚嶇О", "name"]) || "").trim();
    const reasons = [];
    if (!sku) reasons.push("缂哄皯鐗╂枡缂栫爜");
    if (!name) reasons.push("缂哄皯鐗╂枡鍚嶇О");
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
    const code = normalize(pickField(row, ["搴撲綅", "搴撲綅缂栫爜", "浠撳簱鍚嶇О", "浠撳簱", "location", "code"]));
    if (!code) return addInvalid(report, index, ["缂哄皯搴撲綅缂栫爜"]);
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
  if (report.invalidSamples.length < 8) report.invalidSamples.push(`绗?${index + 2} 琛岋細${reasons.join("锛?)}`);
}

function renderImportReport(title, report) {
  const target = $("#importReport");
  if (!target) return;
  target.classList.remove("hidden");
  const invalid = report.invalidSamples.length ? `<br>${report.invalidSamples.map(escapeHtml).join("<br>")}` : "";
  target.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    鍘熷 ${report.sourceRows} 琛岋紱鏈夋晥 ${report.validRows} 琛岋紱鏃犳晥 ${report.invalidRows} 琛岋紱閲嶅鍚堝苟 ${report.duplicateRows} 琛岋紱鏈€缁堝鍏?${report.mergedRows} 琛屻€?
    ${report.totalQty ? `<br>鏈夋晥鏁伴噺鍚堣锛?{report.totalQty}` : ""}
    ${invalid}`;
}

function importConfirmText(title, report) {
  return `${title}瀵煎叆鏍￠獙锛歕n鍘熷 ${report.sourceRows} 琛孿n鏈夋晥 ${report.validRows} 琛孿n鏃犳晥 ${report.invalidRows} 琛孿n閲嶅鍚堝苟 ${report.duplicateRows} 琛孿n鏈€缁堝鍏?${report.mergedRows} 琛孿n\n鏄惁缁х画瀵煎叆鏈夋晥鏁版嵁锛焋;
}

async function readSelectedRows(selector) {
  const file = $(selector).files[0];
  if (!file) {
    showToast("璇烽€夋嫨 Excel 鎴?CSV 鏂囦欢");
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
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const sku = normalize($("#newSku").value);
  const name = $("#newName").value.trim();
  const previousSku = editingMaterialSku;
  if (!sku || !name) return showToast("鐗╂枡缂栫爜鍜屽悕绉颁笉鑳戒负绌?);
  if (!previousSku && state.materials.some((item) => item.sku === sku)) return showToast("鐗╂枡缂栫爜宸插瓨鍦紝璇锋悳绱㈠悗鐐逛慨鏀?);
  if (previousSku && previousSku !== sku && state.materials.some((item) => item.sku === sku)) return showToast("鐗╂枡缂栫爜宸插瓨鍦?);
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
      addAuditLog({ action: existing ? (previousSku && previousSku !== sku ? "淇敼鐗╂枡缂栫爜" : "淇敼鐗╂枡") : "鏂板鐗╂枡", entity: "鐗╂枡涓绘暟鎹?, key: sku, before, after: { sku, name } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheMaterials([{ sku, name }]);
  materialPage.page = 1;
  resetMaterialEdit();
  render();
  showToast("鐗╂枡涓绘暟鎹凡淇濆瓨");
}

async function addLocation(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const code = normalize($("#newLocation").value);
  const previousCode = editingLocationCode;
  const status = $("#newLocationStatus").value;
  if (!code) return showToast("搴撲綅缂栫爜涓嶈兘涓虹┖");
  if (!previousCode && state.locations.some((item) => item.code === code)) return showToast("搴撲綅宸插瓨鍦紝璇锋悳绱㈠悗鐐逛慨鏀?);
  if (previousCode && previousCode !== code && state.locations.some((item) => item.code === code)) return showToast("搴撲綅缂栫爜宸插瓨鍦?);
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
      addAuditLog({ action: existing ? (previousCode && previousCode !== code ? "淇敼搴撲綅缂栫爜" : "淇敼搴撲綅") : "鏂板搴撲綅", entity: "搴撲綅涓绘暟鎹?, key: code, before, after: findLocation(code) || { code, status } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheLocations([{ code, status }]);
  locationPage.page = 1;
  resetLocationEdit();
  render();
  showToast("搴撲綅涓绘暟鎹凡淇濆瓨");
}

function editMaterial(sku) {
  const material = findMaterial(sku);
  if (!material) return;
  editingMaterialSku = material.sku;
  $("#newSku").value = material.sku;
  $("#newName").value = material.name;
  $("#materialSaveButton").textContent = "淇濆瓨淇敼";
  $("#cancelMaterialEdit").classList.remove("hidden");
  $("#newName").focus();
}

function resetMaterialEdit() {
  editingMaterialSku = "";
  $("#materialForm").reset();
  $("#materialSaveButton").textContent = "淇濆瓨";
  $("#cancelMaterialEdit").classList.add("hidden");
}

function editLocation(code) {
  const location = findLocation(code);
  if (!location) return;
  editingLocationCode = location.code;
  $("#newLocation").value = location.code;
  $("#newLocationStatus").value = location.status || "绌洪棽";
  $("#locationSaveButton").textContent = "淇濆瓨淇敼";
  $("#cancelLocationEdit").classList.remove("hidden");
  $("#newLocation").focus();
}

function resetLocationEdit() {
  editingLocationCode = "";
  $("#locationForm").reset();
  $("#locationSaveButton").textContent = "淇濆瓨";
  $("#cancelLocationEdit").classList.add("hidden");
}

async function addUser(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  const id = normalize($("#newUserId").value);
  const existing = state.users.find((user) => user.id === id);
  const password = $("#newUserPassword").value.trim();
  const user = { id, name: id, role: $("#newUserRole").value };
  if (!existing && !password) return showToast("鏂板璐﹀彿蹇呴』璁剧疆瀵嗙爜");
  try {
    const remote = await postUserData("/api/users", { id, role: user.role, userPassword: password });
    if (!remote) {
      const before = existing ? { id: existing.id, role: existing.role } : null;
      if (existing) Object.assign(existing, user);
      else state.users.push(user);
      const afterUser = state.users.find((item) => item.id === id);
      addAuditLog({ action: existing ? "淇敼璐﹀彿" : "鏂板璐﹀彿", entity: "璐﹀彿鏉冮檺", key: id, before, after: { id: afterUser.id, role: afterUser.role } });
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
  setButtonBusy(button, true, "鐧诲綍涓?);
  try {
    debugLogin("sending /api/login");
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WMS-Lite-Lite": "1" },
      body: JSON.stringify({ userId, password })
    });
    const data = await response.json();
    debugLogin(`/api/login status ${response.status}`);
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
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
      showToast("绠＄悊鍛樹粛鍦ㄤ娇鐢ㄩ粯璁ゅ瘑鐮侊紝璇峰厛淇敼瀵嗙爜");
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
  if (!isAdmin()) return showToast("娌℃湁鏉冮檺");
  if (userId === "admin") return showToast("涓嶈兘鍒犻櫎绠＄悊鍛樿处鍙?);
  if (!confirm(`纭畾鍒犻櫎璐﹀彿 ${userId}锛焋)) return;
  try {
    const remote = await postUserData("/api/users/delete", { targetId: userId });
    if (!remote) {
      const before = state.users.find((user) => user.id === userId);
      state.users = state.users.filter((user) => user.id !== userId);
      if (state.currentUserId === userId) state.currentUserId = "";
      if (before) addAuditLog({ action: "鍒犻櫎璐﹀彿", entity: "璐﹀彿鏉冮檺", key: userId, before: { id: before.id, name: before.name, role: before.role }, after: null });
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
    if (!isAdmin() && !["operate", "count", "stock"].includes(button.dataset.view)) return showToast("娌℃湁鏉冮檺");
    if (!canOpenView(button.dataset.view)) return showToast("娌℃湁鏉冮檺");
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
  if (qty !== null && maxQty && qty > maxQty) showToast("鏈鏁伴噺涓嶈兘瓒呰繃鐜版湁搴撳瓨");
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
$("#importInventory").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "瀵煎叆涓?, importInventory));
$("#importMaterials").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "瀵煎叆涓?, importMaterials));
$("#importLocations").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "瀵煎叆涓?, importLocations));
$("#downloadBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "澶囦唤涓?, downloadBackup));
$("#downloadAutoBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "涓嬭浇涓?, downloadAutoBackup));
$("#restoreBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "鎭㈠涓?, restoreBackup));
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
  setSyncStatus("鏀跺埌鏇存柊");
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
    setSyncStatus("鏀跺埌鏇存柊");
    render();
  });
}

setupInstallPrompt();
registerServiceWorker();
render();
initApiSync();



