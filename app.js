const storeKey = "wms-lite-state-v4";
const authKey = "wms-lite-auth-v2";
const channel = "BroadcastChannel" in window ? new BroadcastChannel("wms-lite-sync") : null;
const serverRequired = location.protocol !== "file:";
const materialCache = new Map();
const locationCache = new Map();

const state = loadState();
const frontendBuildVersion = "2026-06-02-1";
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

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function defaultState() {
  return {
    materials: [],
    locations: [],
    stock: [],
    logs: [],
    auditLogs: [],
    users: [
      { id: "admin", name: "缁狅紕鎮婇崨?, role: "admin" },
      { id: "WH-001", name: "娴犳挸绨遍崨妯轰紣", role: "employee" },
      { id: "WH-MGR", name: "娴犳挾顓?, role: "keeper" }
    ],
    currentUserId: ""
  };
}

function loadState() {
  const saved = localStorage.getItem(storeKey);
  const loaded = saved ? { ...defaultState(), ...JSON.parse(saved) } : defaultState();
  return migrateState(loaded);
}

function loadSessionAuth() {
  try {
    return JSON.parse(sessionStorage.getItem(authKey) || "{}");
  } catch {
    return {};
  }
}

function saveSessionAuth(userId, token, expiresAt = "", mustChangePassword = false) {
  sessionAuth = { userId, token, expiresAt, mustChangePassword: !!mustChangePassword };
  sessionStorage.setItem(authKey, JSON.stringify(sessionAuth));
}

function clearSessionAuth() {
  sessionAuth = {};
  sessionStorage.removeItem(authKey);
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
    showToast("濮濓絽绱￠張宥呭娑撳秷鍏橀崷銊﹀閺堣櫣顏柌宥囩枂缁狅紕鎮婇崨妯虹槕閻緤绱濈拠宄版躬鐠愶箑褰块弶鍐闁插奔鎱ㄩ弨鐟扮槕閻?);
    return;
  }
  let admin = state.users.find((user) => String(user.id).toLowerCase() === "admin");
  if (!admin) {
    admin = { id: "admin", name: "缁狅紕鎮婇崨?, role: "admin" };
    state.users.unshift(admin);
  }
  admin.id = "admin";
  admin.name = admin.name || "缁狅紕鎮婇崨?;
  admin.role = "admin";
  delete admin.password;
  delete admin.passwordHash;
  saveState();
  render();
  showToast("缁狅紕鎮婇崨妯虹槕閻礁鍑￠柌宥囩枂娑?admin123");
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
  return { employee: "閸涙ê浼?, keeper: "娴犳挾顓?, admin: "缁狅紕鎮婇崨?, operator: "閸涙ê浼? }[role] || role;
}

function saveState(sync = true) {
  localStorage.setItem(storeKey, JSON.stringify(state));
  if (sync && channel) channel.postMessage({ type: "state-updated", state });
  setSyncStatus(syncStatusText());
}

async function initApiSync() {
  apiSyncAttempted = false;
  apiConnectionState = "connecting";
  try {
    const healthResponse = await fetch("/api/health", { headers: { Accept: "application/json" } });
    const healthData = await healthResponse.json().catch(() => null);
    if (!healthResponse.ok || !healthData?.ok) throw new Error("API unavailable");

    const liteResponse = await fetch("/api/state?lite=1", { headers: { Accept: "application/json" } });
    if (!liteResponse.ok) throw new Error("API unavailable");
    const liteState = await liteResponse.json();
    Object.assign(state, migrateState({ ...defaultState(), ...liteState }));
    state.currentUserId = "";
    apiAvailable = true;
    apiSyncAttempted = true;
    apiConnectionState = "connected";
    localStorage.setItem(storeKey, JSON.stringify(state));
    setSyncStatus(syncStatusText());
    render();

    fetch("/api/state", { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((fullState) => {
        if (!fullState) return;
        const currentUserId = state.currentUserId;
        Object.assign(state, migrateState({ ...defaultState(), ...fullState }));
        state.currentUserId = currentUserId;
        localStorage.setItem(storeKey, JSON.stringify(state));
        render();
      })
      .catch(() => {});
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
    setSyncStatus("閺堝秴濮熼崳銊ユ倱濮?);
  } catch {
    apiAvailable = false;
    setSyncStatus("閺堫剚婧€濠曟梻銇?);
  }
}

function setSyncStatus(text) {
  $("#syncStatus").textContent = text;
  renderRuntimeState();
}

function syncStatusText() {
  if (apiConnectionState === "connecting") return "杩炴帴涓?;
  if (apiConnectionState === "connected") return "鏈嶅姟鍣ㄥ凡杩炴帴";
  if (apiConnectionState === "failed") return serverRequired ? "鏈嶅姟鍣ㄨ繛鎺ュけ璐? : "鏈満婕旂ず";
  return "杩炴帴涓?;
}

function requireLiveServer(action = "閹垮秳缍?) {
  if (!serverRequired || apiAvailable) return true;
  showToast(`閺堝秴濮熼崳銊︽弓鏉╃偞甯撮敍?{action}閺嗗倷绗夐懗鑺ュ⒔鐞涘畭);
  return false;
}

function renderRuntimeState() {
  const blocked = serverRequired && apiSyncAttempted && !apiAvailable;
  const pending = serverRequired && !apiSyncAttempted;
  $("#connectionBanner")?.classList.toggle("hidden", !blocked);
  $$(".server-write").forEach((button) => {
    button.disabled = pending || blocked || button.dataset.logicDisabled === "1";
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
  if (text.includes(",")) return "閺佷即鍣烘稉宥堝厴娴ｈ法鏁ら柅妤€褰块敍宀冾嚞娑撳秷顩︽潏鎾冲弳閸楁澘鍑圭亸蹇旀殶閺嶇厧绱￠敍灞肩伐婵?1.000,5";
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return "閺佷即鍣烘稉宥堝厴娴ｈ法鏁ら崡鏉垮嚬閸楀啫鍨庢担宥嗙壐瀵骏绱濇笟瀣洤 1.000";
  return "閺佷即鍣洪崣顏囧厴鏉堟挸鍙嗛弲顕€鈧碍鏆熺€涙绱濋張鈧径?6 娴ｅ秴鐨弫甯礉娓氬顩?1000 閹?1000.123456";
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
    if (serverRequired) throw new Error("閺堝秴濮熼崳銊︽弓鏉╃偞甯撮敍宀冾嚞閹垹顦茬純鎴犵捕閸氬酣鍣哥拠?);
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch("/api/operations", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  localStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postMasterData(path, payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("閺堝秴濮熼崳銊︽弓鏉╃偞甯撮敍宀冾嚞閹垹顦茬純鎴犵捕閸氬酣鍣哥拠?);
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
  const currentUserId = state.currentUserId;
  if (data.materials || data.locations || data.stock) {
    Object.assign(state, migrateState({ ...defaultState(), ...data }));
    state.currentUserId = currentUserId;
  } else if (path.endsWith("/materials")) {
    state.materials = data;
  } else if (path.endsWith("/locations")) {
    state.locations = data;
  }
  localStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postUserData(path, payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("閺堝秴濮熼崳銊︽弓鏉╃偞甯撮敍宀冾嚞閹垹顦茬純鎴犵捕閸氬酣鍣哥拠?);
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  localStorage.setItem(storeKey, JSON.stringify(state));
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
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
  return data;
}

function removeZeroStock() {
  state.stock = state.stock.filter((item) => item.qty > 0);
}

function refreshLocationUsage() {
  state.locations.forEach((location) => {
    if (location.status !== "閸愯崵绮?) {
      location.status = state.stock.some((item) => item.location === location.code) ? "閸楃姷鏁? : "缁屾椽妫?;
    }
  });
}

function addLog(payload) {
  const user = currentUser();
  state.logs.unshift({
    id: uid(),
    operatorId: user?.id || "",
    operatorName: user?.name || "",
    operator: user ? `${user.id} ${user.name}` : "閺堫亪鈧瀚?,
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

async function submitOperation(event) {
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

  if (!material) return showToast("閻椻晜鏋¤箛鍛淬€忔禒搴濆瘜閺佺増宓侀幖婊呭偍闁瀚?);
  if (!findLocation(location)) return showToast("鎼存挷缍呰箛鍛淬€忔禒搴濆瘜閺佺増宓侀幖婊呭偍闁瀚?);
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (qty <= 0) return showToast(operationType === "in" ? "閸忋儱绨遍弫浼村櫤韫囧懘銆忔径褌绨?0" : "閺堫剚顐奸弫浼村櫤韫囧懘銆忔径褌绨?0");
  const selectedRow = selectedOperationSourceMatches(sku, batch, status) ? selectedOperationStock : null;
  if (["out", "move"].includes(operationType)) {
    if (!selectedRow) return showToast("鐠囧嘲鍘涢柅澶嬪鐟曚焦鎼锋担婊呮畱鎼存挸鐡ㄩ弰搴ｇ矎");
    if (qty > Number(selectedRow.qty || 0)) return showToast("閺堫剚顐奸弫浼村櫤娑撳秷鍏樼搾鍛扮箖閻滅増婀佹惔鎾崇摠");
  }
  if (operationType === "move") {
    if (!targetLocation || !findLocation(targetLocation)) return showToast("鐠囩兘鈧瀚ㄩ張澶嬫櫏閻╊喗鐖ｆ惔鎾茬秴");
    if (findLocation(targetLocation)?.status === "閸愯崵绮?) return showToast("閻╊喗鐖ｆ惔鎾茬秴瀹告彃鍠曠紒?);
    if (targetLocation === (selectedRow?.location || location)) return showToast("閻╊喗鐖ｆ惔鎾茬秴娑撳秷鍏橀崪灞藉斧鎼存挷缍呴惄绋挎倱");
  }

  setFormSubmitting(event.target, true);
  try {
    const sourceLocation = selectedRow?.location || location;
    const operationPayload = { type: operationType, sku, batch, qty: rawQty, location: sourceLocation, targetLocation, status, note, expectedVersion: selectedOperationVersion };
    try {
      const remote = await postOperation(operationPayload);
      if (remote) {
        resetOperationForm(event.target);
        selectedOperationVersion = null;
        selectedOperationStock = null;
        render();
        return showToast("娴ｆ粈绗熷鍙夊絹娴?);
      }
    } catch (error) {
      return showToast(error.message);
    }

    if (operationType === "in") {
      if (qty <= 0) return showToast("閸忋儱绨遍弫浼村櫤韫囧懘銆忔径褌绨?0");
      upsertStock({ sku, batch, location, status, qty });
    }

    if (operationType === "out") {
      if (qty <= 0) return showToast("閸戝搫绨遍弫浼村櫤韫囧懘銆忔径褌绨?0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("鎼存挸鐡ㄦ稉宥堝喕閹存牜濮搁幀浣风瑝閸栧綊鍘?);
      row.qty = roundQty(row.qty - qty);
      touchStock(row);
    }

    if (operationType === "move") {
      if (qty <= 0) return showToast("缁夎绨遍弫浼村櫤韫囧懘銆忔径褌绨?0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("閸樼喎绨辨担宥呯氨鐎涙ü绗夌搾?);
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
    showToast("娴ｆ粈绗熷鍙夊絹娴?);
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
  $("#operationStockHint").textContent = operationType === "move" ? "閹兼粎鍌ㄩ獮鍫曗偓澶嬪鐟曚胶些鎼存挾娈戞惔鎾崇摠閵? : "閹兼粎鍌ㄩ獮鍫曗偓澶嬪鐟曚礁鍤惔鎾舵畱鎼存挸鐡ㄩ妴?;
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
  $("#operationStockList").innerHTML = `<div class="empty-state">鎼存挸鐡ㄩ崝鐘烘祰娑?..</div>`;
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
    : emptyHtml();
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
  $("#qtyInput").placeholder = `閺堚偓婢?${card.dataset.qty}`;
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
    ? `<strong>瀹告煡鈧瀚ㄦ惔鎾崇摠閺勫海绮?/strong>
      <span>閻椻晜鏋￠敍?{escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>閹电懓褰块敍?{escapeHtml(batch)} / 鎼存挷缍呴敍?{escapeHtml(location)} / 閻樿埖鈧緤绱?{escapeHtml(status)}</span>
      <span>閻滅増婀佹惔鎾崇摠閿?{row.qty}閿涘矁顕崷銊ょ瑓閺傜绶崗銉︽拱濞嗏剝鏆熼柌蹇嬧偓?/span>`
    : "";
  updateOperationHelper();
}

function updateOperationHelper() {
  const guide = $("#operationGuide");
  const qtyHint = $("#qtyHint");
  const qtyInput = $("#qtyInput");
  const submitButton = $("#operationSubmitButton");
  if (!guide || !qtyHint || !qtyInput || !submitButton) return;

  const labels = { in: "閸忋儱绨?, out: "閸戝搫绨?, move: "缁夎绨? };
  const steps = {
    in: ["闁瀚ㄩ悧鈺傛灐", "闁瀚ㄦ惔鎾茬秴", "鏉堟挸鍙嗛弫浼村櫤", "閹绘劒姘?],
    out: ["闁瀚ㄦ惔鎾崇摠", "鏉堟挸鍙嗛弫浼村櫤", "閹绘劒姘?],
    move: ["闁瀚ㄦ惔鎾崇摠", "鏉堟挸鍙嗛弫浼村櫤", "闁瀚ㄩ惄顔界垼鎼存挷缍?, "閹绘劒姘?]
  }[operationType] || ["婵夘偄鍟撴穱鈩冧紖", "閹绘劒姘?];

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
    qtyInput.placeholder = "婵?1000 閹?1000.123456";
    ready = !!findMaterial($("#skuInput").value) && !!findLocation(location) && !!batch && qty !== null && qty > 0;
    nextText = ready ? "閸欘垯浜掗幓鎰唉閸忋儱绨遍妴? : "閹稿銆庢惔蹇涒偓澶嬪閻椻晜鏋￠妴浣哥氨娴ｅ稄绱濋崘宥堢翻閸忋儲婀板▎鈩冩殶闁插繈鈧?;
  } else {
    if (selectedRow) activeStep = 1;
    if (qty !== null && qty > 0 && selectedRow && qty <= Number(selectedRow.qty || 0)) activeStep = 2;
    if (operationType === "move" && findLocation(targetLocation) && targetLocation !== location) activeStep = 3;
    if (selectedRow) {
      qtyInput.dataset.maxQty = selectedRow.qty;
      qtyInput.placeholder = `閺堚偓婢?${selectedRow.qty}`;
      if (selectedRow.location !== location) {
        nextText = `瀹告煡鈧鑵?${selectedRow.location} 閻ㄥ嫬绨辩€涙ɑ妲戠紒鍡礉瑜版挸澧犳惔鎾茬秴濡楀棝鍣烽弰鍓с仛閻ㄥ嫭妲?${location || "缁?}閿涘矁顕禒銉┾偓澶夎厬閺勫海绮忔稉鍝勫櫙閹存牠鍣搁弬浼粹偓澶嬪閵嗕繖;
      } else if (qty !== null && qty > Number(selectedRow.qty || 0)) {
        nextText = "閺佷即鍣虹搾鍛扮箖閻滅増婀佹惔鎾崇摠閿涘矁顕弨鐟扮毈閵?;
      } else if (operationType === "move" && targetLocation && targetLocation === location) {
        nextText = "閻╊喗鐖ｆ惔鎾茬秴娑撳秷鍏橀崪灞藉斧鎼存挷缍呴惄绋挎倱閵?;
      } else {
        nextText = `閻滅増婀佹惔鎾崇摠 ${selectedRow.qty}閿涘矁顕潏鎾冲弳閺堫剚顐奸弫浼村櫤閵嗕繖;
      }
    } else {
      delete qtyInput.dataset.maxQty;
      qtyInput.placeholder = "閸忓牓鈧瀚ㄦ惔鎾崇摠閺勫海绮?;
      nextText = operationType === "move" ? "閸忓牓鈧瀚ㄧ憰浣盒╂惔鎾舵畱鎼存挸鐡ㄩ妴? : "閸忓牓鈧瀚ㄧ憰浣稿毉鎼存挾娈戞惔鎾崇摠閵?;
    }
    ready = !!selectedRow && qty !== null && qty > 0 && qty <= Number(selectedRow.qty || 0);
    if (operationType === "move") {
      const target = findLocation(targetLocation);
      ready = ready && !!target && targetLocation !== location && target.status !== "閸愯崵绮?;
      if (target?.status === "閸愯崵绮?) nextText = "閻╊喗鐖ｆ惔鎾茬秴瀹告彃鍠曠紒鎿勭礉鐠囬攱宕叉稉鈧稉顏勭氨娴ｅ秲鈧?;
    }
  }

  guide.innerHTML = steps.map((step, index) => `<span class="step-pill ${index <= activeStep ? "active" : ""}">${index + 1}. ${escapeHtml(step)}</span>`).join("");
  qtyHint.textContent = nextText;
  submitButton.textContent = `${labels[operationType] || "娴ｆ粈绗?}閹绘劒姘;
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

  if (!material) return showToast("閻椻晜鏋¤箛鍛淬€忔禒搴濆瘜閺佺増宓侀幖婊呭偍闁瀚?);
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (!status) return showToast("鐠囩兘鈧瀚ㄩ惄妯煎仯閻樿埖鈧?);
  if (!findLocation(location)) return showToast("閻╂鍋ｆ惔鎾茬秴韫囧懘銆忔禒搴濆瘜閺佺増宓侀幖婊呭偍闁瀚?);
  if (!selectedCountStock || selectedCountStock.sku !== sku || selectedCountStock.batch !== batch || selectedCountStock.status !== status) {
    return showToast("鐠囧嘲鍘涢柅澶嬪鐟曚胶娲忛悙鍦畱鎼存挸鐡ㄩ弰搴ｇ矎");
  }
  const targetLocation = findLocation(location);
  if (selectedCountStock.location !== location && targetLocation?.status === "閸愯崵绮?) return showToast("閻╂鍋ｆ惔鎾茬秴瀹告彃鍠曠紒鎿勭礉鐠囬攱宕叉稉鈧稉顏勭氨娴?);

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
      return showToast("閻╂鍋ｅ鑼剁殶閺?);
    }
  } catch (error) {
    return showToast(error.message);
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
  showToast("閻╂鍋ｅ鑼剁殶閺?);
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

function scheduleCountStockLoad() {
  clearTimeout(countStockTimer);
  countStockTimer = setTimeout(loadCountStockRows, 180);
}

async function loadCountStockRows() {
  const requestId = ++countStockRequestId;
  $("#countStockList").innerHTML = `<div class="empty-state">鎼存挸鐡ㄩ崝鐘烘祰娑?..</div>`;
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
  return `${text} 缁?${total} 娑擃亜绨辨担宄?
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
    : emptyHtml();
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
    ? `<strong>瀹告煡鈧瀚ㄩ惄妯煎仯閺勫海绮?/strong>
      <span>閻椻晜鏋￠敍?{escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>閹电懓褰块敍?{escapeHtml(batch)} / 閸樼喎绨辨担宥忕窗${escapeHtml(row.location)} / 閻樿埖鈧緤绱?{escapeHtml(status)}</span>
      <span>鐠愶箓娼伴弫浼村櫤閿?{row.qty}閿涘奔绗呴弬鐟帮綖閸愭瑥鐤勯梽鍛殶闁插繐鎷扮€圭偤妾惔鎾茬秴閵?/span>`
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
  if (!selected) text = "閸忓牓鈧瀚ㄧ憰浣烘磸閻愬湱娈戞惔鎾崇摠閺勫海绮忛妴?;
  else if (qty === null) text = "鏉堟挸鍙嗙€圭偤妾弫浼村櫤閿涘苯鍘戠拋?0閿涘本娓舵径?6 娴ｅ秴鐨弫鑸偓?;
  else if (!target) text = "閻╂鍋ｆ惔鎾茬秴韫囧懘銆忔禒搴濆瘜閺佺増宓侀柅澶嬪閵?;
  else if (selected.location !== location && target.status === "閸愯崵绮?) {
    ready = false;
    text = "閻╂鍋ｆ惔鎾茬秴瀹告彃鍠曠紒鎿勭礉鐠囬攱宕叉稉鈧稉顏勭氨娴ｅ秲鈧?;
  } else {
    const locationText = selected.location === location ? "鎼存挷缍呮稉宥呭綁" : `鎼存挷缍呯亸鍡曠矤 ${selected.location} 鐠嬪啯鏆ｉ崚?${location}`;
    text = `鐠愶箓娼?${selected.qty}閿涘苯鐤勯梽?${qty}閿?{locationText}閵嗕繖;
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
  $("#statusInput").value = "閸欘垳鏁?;
  $("#materialNameInput").value = "";
  delete $("#qtyInput").dataset.maxQty;
  updateMaterialPicker();
  updateOperationHelper();
}

function seedDemo() {
  if (serverRequired) return showToast("濮濓絽绱￠張宥呭娑撳秴鍘戠拋姝屾祰閸忋儲绱ㄧ粈鐑樻殶閹?);
  if (!isAdmin()) return showToast("閸欘亝婀佺粻锛勬倞閸涙ê褰叉禒銉ㄦ祰閸忋儲绱ㄧ粈?);
  state.materials = [
    { sku: "RM-1001", name: "閻㈡ɑ琛? },
    { sku: "PK-2030", name: "婢舵牜顔? },
    { sku: "FG-8801", name: "闂冨弶妾奸棁婊勫灇閸? }
  ];
  state.locations = [
    { code: "A-01-01", status: "閸楃姷鏁? },
    { code: "A-01-02", status: "缁屾椽妫? },
    { code: "B-02-01", status: "閸楃姷鏁? },
    { code: "QC-HOLD", status: "閸愯崵绮? }
  ];
  state.stock = [
    { id: uid(), sku: "RM-1001", batch: "B20260501", location: "A-01-01", status: "閸欘垳鏁?, qty: 120, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "PK-2030", batch: "P260528", location: "B-02-01", status: "閸欘垳鏁?, qty: 560, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "FG-8801", batch: "F260527", location: "QC-HOLD", status: "瀵板懏顥?, qty: 48, version: 1, updatedAt: new Date().toISOString() }
  ];
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: 3, location: "", targetLocation: "", status: "", note: "濠曟梻銇氶弫鐗堝祦閸掓繂顫愰崠? });
  addAuditLog({ action: "鏉炶棄鍙嗗鏃傘仛閺佺増宓?, entity: "缁崵绮洪弫鐗堝祦", key: "DEMO", before: null, after: { materials: state.materials.length, locations: state.locations.length, stock: state.stock.length }, note: "濠曟梻銇氶弫鐗堝祦閸掓繂顫愰崠? });
  refreshLocationUsage();
  saveState();
  render();
  showToast("濠曟梻銇氶弫鐗堝祦瀹歌尪娴囬崗?);
}

function renderPermissions() {
  const loggedIn = !!currentUser();
  const admin = isAdmin();
  const keeper = isKeeper();
  const passwordWarning = admin && sessionAuth.userId === currentUser()?.id && sessionAuth.mustChangePassword;
  $("#loginPanel").classList.toggle("hidden", loggedIn);
  $("#logoutButton").classList.toggle("hidden", !loggedIn);
  $(".tabbar").classList.toggle("hidden", !loggedIn);
  $("#passwordWarning")?.classList.toggle("hidden", !passwordWarning);
  $$(".view").forEach((item) => item.classList.toggle("hidden", !loggedIn));
  $("#accountBadge").textContent = loggedIn ? `${currentUser().id} / ${roleLabel(currentUser().role)}` : "\u672a\u767b\u5f55";
  if (!loggedIn) return;
  $$(".admin-only, .admin-view").forEach((item) => item.classList.toggle("hidden", !admin));
  $$(".keeper-only").forEach((item) => item.classList.toggle("hidden", !keeper));
  $$(".admin-option").forEach((item) => item.hidden = !admin);
  if (!admin && operationType === "move") {
    operationType = "in";
    $("#operationTypeInput").value = "in";
  }
  const activeView = $(".view.active");
  if (!activeView || activeView.classList.contains("hidden") || !canOpenView(activeView.id)) {
    activateView("operate");
  }
}

function renderUserSelect() {
  // Login uses typed account/password. This render hook is kept for the wider render flow.
}
  // Login uses typed account/password. This render hook is kept for the wider render flow.
}
  if (!activeView || activeView.classList.contains("hidden") || !canOpenView(activeView.id)) {
    activateView("operate");
  }
}

function renderUserSelect() {
  // Login uses typed account/password. This render hook is kept for the wider render flow.
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
    .filter((item) => item.status !== "閸愯崵绮?)
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
  if ($("#holdCount")) $("#holdCount").textContent = state.stock.filter((item) => item.status !== "閸欘垳鏁?).length;
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
  $("#stockList").innerHTML = `<div class="empty-state">鎼存挸鐡ㄩ崝鐘烘祰娑?..</div>`;
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
  $("#stockList").innerHTML = rows.length
    ? `
      <div class="table-wrap">
        <table class="data-table stock-table">
          <thead>
            <tr>
              <th class="sortable-th ${stockSortClass("sku")}" data-stock-sort="sku">閻椻晜鏋＄紓鏍垳</th>
              <th class="sortable-th ${stockSortClass("name")}" data-stock-sort="name">閸氬秶袨</th>
              <th class="sortable-th ${stockSortClass("batch")}" data-stock-sort="batch">閹电懓褰?/th>
              <th class="sortable-th ${stockSortClass("location")}" data-stock-sort="location">娴ｅ秶鐤?/th>
              <th class="sortable-th ${stockSortClass("status")}" data-stock-sort="status">閻樿埖鈧?/th>
              <th class="num-cell sortable-th ${stockSortClass("qty")}" data-stock-sort="qty">閺佷即鍣?/th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => {
              const material = findMaterial(item.sku);
              return `
                <tr>
                  <td>${escapeHtml(item.sku)}</td>
                  <td>${escapeHtml(item.name || material?.name || "閺堫亞鐓￠悧鈺傛灐")}</td>
                  <td>${escapeHtml(item.batch)}</td>
                  <td>${escapeHtml(item.location)}</td>
                  <td>${escapeHtml(item.status)}</td>
                  <td class="num-cell">${item.qty}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
    : emptyHtml();
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
    <span>閺勫墽銇?${from}-${to} / ${pageState.total}</span>
    <div class="pager-actions">
      <button class="ghost-button" type="button" data-${prefix}-page="prev" ${pageState.page <= 1 ? "disabled" : ""}>娑撳﹣绔存い?/button>
      <span>${pageState.page} / ${pageState.pages}</span>
      <button class="ghost-button" type="button" data-${prefix}-page="next" ${pageState.page >= pageState.pages ? "disabled" : ""}>娑撳绔存い?/button>
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
  $("#materialList").innerHTML = `<div class="empty-state">閸旂姾娴囨稉?..</div>`;
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
            <button class="secondary-button mini-action" type="button" data-edit-material="${escapeHtml(item.sku)}">娣囶喗鏁?/button>
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
  $("#locationList").innerHTML = `<div class="empty-state">閸旂姾娴囨稉?..</div>`;
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
            <span>${Number(item.stockRows ?? state.stock.filter((stock) => stock.location === item.code).length)} 閺夆€崇氨鐎?/span>
          </div>
          <div class="card-meta">
            <span>${escapeHtml(item.status)}</span>
            <button class="secondary-button mini-action" type="button" data-edit-location="${escapeHtml(item.code)}">娣囶喗鏁?/button>
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
            ${user.id === "admin" ? "" : `<button class="mini-danger" type="button" data-delete-user="${escapeHtml(user.id)}">閸掔娀娅?/button>`}
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
  $("#logList").innerHTML = `<div class="empty-state">濞翠焦鎸夐崝鐘烘祰娑?..</div>`;
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
              <th>閹垮秳缍旈弮銉︽埂</th>
              <th>鐠愶箑褰?/th>
              <th>缁鐎?/th>
              <th>閻椻晜鏋＄紓鏍垳</th>
              <th>閹电懓褰?/th>
              <th>鎼存挷缍?/th>
              <th>閻╊喗鐖ｆ惔鎾茬秴</th>
              <th>閻樿埖鈧?/th>
              <th class="num-cell">閺佷即鍣?/th>
              <th>婢跺洦鏁?/th>
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
              <th>閹垮秳缍旈弮銉︽埂</th>
              <th>鐠愶箑褰?/th>
              <th>鐎电钖?/th>
              <th>閹垮秳缍?/th>
              <th>娑撳鏁?/th>
              <th>娣囶喗鏁奸崜?/th>
              <th>娣囶喗鏁奸崥?/th>
              <th>婢跺洦鏁?/th>
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
  return { in: "閸忋儱绨?, out: "閸戝搫绨?, move: "缁夎绨?, count: "閻╂鍋?, adjust: "閻╂鍋ｇ拫鍐╂殻", initial: "閺堢喎鍨? }[type] || type;
}

function emptyHtml() {
  return $("#emptyTemplate").innerHTML;
}

function render() {
  renderUserSelect();
  renderPermissions();
  if (!apiSyncAttempted) setSyncStatus(syncStatusText());
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
      button.textContent = "登录中";
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
    if (!busy) button.disabled = button.dataset.logicDisabled === "1" || (serverRequired && !apiAvailable);
  });
}

async function withButtonBusy(button, busyText, action) {
  if (button?.dataset.busy === "1") return;
  setButtonBusy(button, true, busyText || "处理中");
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
      閻椻晜鏋＄紓鏍垳: item.sku,
      閻椻晜鏋￠崥宥囆? item.name || material?.name || "",
      閹电懓褰? item.batch,
      閺佷即鍣? item.qty,
      鎼存挷缍? item.location,
      閻樿埖鈧? item.status
    };
  });
  downloadCsv(rows, `鎼存挸鐡ㄧ€电厧鍤?${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadTemplate() {
  downloadCsv([{ 閻椻晜鏋＄紓鏍垳: "RM-1001", 閻椻晜鏋￠崥宥囆? "閻㈡ɑ琛?, 閹电懓褰? "B20260501", 閺佷即鍣? "120", 鎼存挷缍? "A-01-01", 閻樿埖鈧? "閸欘垳鏁? }], "鎼存挸鐡ㄧ€电厧鍙嗗Ο鈩冩緲.csv");
}

function downloadMaterialTemplate() {
  downloadCsv([{ 閻椻晜鏋＄紓鏍垳: "RM-1001", 閻椻晜鏋￠崥宥囆? "閻㈡ɑ琛? }], "閻椻晜鏋℃稉缁樻殶閹诡喗膩閺?csv");
}

function downloadLocationTemplate() {
  downloadCsv([{ 鎼存挷缍? "A-01-01", 閻樿埖鈧? "缁屾椽妫? }], "鎼存挷缍呮稉缁樻殶閹诡喗膩閺?csv");
}

function downloadCsv(rows, filename) {
  const headers = Object.keys(rows[0] || { 缁? "" });
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
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const rows = await readSelectedRows("#inventoryFile");
  if (!rows.length) return showToast("閺傚洣娆㈠▽鈩冩箒閸欘垰顕遍崗銉︽殶閹?);
  const report = validateInventoryRows(rows);
  renderImportReport("閺堢喎鍨垫惔鎾崇摠閺嶏繝鐛欓幎銉ユ啞", report);
  if (!report.validRows) return showToast("濞屸剝婀侀張澶嬫櫏鎼存挸鐡ㄧ悰宀嬬礉鐠囬攱顥呴弻銉︽瀮娴?);
  if (!confirm(importConfirmText("閺堢喎鍨垫惔鎾崇摠", report))) return;
  try {
    const remote = await postMasterData("/api/import-inventory", { rows });
    if (remote) {
      render();
      return showToast("鎼存挸鐡ㄧ€电厧鍙嗗鍙夊絹娴?);
    }
  } catch (error) {
    return showToast(error.message);
  }
  const groupedRows = new Map();
  let rejected = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["閻椻晜鏋＄紓鏍垳", "鐎涙鎻ｇ紓鏍垳", "sku", "SKU"]));
    const name = String(pickField(row, ["閻椻晜鏋￠崥宥囆?, "鐎涙鎻ｉ崥宥囆?, "name"]) || "").trim();
    const batch = normalize(pickField(row, ["閹电懓褰?, "batch"]));
    const rawQty = pickField(row, ["閺佷即鍣?, "閸欘垳鏁ら弫浼村櫤", "閻滄澘鐡ㄩ柌?, "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["鎼存挷缍?, "鎼存挷缍呯紓鏍垳", "娴犳挸绨遍崥宥囆?, "娴犳挸绨?, "location"]));
    const status = String(pickField(row, ["閻樿埖鈧?, "鎼存挸鐡ㄩ悩鑸碘偓?, "status"]) || "閸欘垳鏁?).trim();
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
    if (!findLocation(item.location)) state.locations.push({ code: item.location, status: "缁屾椽妫? });
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
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: imported, location: "", targetLocation: "", status: "", note: `鐎电厧鍙嗛張鐔峰灥鎼存挸鐡?${imported} 鐞涘矉绱濋幏鎺旂卜 ${rejected} 鐞涘畭 });
  addAuditLog({ action: "鐎电厧鍙嗛張鐔峰灥鎼存挸鐡?, entity: "鎼存挸鐡ㄧ€电厧鍙?, key: "IMPORT", before: null, after: { imported, rejected, sourceRows: rows.length }, note: `鐎电厧鍙嗛張鐔峰灥鎼存挸鐡?${imported} 鐞涘矉绱濋幏鎺旂卜 ${rejected} 鐞涘畭 });
  saveState();
  render();
  showToast(`瀹告彃顕遍崗?${imported} 鐞涘矉绱濋幏鎺旂卜 ${rejected} 鐞涘畭);
}

async function importMaterials() {
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const rows = await readSelectedRows("#materialFile");
  if (!rows.length) return showToast("閺傚洣娆㈠▽鈩冩箒閸欘垰顕遍崗銉︽殶閹?);
  const report = validateMaterialRows(rows);
  renderImportReport("閻椻晜鏋℃稉缁樻殶閹诡喗鐗庢灞惧Г閸?, report);
  if (!report.validRows) return showToast("濞屸剝婀侀張澶嬫櫏閻椻晜鏋＄悰宀嬬礉鐠囬攱顥呴弻銉︽瀮娴?);
  if (!confirm(importConfirmText("閻椻晜鏋℃稉缁樻殶閹?, report))) return;
  try {
    const remote = await postMasterData("/api/import-materials", { rows });
    if (remote) {
      render();
      return showToast("閻椻晜鏋℃稉缁樻殶閹诡喖顕遍崗銉ュ嚒閹绘劒姘?);
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["閻椻晜鏋＄紓鏍垳", "鐎涙鎻ｇ紓鏍垳", "sku", "SKU"]));
    const name = String(pickField(row, ["閻椻晜鏋￠崥宥囆?, "鐎涙鎻ｉ崥宥囆?, "name"]) || "").trim();
    if (!sku || !name) return;
    upsertMaterial({ sku, name });
    imported += 1;
  });
  addAuditLog({ action: "鐎电厧鍙嗛悧鈺傛灐娑撶粯鏆熼幑?, entity: "閻椻晜鏋℃稉缁樻殶閹?, key: "IMPORT", before: null, after: { imported }, note: `鐎电厧鍙嗛悧鈺傛灐 ${imported} 鐞涘畭 });
  saveState();
  render();
  showToast(`瀹告彃顕遍崗銉у⒖閺?${imported} 鐞涘畭);
}

async function importLocations() {
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const rows = await readSelectedRows("#locationFile");
  if (!rows.length) return showToast("閺傚洣娆㈠▽鈩冩箒閸欘垰顕遍崗銉︽殶閹?);
  const report = validateLocationRows(rows);
  renderImportReport("鎼存挷缍呮稉缁樻殶閹诡喗鐗庢灞惧Г閸?, report);
  if (!report.validRows) return showToast("濞屸剝婀侀張澶嬫櫏鎼存挷缍呯悰宀嬬礉鐠囬攱顥呴弻銉︽瀮娴?);
  if (!confirm(importConfirmText("鎼存挷缍呮稉缁樻殶閹?, report))) return;
  try {
    const remote = await postMasterData("/api/import-locations", { rows });
    if (remote) {
      render();
      return showToast("鎼存挷缍呮稉缁樻殶閹诡喖顕遍崗銉ュ嚒閹绘劒姘?);
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const code = normalize(row["鎼存挷缍?] || row["鎼存挷缍呯紓鏍垳"] || row.location || row.code);
    const status = String(row["閻樿埖鈧?] || row.status || "缁屾椽妫?).trim();
    if (!code) return;
    const existing = findLocation(code);
    if (existing) existing.status = status;
    else state.locations.push({ code, status });
    imported += 1;
  });
  refreshLocationUsage();
  addAuditLog({ action: "鐎电厧鍙嗘惔鎾茬秴娑撶粯鏆熼幑?, entity: "鎼存挷缍呮稉缁樻殶閹?, key: "IMPORT", before: null, after: { imported }, note: `鐎电厧鍙嗘惔鎾茬秴 ${imported} 鐞涘畭 });
  saveState();
  render();
  showToast(`瀹告彃顕遍崗銉ョ氨娴?${imported} 鐞涘畭);
}

async function downloadBackup() {
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
    const filename = `wms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("婢跺洣鍞ゅ韫瑓鏉?);
  } catch (error) {
    showToast(error?.message || "鐧诲綍澶辫触锛岃閲嶈瘯");
  }
}

async function downloadAutoBackup() {
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/auto-backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
    const filename = `wms-auto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("閼奉亜濮╂径鍥﹀敜瀹歌弓绗呮潪?);
  } catch (error) {
    showToast(error?.message || "鐧诲綍澶辫触锛岃閲嶈瘯");
  }
}

async function restoreBackup() {
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const file = $("#restoreFile").files[0];
  if (!file) return showToast("鐠囩兘鈧瀚ㄦ径鍥﹀敜 JSON 閺傚洣娆?);
  if (!confirm("閹垹顦叉径鍥﹀敜娴兼俺顩惄鏍х秼閸撳秴绨辩€涙ǜ鈧椒瀵岄弫鐗堝祦閵嗕浇澶勯崣宄版嫲濞翠焦鎸夐敍宀€鈥樼€规氨鎴风紒顓炴偋閿?)) return;
  try {
    const backup = JSON.parse(await readTextFile(file));
    const auth = currentAuthPayload();
    const response = await fetch("/api/restore-backup", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ backup, operatorId: auth.operatorId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "璐﹀彿鎴栧瘑鐮侀敊璇?);
    const currentUserId = state.currentUserId;
    Object.assign(state, migrateState({ ...defaultState(), ...data }));
    state.currentUserId = currentUserId;
    localStorage.setItem(storeKey, JSON.stringify(state));
    $("#restoreFile").value = "";
    render();
    showToast("婢跺洣鍞ゅ鍙変划婢?);
  } catch (error) {
    showToast(error.message || "婢跺洣鍞ら弬鍥︽閺冪姵纭剁拠璇插絿");
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
    const sku = normalize(pickField(row, ["閻椻晜鏋＄紓鏍垳", "鐎涙鎻ｇ紓鏍垳", "sku", "SKU"]));
    const name = String(pickField(row, ["閻椻晜鏋￠崥宥囆?, "鐎涙鎻ｉ崥宥囆?, "name"]) || "").trim();
    const batch = normalize(pickField(row, ["閹电懓褰?, "batch"]));
    const rawQty = pickField(row, ["閺佷即鍣?, "閸欘垳鏁ら弫浼村櫤", "閻滄澘鐡ㄩ柌?, "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["鎼存挷缍?, "鎼存挷缍呯紓鏍垳", "娴犳挸绨遍崥宥囆?, "娴犳挸绨?, "location"]));
    const status = String(pickField(row, ["閻樿埖鈧?, "鎼存挸鐡ㄩ悩鑸碘偓?, "status"]) || "閸欘垳鏁?).trim();
    const reasons = [];
    if (!sku) reasons.push("缂傚搫鐨悧鈺傛灐缂傛牜鐖?);
    if (!name) reasons.push("缂傚搫鐨悧鈺傛灐閸氬秶袨");
    if (!batch) reasons.push("缂傚搫鐨幍鐟板娇");
    if (!location) reasons.push("缂傚搫鐨惔鎾茬秴");
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
    const sku = normalize(pickField(row, ["閻椻晜鏋＄紓鏍垳", "鐎涙鎻ｇ紓鏍垳", "sku", "SKU"]));
    const name = String(pickField(row, ["閻椻晜鏋￠崥宥囆?, "鐎涙鎻ｉ崥宥囆?, "name"]) || "").trim();
    const reasons = [];
    if (!sku) reasons.push("缂傚搫鐨悧鈺傛灐缂傛牜鐖?);
    if (!name) reasons.push("缂傚搫鐨悧鈺傛灐閸氬秶袨");
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
    const code = normalize(pickField(row, ["鎼存挷缍?, "鎼存挷缍呯紓鏍垳", "娴犳挸绨遍崥宥囆?, "娴犳挸绨?, "location", "code"]));
    if (!code) return addInvalid(report, index, ["缂傚搫鐨惔鎾茬秴缂傛牜鐖?]);
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
  if (report.invalidSamples.length < 8) report.invalidSamples.push(`缁?${index + 2} 鐞涘矉绱?{reasons.join("閿?)}`);
}

function renderImportReport(title, report) {
  const target = $("#importReport");
  if (!target) return;
  target.classList.remove("hidden");
  const invalid = report.invalidSamples.length ? `<br>${report.invalidSamples.map(escapeHtml).join("<br>")}` : "";
  target.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    閸樼喎顫?${report.sourceRows} 鐞涘矉绱遍張澶嬫櫏 ${report.validRows} 鐞涘矉绱遍弮鐘虫櫏 ${report.invalidRows} 鐞涘矉绱遍柌宥咁槻閸氬牆鑻?${report.duplicateRows} 鐞涘矉绱遍張鈧紒鍫濐嚤閸?${report.mergedRows} 鐞涘被鈧?    ${report.totalQty ? `<br>閺堝鏅ラ弫浼村櫤閸氬牐顓搁敍?{report.totalQty}` : ""}
    ${invalid}`;
}

function importConfirmText(title, report) {
  return `${title}鐎电厧鍙嗛弽锟犵崣閿涙瓡n閸樼喎顫?${report.sourceRows} 鐞涘n閺堝鏅?${report.validRows} 鐞涘n閺冪姵鏅?${report.invalidRows} 鐞涘n闁插秴顦查崥鍫濊嫙 ${report.duplicateRows} 鐞涘n閺堚偓缂佸牆顕遍崗?${report.mergedRows} 鐞涘n\n閺勵垰鎯佺紒褏鐢荤€电厧鍙嗛張澶嬫櫏閺佺増宓侀敍鐒?
}

async function readSelectedRows(selector) {
  const file = $(selector).files[0];
  if (!file) {
    showToast("鐠囩兘鈧瀚?Excel 閹?CSV 閺傚洣娆?);
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
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const sku = normalize($("#newSku").value);
  const name = $("#newName").value.trim();
  const previousSku = editingMaterialSku;
  if (!sku || !name) return showToast("閻椻晜鏋＄紓鏍垳閸滃苯鎮曠粔棰佺瑝閼虫垝璐熺粚?);
  if (!previousSku && state.materials.some((item) => item.sku === sku)) return showToast("閻椻晜鏋＄紓鏍垳瀹告彃鐡ㄩ崷顭掔礉鐠囬攱鎮崇槐銏犳倵閻愰€涙叏閺€?);
  if (previousSku && previousSku !== sku && state.materials.some((item) => item.sku === sku)) return showToast("閻椻晜鏋＄紓鏍垳瀹告彃鐡ㄩ崷?);
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
      addAuditLog({ action: existing ? (previousSku && previousSku !== sku ? "娣囶喗鏁奸悧鈺傛灐缂傛牜鐖? : "娣囶喗鏁奸悧鈺傛灐") : "閺傛澘顤冮悧鈺傛灐", entity: "閻椻晜鏋℃稉缁樻殶閹?, key: sku, before, after: { sku, name } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheMaterials([{ sku, name }]);
  materialPage.page = 1;
  resetMaterialEdit();
  render();
  showToast("閻椻晜鏋℃稉缁樻殶閹诡喖鍑℃穱婵嗙摠");
}

async function addLocation(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const code = normalize($("#newLocation").value);
  const previousCode = editingLocationCode;
  const status = $("#newLocationStatus").value;
  if (!code) return showToast("鎼存挷缍呯紓鏍垳娑撳秷鍏樻稉铏光敄");
  if (!previousCode && state.locations.some((item) => item.code === code)) return showToast("鎼存挷缍呭鎻掔摠閸︻煉绱濈拠閿嬫偝缁便垹鎮楅悙閫涙叏閺€?);
  if (previousCode && previousCode !== code && state.locations.some((item) => item.code === code)) return showToast("鎼存挷缍呯紓鏍垳瀹告彃鐡ㄩ崷?);
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
      addAuditLog({ action: existing ? (previousCode && previousCode !== code ? "娣囶喗鏁兼惔鎾茬秴缂傛牜鐖? : "娣囶喗鏁兼惔鎾茬秴") : "閺傛澘顤冩惔鎾茬秴", entity: "鎼存挷缍呮稉缁樻殶閹?, key: code, before, after: findLocation(code) || { code, status } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheLocations([{ code, status }]);
  locationPage.page = 1;
  resetLocationEdit();
  render();
  showToast("鎼存挷缍呮稉缁樻殶閹诡喖鍑℃穱婵嗙摠");
}

function editMaterial(sku) {
  const material = findMaterial(sku);
  if (!material) return;
  editingMaterialSku = material.sku;
  $("#newSku").value = material.sku;
  $("#newName").value = material.name;
  $("#materialSaveButton").textContent = "娣囨繂鐡ㄦ穱顔芥暭";
  $("#cancelMaterialEdit").classList.remove("hidden");
  $("#newName").focus();
}

function resetMaterialEdit() {
  editingMaterialSku = "";
  $("#materialForm").reset();
  $("#materialSaveButton").textContent = "娣囨繂鐡?;
  $("#cancelMaterialEdit").classList.add("hidden");
}

function editLocation(code) {
  const location = findLocation(code);
  if (!location) return;
  editingLocationCode = location.code;
  $("#newLocation").value = location.code;
  $("#newLocationStatus").value = location.status || "缁屾椽妫?;
  $("#locationSaveButton").textContent = "娣囨繂鐡ㄦ穱顔芥暭";
  $("#cancelLocationEdit").classList.remove("hidden");
  $("#newLocation").focus();
}

function resetLocationEdit() {
  editingLocationCode = "";
  $("#locationForm").reset();
  $("#locationSaveButton").textContent = "娣囨繂鐡?;
  $("#cancelLocationEdit").classList.add("hidden");
}

async function addUser(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("濞屸剝婀侀弶鍐");
  const id = normalize($("#newUserId").value);
  const existing = state.users.find((user) => user.id === id);
  const password = $("#newUserPassword").value.trim();
  const user = { id, name: $("#newUserName").value.trim(), role: $("#newUserRole").value };
  if (!existing && !password) return showToast("閺傛澘顤冪拹锕€褰胯箛鍛淬€忕拋鍓х枂鐎靛棛鐖?);
  try {
    const remote = await postUserData("/api/users", { id, name: user.name, role: user.role, userPassword: password });
    if (!remote) {
      const before = existing ? { id: existing.id, name: existing.name, role: existing.role } : null;
      if (existing) Object.assign(existing, user);
      else state.users.push(user);
      const afterUser = state.users.find((item) => item.id === id);
      addAuditLog({ action: existing ? "娣囶喗鏁肩拹锕€褰? : "閺傛澘顤冪拹锕€褰?, entity: "鐠愶箑褰块弶鍐", key: id, before, after: { id: afterUser.id, name: afterUser.name, role: afterUser.role } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  if (id.toLowerCase() === "admin" && password && sessionAuth.userId?.toLowerCase() === "admin") {
    sessionAuth = { ...sessionAuth, mustChangePassword: false };
  }
  render();
  showToast("管理员信息已更新");
}

async function loginAsync() {
  const userId = $("#loginUserInput").value.trim();
  const password = $("#loginPasswordInput").value;
  const button = $("#loginButton");
  if (button.dataset.busy === "1") return;
  setButtonBusy(button, true, "正在登录");
  showToast("正在登录");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WMS-Lite-Lite": "1" },
      body: JSON.stringify({ userId, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "账号或密码错误");
    Object.assign(state, migrateState({ ...defaultState(), ...(data.state || {}) }));
    state.currentUserId = data.user.id;
    saveSessionAuth(data.user.id, data.token, data.expiresAt, data.mustChangePassword);
    apiAvailable = true;
    apiSyncAttempted = true;
    apiConnectionState = "connected";
    $("#loginPasswordInput").value = "";
    saveState();
    $("#accountBadge").textContent = `${data.user.id} / ${roleLabel(data.user.role)}`;
    renderPermissions();
    render();
    showToast(`登录成功，当前用户：${data.user.id}`);
    if (data.mustChangePassword) {
      activateView("users");
      showToast("管理员仍在使用默认密码，请先修改密码");
    }
  } catch (error) {
    showToast(error?.message || "登录失败，请重试");
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
  if (!confirm(`确认删除用户 ${userId} 吗？`)) return;
  try {
    const remote = await postUserData("/api/users/delete", { targetId: userId });
    if (!remote) {
      const before = state.users.find((user) => user.id === userId);
      state.users = state.users.filter((user) => user.id !== userId);
      if (state.currentUserId === userId) state.currentUserId = "";
      if (before) addAuditLog({ action: "閸掔娀娅庣拹锕€褰?, entity: "鐠愶箑褰块弶鍐", key: userId, before: { id: before.id, name: before.name, role: before.role }, after: null });
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
    if (!isAdmin() && !["operate", "count", "stock"].includes(button.dataset.view)) return showToast("濞屸剝婀侀弶鍐");
    if (!canOpenView(button.dataset.view)) return showToast("濞屸剝婀侀弶鍐");
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

$("#loginButton").addEventListener("click", login);
$("#loginPanel").addEventListener("submit", (event) => { event.preventDefault(); login(); });
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
  if (qty !== null && maxQty && qty > maxQty) showToast("閺堫剚顐奸弫浼村櫤娑撳秷鍏樼搾鍛扮箖閻滅増婀佹惔鎾崇摠");
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
$("#importInventory").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "鐎电厧鍙嗘稉?, importInventory));
$("#importMaterials").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "鐎电厧鍙嗘稉?, importMaterials));
$("#importLocations").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "鐎电厧鍙嗘稉?, importLocations));
$("#downloadBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "婢跺洣鍞ゆ稉?, downloadBackup));
$("#downloadAutoBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "娑撳娴囨稉?, downloadAutoBackup));
$("#restoreBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "閹垹顦叉稉?, restoreBackup));
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
  setSyncStatus("閺€璺哄煂閺囧瓨鏌?);
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
    setSyncStatus("閺€璺哄煂閺囧瓨鏌?);
    render();
  });
}

setupInstallPrompt();
registerServiceWorker();
render();
initApiSync();





