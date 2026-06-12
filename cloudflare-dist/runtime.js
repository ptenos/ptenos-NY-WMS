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
const frontendBuildVersion = "runtime-language-template-20260611a";
const languageStorageKey = "wms-lite-display-language-v1";
let displayLanguage = loadDisplayLanguage();
const languageTemplates = {
  en: {
    ui: {
      appTitle: "WMS Lite Warehouse Execution System",
      connecting: "Connecting",
      connected: "Server connected",
      connectionFailed: "Server connection failed",
      localDemo: "Local demo",
      notLoggedIn: "Not logged in",
      install: "Install",
      logout: "Logout",
      username: "Username",
      password: "Password",
      login: "Login",
      resetAdminPassword: "Reset Admin Password",
      usernamePlaceholder: "Enter account",
      passwordPlaceholder: "Enter password",
      offlineBanner: "Server is not connected. You can only view cached data for now.",
      passwordWarning: "The administrator is still using the default password. Change it before formal use.",
      language: "Language",
      noData: "No data",
      save: "Save",
      cancel: "Cancel",
      edit: "Edit",
      back: "Back",
      confirmSubmit: "Confirm Submit",
      confirmOperation: "Confirm Operation",
      loading: "Loading..."
    },
    operation: {
      save: "Save",
      cancel: "Cancel",
      confirm: "Confirm",
      back: "Back",
      submit: "Submit",
      materialCode: "Material Code",
      materialName: "Material Name",
      batchNo: "Batch",
      location: "Location",
      fromLocation: "Source Location",
      toLocation: "Target Location",
      qty: "Qty",
      status: "Status",
      remark: "Remark",
      in: "Inbound",
      out: "Outbound",
      move: "Move",
      count: "Stock Count",
      stock: "Stock",
      checkStock: "Check Stock",
      delete: "Delete"
    },
    admin: {
      accountPermissions: "Account Permissions",
      masterData: "Master Data",
      import: "Import",
      transactionLog: "Transaction Log",
      changeLog: "Change Log",
      changePassword: "Change Password",
      addAccount: "Add Account",
      deleteAccount: "Delete Account",
      accessScope: "Access Scope",
      systemAdminLocked: "System admin, cannot be deleted",
      allFeatures: "All Features",
      operateStock: "Operation, Stock",
      operateCountStock: "Operation, Stock Count, Stock"
    },
    roles: {
      employee: "Employee",
      keeper: "Warehouse Keeper",
      admin: "Admin",
      operator: "Employee"
    },
    type: {
      in: "Inbound",
      out: "Outbound",
      move: "Move",
      count: "Stock Count",
      adjust: "Stock Adjustment",
      initial: "Initial Stock"
    },
    errors: {
      INVALID_LOGIN: { operation: "Login failed", admin: "Invalid username or password" },
      STOCK_NOT_ENOUGH: { operation: "Stock not enough", admin: "Stock not enough" },
      MATERIAL_EXISTS: { operation: "Material code already exists", admin: "Material code already exists" },
      MATERIAL_NOT_FOUND: { operation: "Material must be selected from master data", admin: "Material must be selected from master data" },
      LOCATION_EXISTS: { operation: "Location code already exists", admin: "Location code already exists" },
      INVALID_LOCATION: { operation: "Invalid location", admin: "Invalid location" },
      TARGET_LOCATION_SAME: { operation: "Target location cannot be the same", admin: "Target location cannot be the same" },
      TARGET_LOCATION_FROZEN: { operation: "Target location is frozen", admin: "Target location is frozen" },
      INVALID_QTY: { operation: "Invalid quantity", admin: "Invalid quantity" },
      USER_NOT_FOUND: { operation: "Account not found", admin: "Account not found" },
      ADMIN_CANNOT_BE_DELETED: { operation: "Admin account cannot be deleted", admin: "Admin account cannot be deleted" },
      PASSWORD_TOO_SHORT: { operation: "Password must be at least 6 characters", admin: "Password must be at least 6 characters" },
      PASSWORD_REQUIRED: { operation: "Password is required", admin: "Password is required" },
      UNAUTHORIZED: { operation: "Unauthorized", admin: "Unauthorized" },
      FORBIDDEN: { operation: "Forbidden", admin: "Forbidden" },
      VERSION_CONFLICT: { operation: "Stock changed. Refresh and try again.", admin: "Stock changed. Refresh and try again." }
    }
  },
  zh: {
    ui: {
      appTitle: "轻量仓库执行系统 / WMS Lite",
      connecting: "连接中",
      connected: "服务器已连接",
      connectionFailed: "服务器连接失败",
      localDemo: "本机演示",
      notLoggedIn: "未登录",
      install: "安装",
      logout: "退出",
      username: "账号",
      password: "密码",
      login: "登录",
      resetAdminPassword: "重置管理员密码",
      usernamePlaceholder: "请输入账号",
      passwordPlaceholder: "请输入密码",
      offlineBanner: "服务器未连接，当前只能查看缓存数据。",
      passwordWarning: "管理员仍在使用默认密码，正式使用前请先修改。",
      language: "语言",
      noData: "暂无数据",
      save: "保存",
      cancel: "取消",
      edit: "修改",
      back: "返回",
      confirmSubmit: "确认提交",
      confirmOperation: "确认作业",
      loading: "加载中..."
    },
    operation: {
      save: "保存",
      cancel: "取消",
      confirm: "确认",
      back: "返回修改",
      submit: "提交",
      materialCode: "物料编码",
      materialName: "物料名称",
      batchNo: "批号",
      location: "库位",
      fromLocation: "原库位",
      toLocation: "目标库位",
      qty: "数量",
      status: "状态",
      remark: "备注",
      in: "入库",
      out: "出库",
      move: "移库",
      count: "盘点",
      stock: "库存",
      checkStock: "查库存",
      delete: "删除"
    },
    admin: {
      accountPermissions: "账号权限",
      masterData: "主数据",
      import: "导入",
      transactionLog: "流水账",
      changeLog: "修改记录",
      changePassword: "修改密码",
      addAccount: "新增账号",
      deleteAccount: "删除账号",
      accessScope: "权限范围",
      systemAdminLocked: "系统管理员，不可删除",
      allFeatures: "全部功能",
      operateStock: "作业、库存",
      operateCountStock: "作业、盘点、库存"
    },
    roles: {
      employee: "员工",
      keeper: "仓管",
      admin: "管理员",
      operator: "员工"
    },
    type: {
      in: "入库",
      out: "出库",
      move: "移库",
      count: "盘点",
      adjust: "盘点调整",
      initial: "期初库存"
    },
    errors: {
      INVALID_LOGIN: { operation: "登录失败", admin: "账号或密码错误" },
      STOCK_NOT_ENOUGH: { operation: "库存不足", admin: "库存不足" },
      MATERIAL_EXISTS: { operation: "物料编码已存在", admin: "物料编码已存在" },
      MATERIAL_NOT_FOUND: { operation: "物料必须从主数据选择", admin: "物料必须从主数据选择" },
      LOCATION_EXISTS: { operation: "库位编码已存在", admin: "库位编码已存在" },
      INVALID_LOCATION: { operation: "库位无效", admin: "库位无效" },
      TARGET_LOCATION_SAME: { operation: "目标库位不能相同", admin: "目标库位不能相同" },
      TARGET_LOCATION_FROZEN: { operation: "目标库位已冻结", admin: "目标库位已冻结" },
      INVALID_QTY: { operation: "数量无效", admin: "数量无效" },
      USER_NOT_FOUND: { operation: "账号不存在", admin: "账号不存在" },
      ADMIN_CANNOT_BE_DELETED: { operation: "不能删除管理员账号", admin: "不能删除管理员账号" },
      PASSWORD_TOO_SHORT: { operation: "密码至少 6 位", admin: "密码至少 6 位" },
      PASSWORD_REQUIRED: { operation: "必须设置密码", admin: "必须设置密码" },
      UNAUTHORIZED: { operation: "未授权", admin: "未授权" },
      FORBIDDEN: { operation: "禁止访问", admin: "禁止访问" },
      VERSION_CONFLICT: { operation: "库存已变化，请刷新后重试", admin: "库存已变化，请刷新后重试" }
    }
  }
};
let labels = languageTemplates[displayLanguage] || languageTemplates.en;
document.documentElement.lang = displayLanguage === "zh" ? "zh-CN" : "en";
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
let pendingPasswordUserId = "";
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
      { id: "admin", role: "admin" },
      { id: "WH-001", role: "employee" },
      { id: "WH-MGR", role: "keeper" }
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
    const auth = JSON.parse(wmsSessionStorage.getItem(authKey) || "{}");
    if (auth.expiresAt) {
      const expiresAt = new Date(auth.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        wmsSessionStorage.removeItem(authKey);
        return {};
      }
    }
    return auth;
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

function loadDisplayLanguage() {
  const value = wmsLocalStorage.getItem(languageStorageKey);
  return value === "zh" ? "zh" : "en";
}

function setDisplayLanguage(value) {
  displayLanguage = value === "zh" ? "zh" : "en";
  labels = languageTemplates[displayLanguage] || languageTemplates.en;
  wmsLocalStorage.setItem(languageStorageKey, displayLanguage);
  document.documentElement.lang = displayLanguage === "zh" ? "zh-CN" : "en";
  render();
}

function migrateState(data) {
  const defaults = defaultState().users;
  data.users = Array.isArray(data.users) ? data.users : defaults;
  data.users.forEach((user) => {
    if (user.role === "operator") user.role = "employee";
    delete user.name;
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
  data.locations = (Array.isArray(data.locations) ? data.locations : []).map((item) => ({
    ...item,
    status: normalizeLocationStatus(item.status)
  }));
  cacheMaterials(data.materials);
  cacheLocations(data.locations);
  data.auditLogs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
  data.stock = (Array.isArray(data.stock) ? data.stock : []).map((row) => ({
    version: 1,
    updatedAt: new Date().toISOString(),
    ...row,
    status: normalizeStockStatus(row.status)
  }));
  return data;
}

function ensureAdminAccount() {
  if (serverRequired) {
    showToast(displayLanguage === "zh"
      ? "正式服务不能在手机端重置管理员密码，请在账号权限里修改密码"
      : "Admin password reset is disabled here. Change it in Account Permissions.");
    return;
  }
  let admin = state.users.find((user) => String(user.id).toLowerCase() === "admin");
  if (!admin) {
    admin = { id: "admin", role: "admin" };
    state.users.unshift(admin);
  }
  admin.id = "admin";
  admin.role = "admin";
  delete admin.password;
  delete admin.passwordHash;
  saveState();
  render();
  showToast(displayLanguage === "zh" ? "管理员密码已重置为 admin123" : "Admin password reset to admin123");
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
    operator: `${user.id} ${user.name || user.id}`
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
  const user = currentUser();
  if (!user) return false;
  const modules = Array.isArray(user.modules) && user.modules.length
    ? user.modules
    : (user.role === "keeper" ? ["operate", "count", "stock"] : ["operate", "stock"]);
  const moduleMap = {
    operate: "operate",
    count: "count",
    stock: "stock",
    import: "import",
    master: "master",
    users: "users",
    logs: "logs",
    audit: "audit"
  };
  return modules.includes(moduleMap[viewId] || viewId);
}

function roleLabel(role) {
  return labels.roles?.[role] || role;
}

function permissionScope(role) {
  return {
    admin: labels.admin.allFeatures,
    keeper: labels.admin.operateCountStock,
    employee: labels.admin.operateStock,
    operator: labels.admin.operateStock
  }[role] || role;
}

function locationStatusLabel(status) {
  const value = normalizeLocationStatus(status);
  const map = {
    empty: displayLanguage === "zh" ? "空闲" : "Empty",
    occupied: displayLanguage === "zh" ? "占用" : "Occupied",
    frozen: displayLanguage === "zh" ? "冻结" : "Frozen"
  };
  return map[value] || value || "-";
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

function isFrozenLocationStatus(status) {
  return normalizeLocationStatus(status) === "frozen";
}

function locationUsageStatus(hasStock) {
  return hasStock ? "occupied" : "empty";
}

function getDefaultStockStatus() {
  return "available";
}

function canUseMoveOperation() {
  return !!currentUser() && canOpenView("operate");
}

function batchModeEnabled() {
  const checkbox = $("#batchModeInput");
  return !!checkbox && checkbox.checked && ["in", "out", "move"].includes(operationType);
}

function parseBatchOperationRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line, index) => ({
    lineNo: index + 1,
    raw: line,
    parts: line.split("|").map((part) => part.trim())
  }));
}

function findUniqueStockRow(sku, batch, location) {
  const matches = state.stock.filter((item) => item.sku === sku && item.batch === batch && item.location === location);
  if (matches.length === 1) return matches[0];
  return null;
}

function batchOperationLabel(type) {
  return {
    in: "Batch Inbound",
    out: "Batch Outbound",
    move: "Batch Move"
  }[type] || "Batch Operation";
}






function defaultModulesForRole(role) {
  if (role === "admin") return ["operate", "count", "stock", "import", "master", "users", "logs", "audit"];
  if (role === "keeper") return ["operate", "count", "stock"];
  return ["operate", "stock"];
}

function normalizeModules(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,\\s]+/);
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))];
}

function saveState(sync = true) {
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  if (sync && channel) channel.postMessage({ type: "state-updated", state });
  setSyncStatus(syncStatusText());
}

function debugLogin(message) {
  return message;
}

function apiErrorText(data, fallback = "Operation failed", scope = "operation") {
  const code = String(data?.errorCode || "").trim();
  if (code && labels.errors[code]) return labels.errors[code][scope] || labels.errors[code].operation || fallback;
  return data?.error || fallback;
}

function handleExpiredSessionResponse(response, data) {
  const expired = response.status === 401 ||
    data?.errorCode === "UNAUTHORIZED" ||
    (sessionAuth.token && data?.error === "请先登录");
  if (!expired) return false;
  clearSessionAuth();
  state.currentUserId = "";
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  render();
  return true;
}

function applyLanguageLabels() {
  const setText = (selector, value) => {
    const node = $(selector);
    if (node && value) node.textContent = value;
  };
  const setPlaceholder = (selector, value) => {
    const node = $(selector);
    if (node && value) node.placeholder = value;
  };
  const setLabelText = (selector, value) => {
    const node = $(selector);
    if (!node) return;
    const textNode = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
    if (textNode) textNode.textContent = `\n              ${value}\n              `;
  };
  const languageSelect = $("#displayLanguageSelect");
  if (languageSelect) languageSelect.value = displayLanguage;
  setText("h1", labels.ui.appTitle);
  setText("#languageLabel", labels.ui.language);
  setText("#loginButton", labels.ui.login);
  setText("#logoutButton", labels.ui.logout);
  setText("#installAppButton", labels.ui.install);
  setText("#resetAdminButton", labels.ui.resetAdminPassword);
  setLabelText(".login-panel label:nth-of-type(1)", labels.ui.username);
  setLabelText(".login-panel label:nth-of-type(2)", labels.ui.password);
  setPlaceholder("#loginUserInput", labels.ui.usernamePlaceholder);
  setPlaceholder("#loginPasswordInput", labels.ui.passwordPlaceholder);
  setText("#connectionBanner", labels.ui.offlineBanner);
  setText("#passwordWarning", labels.ui.passwordWarning);
  setText("#operationSubmitButton", labels.operation.submit);
  setText("#countSubmitButton", labels.operation.submit);
  setLabelText("#operationForm label.wide:nth-of-type(1)", displayLanguage === "zh" ? "作业类型" : "Operation Type");
  setLabelText("#skuInput", labels.operation.materialCode);
  const operationSelect = $("#operationTypeInput");
  if (operationSelect?.options?.length >= 3) {
    operationSelect.options[0].textContent = labels.operation.in;
    operationSelect.options[1].textContent = labels.operation.out;
    operationSelect.options[2].textContent = labels.operation.move;
  }
  const statusSelect = $("#statusInput");
  if (statusSelect?.options?.length >= 4) {
    statusSelect.options[0].textContent = "released";
    statusSelect.options[1].textContent = "pending";
    statusSelect.options[2].textContent = "hold";
    statusSelect.options[3].textContent = "quarantine";
  }
  setText("#materialSaveButton", labels.ui.save);
  setText("#locationSaveButton", labels.ui.save);
  setText("#importMaterials", labels.admin.import);
  setText("#importLocations", labels.admin.import);
  setText("#importInventory", labels.admin.import);
  setText("#downloadBackup", "Download Backup");
  setText("#downloadAutoBackup", "Download Auto Backup");
  setText("#restoreBackup", "Restore Backup");
  setText("#operationConfirmCancel", labels.ui.back);
  setText("#operationConfirmSubmit", labels.ui.confirmSubmit);
  setText("#passwordDialogCancel", labels.ui.cancel);
  setText("#passwordDialogSubmit", displayLanguage === "zh" ? "保存密码" : "Save Password");

  const tabMap = {
    operate: labels.operation.in === "入库" ? "作业" : "Operation",
    count: labels.operation.count,
    stock: labels.operation.stock,
    import: labels.admin.import,
    master: "Master Data",
    users: labels.admin.accountPermissions,
    logs: labels.admin.transactionLog,
    audit: labels.admin.changeLog
  };
  $$(".tab").forEach((tab) => {
    const view = tab.dataset.view;
    if (tabMap[view]) tab.textContent = tabMap[view];
  });
  $$("[data-home-action='in']").forEach((item) => item.textContent = labels.operation.in);
  $$("[data-home-action='out']").forEach((item) => item.textContent = labels.operation.out);
  $$("[data-home-action='move']").forEach((item) => item.textContent = labels.operation.move);
  $$("[data-home-action='stock']").forEach((item) => item.textContent = labels.operation.checkStock);
  $$("[data-home-action='count']").forEach((item) => item.textContent = labels.operation.count);
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
        const restoredSession = await validateSessionAuth(preservedAuth);
        Object.assign(state, migrateState({ ...defaultState(), ...(await response.json()) }));
        if (restoredSession?.user?.id) {
          state.currentUserId = restoredSession.user.id;
          saveSessionAuth(restoredSession.user.id, preservedAuth.token, preservedAuth.expiresAt, restoredSession.mustChangePassword);
        } else if (preservedUserId && !preservedAuth.token) {
          state.currentUserId = preservedUserId;
        } else {
          state.currentUserId = "";
          if (preservedAuth.token) clearSessionAuth();
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
    setSyncStatus(displayLanguage === "zh" ? "服务器已同步" : "Server synced");
  } catch {
    apiAvailable = false;
    setSyncStatus(labels.ui.localDemo);
  }
}

function setSyncStatus(text) {
  $("#syncStatus").textContent = text;
  renderRuntimeState();
}

function syncStatusText() {
  if (apiConnectionState === "connecting" && !apiSyncAttempted) return labels.ui.connecting;
  if (apiAvailable || apiConnectionState === "connected") return labels.ui.connected;
  if (apiConnectionState === "failed") return serverRequired ? labels.ui.connectionFailed : labels.ui.localDemo;
  return serverRequired ? labels.ui.connectionFailed : labels.ui.localDemo;
}

async function validateSessionAuth(auth = {}) {
  if (!auth.token || !auth.userId) return null;
  if (auth.expiresAt) {
    const expiresAt = new Date(auth.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  }
  try {
    const response = await fetch("/api/session", {
      headers: authHeaders({ operatorId: auth.userId, sessionToken: auth.token })
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function requireLiveServer(action = "操作") {
  if (!serverRequired || apiAvailable) return true;
  showToast(`Server belum tersambung, ${action} belum bisa dijalankan`);
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
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
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

function parseSystemQty(value) {
  const text = String(value ?? "").trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return null;
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(text)) return null;
  return Number(text);
}

function qtyErrorText(value) {
  const text = String(value ?? "").trim();
  if (text.includes(",")) return "Do not use comma decimals. Use standard format, for example 1000.5.";
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return "Do not use thousand separators such as 1.000.";
  return "Enter a standard number, up to 6 decimals, for example 1000 or 1000.123456.";
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
    if (item?.code) locationCache.set(normalize(item.code), { code: normalize(item.code), status: normalizeLocationStatus(item.status) });
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
    if (serverRequired) throw new Error("Server belum tersambung, silakan coba lagi setelah jaringan kembali");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch("/api/operations", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (handleExpiredSessionResponse(response, data)) throw new Error("Sesi login berakhir, silakan masuk lagi");
  if (!response.ok) throw new Error(apiErrorText(data, displayLanguage === "zh" ? "操作失败" : "Operation failed", "operation"));
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postOperationBatch(payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("Server belum tersambung, silakan coba lagi setelah jaringan kembali");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch("/api/operations/batch", {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (handleExpiredSessionResponse(response, data)) throw new Error("Sesi login berakhir, silakan masuk lagi");
  if (!response.ok) throw new Error(apiErrorText(data, displayLanguage === "zh" ? "操作失败" : "Operation failed", "operation"));
  const currentUserId = state.currentUserId;
  Object.assign(state, migrateState({ ...defaultState(), ...data }));
  state.currentUserId = currentUserId;
  wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
  return data;
}

async function postMasterData(path, payload) {
  if (!apiAvailable) {
    if (serverRequired) throw new Error("Server belum tersambung, silakan coba lagi setelah jaringan kembali");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (handleExpiredSessionResponse(response, data)) throw new Error("Sesi login berakhir, silakan masuk lagi");
  if (!response.ok) throw new Error(apiErrorText(data, "Save failed", "admin"));
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
    if (serverRequired) throw new Error("Server belum tersambung, silakan coba lagi setelah jaringan kembali");
    return null;
  }
  const auth = currentAuthPayload();
  const response = await fetch(path, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({ ...payload, operatorId: auth.operatorId })
  });
  const data = await response.json();
  if (handleExpiredSessionResponse(response, data)) throw new Error("Sesi login berakhir, silakan masuk lagi");
  if (!response.ok) throw new Error(apiErrorText(data, "Account save failed", "admin"));
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
  if (!response.ok) throw new Error(apiErrorText(data, "Data load failed", "admin"));
  return data;
}

function removeZeroStock() {
  state.stock = state.stock.filter((item) => item.qty > 0);
}

function cloneBatchState() {
  return JSON.parse(JSON.stringify({
    materials: state.materials,
    locations: state.locations,
    stock: state.stock,
    logs: state.logs,
    auditLogs: state.auditLogs,
    sessions: state.sessions,
    users: state.users,
    currentUserId: state.currentUserId
  }));
}

function findStockInData(data, { sku, batch, location, status }) {
  return (data.stock || []).find(
    (item) => item.sku === sku && item.batch === batch && item.location === location && item.status === status
  );
}

function upsertStockInData(data, { sku, batch, location, status, qty }) {
  const row = findStockInData(data, { sku, batch, location, status });
  if (row) {
    row.qty = roundQty(Number(row.qty || 0) + qty);
    row.version = Number(row.version || 0) + 1;
    row.updatedAt = new Date().toISOString();
  } else {
    (data.stock || (data.stock = [])).push({
      id: uid(),
      sku,
      batch,
      location,
      status,
      qty: roundQty(qty),
      version: 1,
      updatedAt: new Date().toISOString()
    });
  }
}

function removeZeroStockFromData(data) {
  data.stock = (data.stock || []).filter((item) => Number(item.qty || 0) > 0);
}

function refreshLocationUsageInData(data) {
  (data.locations || []).forEach((location) => {
    if (!isFrozenLocationStatus(location.status)) {
      location.status = locationUsageStatus((data.stock || []).some((item) => item.location === location.code));
    }
  });
}

function addLogToData(data, payload) {
  const user = currentUser();
  (data.logs || (data.logs = [])).unshift({
    id: uid(),
    operatorId: user?.id || "",
    operatorName: user?.name || "",
    operator: user ? `${user.id} ${user.name || user.id}` : "Not selected",
    time: formatMinute(),
    ...payload
  });
}

function applyBatchOperationLocally(payload) {
  const draft = cloneBatchState();
  const user = currentUser();
  const batchItems = Array.isArray(payload.batchItems) ? payload.batchItems : [];
  for (const item of batchItems) {
    const qty = Number(item.qty);
    const status = normalizeStockStatus(item.status || getDefaultStockStatus());
    const sourceKey = { sku: payload.sku, batch: item.batch, location: item.location, status };
    const sourceRow = findStockInData(draft, sourceKey) || (item.location ? (draft.stock || []).filter((stock) => stock.sku === payload.sku && stock.batch === item.batch && stock.location === item.location).length === 1 ? (draft.stock || []).find((stock) => stock.sku === payload.sku && stock.batch === item.batch && stock.location === item.location) : null : null);
    if (payload.type === "in") {
      upsertStockInData(draft, { sku: payload.sku, batch: item.batch, location: item.location, status, qty });
    } else if (payload.type === "out") {
      if (!sourceRow || Number(sourceRow.qty || 0) < qty) return { error: `Row ${item.lineNo}: stock is not enough` };
      const versionError = sourceRow && item.expectedVersion !== undefined && item.expectedVersion !== null && item.expectedVersion !== "" && Number(sourceRow.version || 1) !== Number(item.expectedVersion)
        ? "Stock data has changed. Refresh and try again."
        : null;
      if (versionError) return { error: versionError };
      sourceRow.qty = roundQty(Number(sourceRow.qty || 0) - qty);
      sourceRow.version = Number(sourceRow.version || 0) + 1;
      sourceRow.updatedAt = new Date().toISOString();
    } else if (payload.type === "move") {
      const targetLocation = item.targetLocation;
      const target = (draft.locations || []).find((location) => location.code === targetLocation);
      if (!sourceRow || Number(sourceRow.qty || 0) < qty) return { error: `Row ${item.lineNo}: stock is not enough` };
      const versionError = sourceRow && item.expectedVersion !== undefined && item.expectedVersion !== null && item.expectedVersion !== "" && Number(sourceRow.version || 1) !== Number(item.expectedVersion)
        ? "Stock data has changed. Refresh and try again."
        : null;
      if (versionError) return { error: versionError };
      if (!target) return { error: `Row ${item.lineNo}: invalid target location` };
      if (isFrozenLocationStatus(target.status)) return { error: `Row ${item.lineNo}: target location is frozen` };
      if (targetLocation === item.location) return { error: `Row ${item.lineNo}: target location cannot equal source location` };
      sourceRow.qty = roundQty(Number(sourceRow.qty || 0) - qty);
      sourceRow.version = Number(sourceRow.version || 0) + 1;
      sourceRow.updatedAt = new Date().toISOString();
      upsertStockInData(draft, { sku: payload.sku, batch: item.batch, location: targetLocation, status, qty });
    }
    addLogToData(draft, {
      type: payload.type,
      sku: payload.sku,
      name: payload.name,
      batch: item.batch,
      qty,
      location: item.location,
      targetLocation: item.targetLocation,
      status,
      note: item.note || ""
    });
  }
  removeZeroStockFromData(draft);
  refreshLocationUsageInData(draft);
  Object.assign(state, draft);
  saveState();
  return { ok: true };
}

function refreshLocationUsage() {
  state.locations.forEach((location) => {
    if (!isFrozenLocationStatus(location.status)) {
      location.status = locationUsageStatus(state.stock.some((item) => item.location === location.code));
    }
  });
}

function addLog(payload) {
  const user = currentUser();
  state.logs.unshift({
    id: uid(),
    operatorId: user?.id || "",
    operatorName: user?.name || "",
    operator: user ? `${user.id} ${user.name || user.id}` : "Not selected",
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
  if (!overridePayload && batchModeEnabled()) {
    const batchPayload = buildBatchOperationPayload();
    if (batchPayload.error) return showToast(batchPayload.error);
    openOperationConfirm(batchPayload);
    return;
  }
  const inputSku = normalize($("#skuInput").value);
  const material = findMaterial($("#skuInput").value) ||
    (selectedOperationSourceMatches(inputSku, normalize($("#batchInput").value), normalizeStockStatus($("#statusInput").value || getDefaultStockStatus()))
      ? { sku: selectedOperationStock.sku, name: selectedOperationStock.name }
      : null);
  const sku = material?.sku || "";
  const batch = normalize($("#batchInput").value);
  const rawQty = $("#qtyInput").value;
  const qty = parseSystemQty(rawQty);
  const location = normalize($("#locationInput").value);
  const targetLocation = normalize($("#targetLocationInput").value);
  const status = normalizeStockStatus($("#statusInput").value || getDefaultStockStatus());
  const note = $("#noteInput").value.trim();

  if (!material) return showToast("Material must be selected from master data");
  if (!findLocation(location)) return showToast("Location must be selected from master data");
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (qty <= 0) return showToast(operationType === "in" ? "Inbound quantity must be greater than 0" : "Quantity must be greater than 0");
  const selectedRow = selectedOperationSourceMatches(sku, batch, status) ? selectedOperationStock : null;
  if (["out", "move"].includes(operationType)) {
    if (!selectedRow) return showToast("Select a stock detail first");
    if (qty > Number(selectedRow.qty || 0)) return showToast("Quantity cannot exceed available stock");
  }
  if (operationType === "move") {
    if (!targetLocation || !findLocation(targetLocation)) return showToast("Select a valid target location");
    if (isFrozenLocationStatus(findLocation(targetLocation)?.status)) return showToast("Target location is frozen");
    if (targetLocation === (selectedRow?.location || location)) return showToast("Target location cannot equal source location");
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
        return showToast("Operation submitted");
      }
    } catch (error) {
      return showToast(error.message);
    }

    if (operationType === "in") {
      if (qty <= 0) return showToast("Inbound quantity must be greater than 0");
      upsertStock({ sku, batch, location, status, qty });
    }

    if (operationType === "out") {
      if (qty <= 0) return showToast("Outbound quantity must be greater than 0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("Stock is not enough or status does not match");
      row.qty = roundQty(row.qty - qty);
      touchStock(row);
    }

    if (operationType === "move") {
      if (qty <= 0) return showToast("Move quantity must be greater than 0");
      const row = findStock(sku, batch, selectedRow?.location || location, status);
      if (!row || row.qty < qty) return showToast("Source location stock is not enough");
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
    showToast("Operation submitted");
  } finally {
    setFormSubmitting(event.target, false);
  }
}

function buildBatchOperationPayload() {
  const sku = normalize($("#skuInput").value);
  const material = findMaterial($("#skuInput").value);
  const batchRows = parseBatchOperationRows($("#batchRowsInput").value);
  const note = $("#noteInput").value.trim();
  if (!material) return { error: "Material must be selected from master data" };
  if (!sku) return { error: "SKU is required" };
  if (!batchRows.length) return { error: "Add at least one batch row" };

  const batchItems = [];
  const seenKeys = new Set();
  for (const row of batchRows) {
    if (operationType === "move") {
      if (row.parts.length < 4) return { error: `Row ${row.lineNo} is invalid` };
    } else {
      if (row.parts.length < 3) return { error: `Row ${row.lineNo} is invalid` };
    }
    const [batch, location, qtyText, targetLocation = "", rowNote = "", rowStatus = ""] = row.parts;
    const normalizedBatch = normalize(batch);
    const normalizedLocation = normalize(location);
    const normalizedTarget = normalize(targetLocation);
    const qty = parseSystemQty(qtyText);
    const status = rowStatus ? normalizeStockStatus(rowStatus) : getDefaultStockStatus();
    if (!normalizedBatch) return { error: `Row ${row.lineNo}: batch is required` };
    if (!normalizedLocation) return { error: `Row ${row.lineNo}: location is required` };
    if (qty === null) return { error: `Row ${row.lineNo}: ${qtyErrorText(qtyText)}` };
    if (operationType !== "count" && qty <= 0) return { error: `Row ${row.lineNo}: quantity must be greater than 0` };
    if (operationType === "in" && !findLocation(normalizedLocation)) return { error: `Row ${row.lineNo}: invalid location` };
    if (operationType === "move") {
      if (!normalizedTarget) return { error: `Row ${row.lineNo}: target location is required` };
      if (!findLocation(normalizedTarget)) return { error: `Row ${row.lineNo}: invalid target location` };
      if (isFrozenLocationStatus(findLocation(normalizedTarget)?.status)) return { error: `Row ${row.lineNo}: target location is frozen` };
      if (normalizedTarget === normalizedLocation) return { error: `Row ${row.lineNo}: target location cannot equal source location` };
    }

    const key = `${sku}__${normalizedBatch}__${normalizedLocation}__${status}`;
    if (seenKeys.has(key)) return { error: `Row ${row.lineNo}: duplicate stock detail` };
    seenKeys.add(key);

    const sourceRow = operationType === "in"
      ? null
      : findStock(sku, normalizedBatch, normalizedLocation, status) || findUniqueStockRow(sku, normalizedBatch, normalizedLocation);
    if (["out", "move"].includes(operationType) && !sourceRow) {
      return { error: `Row ${row.lineNo}: stock detail not found` };
    }
    if (["out", "move"].includes(operationType) && qty > Number(sourceRow.qty || 0)) {
      return { error: `Row ${row.lineNo}: stock is not enough` };
    }

    batchItems.push({
      lineNo: row.lineNo,
      sku,
      name: material.name || "",
      batch: normalizedBatch,
      location: normalizedLocation,
      targetLocation: normalizedTarget,
      qty,
      note: rowNote || note,
      status,
      expectedVersion: sourceRow?.version || 1
    });
  }

  return {
    type: operationType,
    sku,
    name: material.name || "",
    batchItems
  };
}

async function submitBatchOperation(event, payload) {
  setFormSubmitting(event.target, true);
  try {
    const remote = await postOperationBatch(payload);
    if (remote) {
      resetOperationForm(event.target);
      selectedOperationVersion = null;
      selectedOperationStock = null;
      render();
      showToast("Operation submitted");
      return;
    }
    const localResult = applyBatchOperationLocally(payload);
    if (localResult?.error) return showToast(localResult.error);
    resetOperationForm(event.target);
    selectedOperationVersion = null;
    selectedOperationStock = null;
    render();
    showToast("Operation submitted");
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
  const keyword = $("#operationStockSearch").value.trim().toLowerCase();
  return state.stock.filter((item) => {
    const itemMaterial = findMaterial(item.sku);
    const haystack = `${item.sku} ${itemMaterial?.name || ""} ${item.batch} ${item.location} ${item.status}`.toLowerCase();
    if (!fuzzyMatchText(haystack, keyword)) return false;
    if (sku && item.sku !== sku) return false;
    if (batch && item.batch !== batch) return false;
    if (location && item.location !== location) return false;
    return true;
  });
}

function updateOperationStockList() {
  const useStockPicker = ["out", "move"].includes(operationType) && !batchModeEnabled();
  $("#operationStockWrap").classList.toggle("hidden", !useStockPicker);
  $("#batchRowsWrap")?.classList.toggle("hidden", !batchModeEnabled());
  $$(".operation-field").forEach((item) => item.classList.toggle("hidden", useStockPicker));
  $("#operationStatusWrap")?.classList.add("hidden");
  $("#targetLocationWrap").classList.toggle("hidden", operationType !== "move");
  $("#operationStockHint").textContent = operationType === "move" ? "Search and select stock to move." : "Search and select stock to issue.";
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
  $("#operationStockList").innerHTML = `<div class="empty-state">Loading stock...</div>`;
  try {
    const material = findMaterial($("#skuInput").value);
    const data = await fetchApiPage("/api/stock", {
      query: $("#operationStockSearch").value.trim(),
      sku: material?.sku || "",
      batch: normalize($("#batchInput").value),
      location: normalize($("#locationInput").value),
      status: "",
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
              <span>${escapeHtml(item.sku)} / ${escapeHtml(item.name || material?.name || "")} / ${escapeHtml(item.batch)}</span>
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
  $("#qtyInput").placeholder = `Max ${card.dataset.qty}`;
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
  const status = normalizeStockStatus($("#statusInput").value || getDefaultStockStatus());
  const row = selectedOperationMatches(sku, batch, location, status) ? selectedOperationStock : findStock(sku, batch, location, status);
  $("#selectedStockInfo").classList.toggle("hidden", !row);
  $("#selectedStockInfo").innerHTML = row
    ? `<strong>Selected stock detail</strong>
      <span>Material: ${escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>Batch: ${escapeHtml(batch)} / Location: ${escapeHtml(location)}</span>
      <span>Available stock: ${row.qty}. Enter quantity below.</span>`
    : "";
  updateOperationHelper();
}

function operationEmptyText() {
  const keyword = $("#operationStockSearch")?.value.trim();
  if (!keyword) return "Scan or enter material code, batch, or location to search stock.";
  return "No processable stock found. Check material code, batch, or location.";
}

function updateOperationHelper() {
  const guide = $("#operationGuide");
  const qtyHint = $("#qtyHint");
  const qtyInput = $("#qtyInput");
  const submitButton = $("#operationSubmitButton");
  if (!guide || !qtyHint || !qtyInput || !submitButton) return;

  const labels = { in: "Inbound", out: "Outbound", move: "Move" };
  const batchMode = batchModeEnabled();
  const steps = {
    in: batchMode ? ["Select SKU", "Fill batch rows", "Confirm submit"] : ["Select material", "Select location", "Enter quantity", "Confirm submit"],
    out: batchMode ? ["Select SKU", "Fill batch rows", "Confirm submit"] : ["Select stock detail", "Enter quantity", "Confirm submit"],
    move: batchMode ? ["Select SKU", "Fill batch rows", "Confirm submit"] : ["Select stock detail", "Enter quantity", "Select target location", "Confirm submit"]
  }[operationType] || ["Fill data", "Confirm submit"];

  const inputSku = normalize($("#skuInput").value);
  const batch = normalize($("#batchInput").value);
  const location = normalize($("#locationInput").value);
  const status = normalizeStockStatus($("#statusInput").value || getDefaultStockStatus());
  const qty = parseSystemQty(qtyInput.value);
  const targetLocation = normalize($("#targetLocationInput").value);
  const selectedRow = selectedOperationSourceMatches(inputSku, batch, status) ? selectedOperationStock : null;

  let activeStep = 0;
  let ready = false;
  let nextText = "";
  if (batchMode) {
    const batchText = $("#batchRowsInput")?.value || "";
    const rows = parseBatchOperationRows(batchText);
    const skuReady = !!findMaterial($("#skuInput").value);
    activeStep = skuReady ? 1 : 0;
    if (skuReady && rows.length) activeStep = 2;
    ready = skuReady && rows.length > 0;
    nextText = ready ? "Review batch rows, then submit." : "Select SKU, then fill batch rows.";
    qtyInput.placeholder = "Batch mode uses rows below";
  } else if (operationType === "in") {
    if (findMaterial($("#skuInput").value)) activeStep = 1;
    if (findLocation(location)) activeStep = 2;
    if (qty !== null && qty > 0) activeStep = 3;
    delete qtyInput.dataset.maxQty;
    qtyInput.placeholder = "Example 1000 or 1000.123456";
    ready = !!findMaterial($("#skuInput").value) && !!findLocation(location) && !!batch && qty !== null && qty > 0;
    nextText = ready ? "Ready to confirm and submit inbound." : "Select material and location, then enter quantity.";
  } else {
    if (selectedRow) activeStep = 1;
    if (qty !== null && qty > 0 && selectedRow && qty <= Number(selectedRow.qty || 0)) activeStep = 2;
    if (operationType === "move" && findLocation(targetLocation) && targetLocation !== location) activeStep = 3;
    if (selectedRow) {
      qtyInput.dataset.maxQty = selectedRow.qty;
      qtyInput.placeholder = `Maks ${selectedRow.qty}`;
      if (selectedRow.location !== location) {
        nextText = `Stock at ${selectedRow.location} is selected. Enter quantity.`;
      } else if (qty !== null && qty > Number(selectedRow.qty || 0)) {
        nextText = "Quantity exceeds available stock. Reduce quantity.";
      } else if (operationType === "move" && targetLocation && targetLocation === location) {
        nextText = "Target location cannot equal source location.";
      } else {
        nextText = `Available stock ${selectedRow.qty}. Enter quantity.`;
      }
    } else {
      delete qtyInput.dataset.maxQty;
      qtyInput.placeholder = "Select stock detail first";
      nextText = operationType === "move" ? "Select stock detail to move." : "Select stock detail to issue.";
    }
    ready = !!selectedRow && qty !== null && qty > 0 && qty <= Number(selectedRow.qty || 0);
    if (operationType === "move") {
      const target = findLocation(targetLocation);
      ready = ready && !!target && targetLocation !== location && !isFrozenLocationStatus(target.status);
      if (isFrozenLocationStatus(target?.status)) nextText = "Target location is frozen. Select another location.";
    }
  }

  guide.innerHTML = steps.map((step, index) => `<span class="step-pill ${index <= activeStep ? "active" : ""}">${index + 1}. ${escapeHtml(step)}</span>`).join("");
  qtyHint.textContent = nextText;
  submitButton.textContent = `${labels[operationType] || "Operation"} / Submit`;
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
  const status = normalizeStockStatus($("#statusInput").value || getDefaultStockStatus());
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
  const status = $("#countStatusInput").value || getDefaultStockStatus();
  const rawQty = $("#countQtyInput").value;
  const qty = parseSystemQty(rawQty);
  const location = normalize($("#countLocationInput").value);
  const note = $("#countNoteInput").value.trim();

  if (!material) return showToast("Material must be selected from master data");
  if (!batch || qty === null) return showToast(qtyErrorText(rawQty));
  if (!status) return showToast("Select count status");
  if (!findLocation(location)) return showToast("Count location must be selected from master data");
  if (!selectedCountStock || selectedCountStock.sku !== sku || selectedCountStock.batch !== batch || selectedCountStock.status !== status) {
    return showToast("Select stock detail for count first");
  }
  const targetLocation = findLocation(location);
  if (selectedCountStock.location !== location && isFrozenLocationStatus(targetLocation?.status)) {
    return showToast("Count location is frozen. Select another location.");
  }

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
      return showToast("Count updated");
    }

    const sourceRow = findStock(
      selectedCountStock.sku,
      selectedCountStock.batch,
      selectedCountStock.location,
      selectedCountStock.status
    );
    if (!sourceRow) return showToast("Count stock detail has changed. Refresh and select again.");
    const beforeQty = sourceRow.qty;
    if (selectedCountStock.location === location) {
      sourceRow.qty = qty;
      touchStock(sourceRow);
    } else {
      sourceRow.qty = 0;
      touchStock(sourceRow);
      if (qty > 0) upsertStock({ sku, batch, location, status, qty });
    }

    addLog({
      type: "adjust",
      sku,
      batch,
      qty,
      beforeQty,
      location: selectedCountStock.location,
      targetLocation: selectedCountStock.location === location ? "" : location,
      status,
      note
    });
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
    showToast("Count updated");
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
  if (!keyword) return "Scan or enter material code, batch, or location to search count stock.";
  return "No count stock found. Check material code, batch, or location.";
}

function scheduleCountStockLoad() {
  clearTimeout(countStockTimer);
  countStockTimer = setTimeout(loadCountStockRows, 180);
}

async function loadCountStockRows() {
  const requestId = ++countStockRequestId;
  $("#countStockList").innerHTML = `<div class="empty-state">Loading stock...</div>`;
  try {
    const material = findMaterial($("#countSkuInput").value);
    const data = await fetchApiPage("/api/stock", {
      query: $("#countStockSearch").value.trim(),
      sku: material?.sku || "",
      batch: normalize($("#countBatchInput").value),
      status: "",
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
  return `${text} = ${total} locations.`;
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
            <small>${escapeHtml(item.batch)}</small>
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
    ? `<strong>Selected count detail</strong>
      <span>Material: ${escapeHtml(sku)} / ${escapeHtml(row.name || material?.name || "")}</span>
      <span>Batch: ${escapeHtml(batch)} / Source Location: ${escapeHtml(row.location)}</span>
      <span>Book qty: ${row.qty}. Enter actual quantity and actual location below.</span>`
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
  if (!selected) text = "Select stock detail for count first.";
  else if (qty === null) text = "Enter actual quantity. 0 is allowed, up to 6 decimals.";
  else if (!target) text = "Count location must be selected from master data.";
  else if (selected.location !== location && isFrozenLocationStatus(target.status)) {
    ready = false;
    text = "Count location is frozen. Select another location.";
  } else {
    const locationText = selected.location === location ? "Location unchanged" : `Location will change from ${selected.location} to ${location}`;
    text = `Book qty ${selected.qty}, actual qty ${qty}. ${locationText}.`;
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
  $("#statusInput").value = getDefaultStockStatus();
  $("#countStatusInput").value = getDefaultStockStatus();
  $("#batchModeInput").checked = false;
  $("#batchRowsInput").value = "";
  $("#materialNameInput").value = "";
  delete $("#qtyInput").dataset.maxQty;
  updateMaterialPicker();
  updateOperationHelper();
  updateOperationStockList();
}

function seedDemo() {
  if (serverRequired) return showToast("Demo data is not allowed on production service");
  if (!isAdmin()) return showToast("Admin only");
  state.materials = [
    { sku: "RM-1001", name: "Glycerin" },
    { sku: "PK-2030", name: "Outer Carton" },
    { sku: "FG-8801", name: "Sunscreen Finished Goods" }
  ];
  state.locations = [
    { code: "A-01-01", status: "Occupied" },
    { code: "A-01-02", status: "Empty" },
    { code: "B-02-01", status: "Occupied" },
    { code: "QC-HOLD", status: "Frozen" }
  ];
  state.stock = [
    { id: uid(), sku: "RM-1001", batch: "B20260501", location: "A-01-01", status: "available", qty: 120, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "PK-2030", batch: "P260528", location: "B-02-01", status: "available", qty: 560, version: 1, updatedAt: new Date().toISOString() },
    { id: uid(), sku: "FG-8801", batch: "F260527", location: "QC-HOLD", status: "pending", qty: 48, version: 1, updatedAt: new Date().toISOString() }
  ];
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: 3, location: "", targetLocation: "", status: "", note: "Demo data initialized" });
  addAuditLog({ action: "Load demo data", entity: "System data", key: "DEMO", before: null, after: { materials: state.materials.length, locations: state.locations.length, stock: state.stock.length }, note: "Demo data initialized" });
  refreshLocationUsage();
  saveState();
  render();
  showToast("Demo data loaded");
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
  $("#accountBadge").textContent = loggedIn ? `${currentUser().id} / ${roleLabel(currentUser().role)}` : labels.ui.notLoggedIn;
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
  const moveOption = $("#operationTypeInput")?.querySelector("option[value='move']");
  if (moveOption) {
    moveOption.hidden = !canUseMoveOperation();
    moveOption.disabled = !canUseMoveOperation();
  }
  if (!canUseMoveOperation() && operationType === "move") {
    operationType = "in";
    $("#operationTypeInput").value = "in";
  }
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
  if (action === "move" && !canUseMoveOperation()) {
    showToast("Hanya admin yang dapat memindahkan stok antar lokasi");
    return;
  }
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
  const batchItems = Array.isArray(payload.batchItems) ? payload.batchItems : null;
  const rows = batchItems
    ? [
        ["Action", batchOperationLabel(payload.type)],
        ["SKU", payload.sku],
        ["Rows", String(batchItems.length)],
        ["Qty total", String(roundQty(batchItems.reduce((sum, item) => sum + Number(item.qty || 0), 0)))],
        ["Batch", "Batch operation"]
      ]
    : [
        ["Action", typeLabel(payload.type)],
        ["Material", `${payload.sku}${payload.name || findMaterial(payload.sku)?.name ? ` / ${payload.name || findMaterial(payload.sku)?.name || ""}` : ""}`],
        ["Batch", payload.batch],
        ["Location", payload.type === "move" ? `${payload.location} -> ${payload.targetLocation || "-"}` : payload.location],
        ["Qty", payload.qty]
      ];
  $("#operationConfirmText").textContent = batchItems
    ? (displayLanguage === "zh" ? "提交前请核对批量明细。" : "Review batch rows before submit.")
    : (displayLanguage === "zh" ? "提交前请核对本次作业。" : "Review before submit.");
  $("#operationConfirmGrid").innerHTML = batchItems
    ? `
      <div class="confirm-row"><span>Batch mode</span><span>${escapeHtml(batchOperationLabel(payload.type))}</span></div>
      <div class="confirm-row"><span>SKU</span><span>${escapeHtml(payload.sku)}</span></div>
      <div class="confirm-row"><span>Rows</span><span>${escapeHtml(String(batchItems.length))}</span></div>
      <div class="confirm-row"><span>Total qty</span><span>${escapeHtml(String(roundQty(batchItems.reduce((sum, item) => sum + Number(item.qty || 0), 0))))}</span></div>
      <div class="confirm-row wide"><span>Details</span><span>${batchItems.map((item) => `${escapeHtml(item.batch)} / ${escapeHtml(item.location)} / ${escapeHtml(String(item.qty))}${item.targetLocation ? ` -> ${escapeHtml(item.targetLocation)}` : ""}`).join("<br>")}</span></div>`
    : rows.map(([label, value]) => `<div class="confirm-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`).join("");
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
  if (Array.isArray(payload.batchItems)) await submitBatchOperation(event, payload);
  else await submitOperation(event, payload);
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
    .filter((item) => !isFrozenLocationStatus(item.status))
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
  if ($("#holdCount")) $("#holdCount").textContent = state.stock.filter((item) => normalizeStockStatus(item.status) !== "available").length;
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
  $("#stockList").innerHTML = `<div class="empty-state">Loading stock...</div>`;
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
                  <span>${escapeHtml(item.name || material?.name || "Unknown material")}</span>
                  <span>Batch: ${escapeHtml(item.batch)}</span>
                  <span>Location: ${escapeHtml(item.location)}</span>
                </div>
                <div class="card-meta">
                  <b>${item.qty}</b>
                </div>
              </article>`;
          }).join("")}
        </div>`
      : `
      <div class="table-wrap">
        <table class="data-table stock-table">
          <thead>
            <tr>
              <th class="sortable-th ${stockSortClass("sku")}" data-stock-sort="sku">Material Code</th>
              <th class="sortable-th ${stockSortClass("name")}" data-stock-sort="name">Material Name</th>
              <th class="sortable-th ${stockSortClass("batch")}" data-stock-sort="batch">Batch</th>
              <th class="sortable-th ${stockSortClass("location")}" data-stock-sort="location">Location</th>
              <th class="num-cell sortable-th ${stockSortClass("qty")}" data-stock-sort="qty">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((item) => {
              const material = findMaterial(item.sku);
              return `
                <tr>
                  <td>${escapeHtml(item.sku)}</td>
                  <td>${escapeHtml(item.name || material?.name || "Unknown material")}</td>
                  <td>${escapeHtml(item.batch)}</td>
                  <td>${escapeHtml(item.location)}</td>
                  <td class="num-cell">${item.qty}</td>
                </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state">No stock data. Search material, batch, or location on the stock page.</div>`;
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
    <span>Showing ${from}-${to} / ${pageState.total}</span>
    <div class="pager-actions">
      <button class="ghost-button" type="button" data-${prefix}-page="prev" ${pageState.page <= 1 ? "disabled" : ""}>Prev</button>
      <span>${pageState.page} / ${pageState.pages}</span>
      <button class="ghost-button" type="button" data-${prefix}-page="next" ${pageState.page >= pageState.pages ? "disabled" : ""}>Next</button>
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
  $("#materialList").innerHTML = `<div class="empty-state">Loading...</div>`;
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
            <button class="secondary-button mini-action" type="button" data-edit-material="${escapeHtml(item.sku)}">Edit</button>
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
  $("#locationList").innerHTML = `<div class="empty-state">Loading...</div>`;
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
            <span>${Number(item.stockRows ?? state.stock.filter((stock) => stock.location === item.code).length)} rows</span>
          </div>
          <div class="card-meta">
            <span>${escapeHtml(locationStatusLabel(item.status))}</span>
            <button class="secondary-button mini-action" type="button" data-edit-location="${escapeHtml(item.code)}">Edit</button>
          </div>
        </article>`).join("")
    : emptyHtml();
}

function renderUsers() {
  $("#userList").innerHTML = state.users.length
    ? `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Account</th>
                <th>角色 / Role</th>
                <th>${labels.admin.accessScope}</th>
                <th>操作 / Action</th>
            </tr>
          </thead>
          <tbody>
              ${state.users.map((user) => `
              <tr>
                <td><strong>${escapeHtml(user.id)}</strong></td>
                <td>${escapeHtml(roleLabel(user.role))}</td>
                <td>${escapeHtml(permissionScope(user.role))}</td>
                <td>
                  <div class="button-row button-row-tight">
                    <button class="secondary-button mini-action" type="button" data-password-user="${escapeHtml(user.id)}">${labels.admin.changePassword}</button>
                    ${user.role === "admin"
                      ? `<span class="muted">${labels.admin.systemAdminLocked}</span>`
                      : `<button class="mini-danger" type="button" data-delete-user="${escapeHtml(user.id)}">${labels.admin.deleteAccount}</button>`}
                  </div>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`
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
  $("#logList").innerHTML = `<div class="empty-state">Loading log...</div>`;
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
              <th>Date</th>
              <th>Account</th>
              <th>Type</th>
              <th>Material Code</th>
              <th>Batch No.</th>
              <th>Location</th>
              <th>Target Location</th>
              <th>Status</th>
              <th class="num-cell">Qty</th>
              <th>Remark</th>
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
              <th>Date</th>
              <th>Account</th>
              <th>Object</th>
              <th>Action</th>
              <th>Key</th>
              <th>Before</th>
              <th>After</th>
              <th>Remark</th>
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
  return { in: "Inbound", out: "Outbound", move: "Move", count: "Stock Count", adjust: "Stock Adjustment", initial: "Initial Stock" }[type] || type;
}

function emptyHtml() {
  return $("#emptyTemplate").innerHTML;
}

function render() {
  applyLanguageLabels();
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

function setButtonBusy(button, busy, busyText = "Processing") {
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
      button.textContent = "Submitting";
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
      "Material Code": item.sku,
      "Material Name": item.name || material?.name || "",
      "Batch No.": item.batch,
      Qty: item.qty,
      "Location Code": item.location,
      Status: item.status
    };
  });
  downloadCsv(rows, `stock-export-${new Date().toISOString().slice(0, 10)}.csv`);
}

function downloadTemplate() {
  downloadCsv([{ "Material Code": "RM-1001", "Material Name": "Glycerin", "Batch No.": "B20260501", "Qty": "120", "Location Code": "A-01-01", "Status": "available" }], "stock-import-template.csv");
}

function downloadMaterialTemplate() {
  downloadCsv([{ "Material Code": "RM-1001", "Material Name": "Glycerin" }], "material-master-template.csv");
}

function downloadLocationTemplate() {
  downloadCsv([{ "Location Code": "A-01-01", Status: "Empty" }], "location-master-template.csv");
}

function downloadCsv(rows, filename) {
  const headers = Object.keys(rows[0] || { Empty: "" });
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
  if (!isAdmin()) return showToast("No permission");
  const rows = await readSelectedRows("#inventoryFile");
  if (!rows.length) return showToast("File has no import data");
  const report = validateInventoryRows(rows);
  renderImportReport("Initial stock validation report", report);
  if (!report.validRows) return showToast("No valid stock rows, please check the file");
  if (!confirm(importConfirmText("Initial Stock", report))) return;
  try {
    const remote = await postMasterData("/api/import-inventory", { rows });
    if (remote) {
      render();
      return showToast("Stock import submitted");
    }
  } catch (error) {
    return showToast(error.message);
  }
  const groupedRows = new Map();
  let rejected = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["Material Code", "Item Code", "sku", "SKU"]));
    const name = String(pickField(row, ["Material Name", "Item Name", "name"]) || "").trim();
    const batch = normalize(pickField(row, ["Batch No.", "Batch No.", "batch"]));
    const rawQty = pickField(row, ["Qty", "Quantity", "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["Location", "Location Code", "Warehouse Location", "Storage Location", "location"]));
    const status = normalizeStockStatus(pickField(row, ["Status", "stockStatus", "status"]) || getDefaultStockStatus());
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
    if (!findLocation(item.location)) state.locations.push({ code: item.location, status: "empty" });
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
  addLog({ type: "initial", sku: "IMPORT", batch: "", qty: imported, location: "", targetLocation: "", status: "", note: `Imported initial stock ${imported} rows, rejected ${rejected} rows` });
  addAuditLog({ action: "Import Initial Stock", entity: "Stock Import", key: "IMPORT", before: null, after: { imported, rejected, sourceRows: rows.length }, note: `Imported initial stock ${imported} rows, rejected ${rejected} rows` });
  saveState();
  render();
  showToast(`Imported ${imported} rows, rejected ${rejected} rows`);
}

async function importMaterials() {
  if (!isAdmin()) return showToast("No permission");
  const rows = await readSelectedRows("#materialFile");
  if (!rows.length) return showToast("File has no import data");
  const report = validateMaterialRows(rows);
  renderImportReport("Material master validation report", report);
  if (!report.validRows) return showToast("No valid material rows, please check the file");
  if (!confirm(importConfirmText("Master Material", report))) return;
  try {
    const remote = await postMasterData("/api/import-materials", { rows });
    if (remote) {
      render();
      return showToast("Material master import submitted");
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const sku = normalize(pickField(row, ["Material Code", "Item Code", "sku", "SKU"]));
    const name = String(pickField(row, ["Material Name", "Item Name", "name"]) || "").trim();
    if (!sku || !name) return;
    upsertMaterial({ sku, name });
    imported += 1;
  });
  addAuditLog({ action: "Import Material Master", entity: "Material Master Data", key: "IMPORT", before: null, after: { imported }, note: `Imported ${imported} material rows` });
  saveState();
  render();
  showToast(`Imported ${imported} material rows`);
}

async function importLocations() {
  if (!isAdmin()) return showToast("No permission");
  const rows = await readSelectedRows("#locationFile");
  if (!rows.length) return showToast("File has no import data");
  const report = validateLocationRows(rows);
  renderImportReport("Location master validation report", report);
  if (!report.validRows) return showToast("No valid location rows, please check the file");
  if (!confirm(importConfirmText("Location Master", report))) return;
  try {
    const remote = await postMasterData("/api/import-locations", { rows });
    if (remote) {
      render();
      return showToast("Location master import submitted");
    }
  } catch (error) {
    return showToast(error.message);
  }
  let imported = 0;
  rows.forEach((row) => {
    const code = normalize(row["Location"] || row["Location Code"] || row.location || row.code);
    const status = normalizeLocationStatus(row["Status"] || row.status || "empty");
    if (!code) return;
    const existing = findLocation(code);
    if (existing) existing.status = status;
    else state.locations.push({ code, status });
    imported += 1;
  });
  refreshLocationUsage();
  addAuditLog({ action: "Import Location Master", entity: "Location Master Data", key: "IMPORT", before: null, after: { imported }, note: `Imported ${imported} location rows` });
  saveState();
  render();
  showToast(`Imported ${imported} location rows`);
}

async function downloadBackup() {
  if (!isAdmin()) return showToast("No permission");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(apiErrorText(data, "Backup failed", "admin"));
    const filename = `wms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("Backup downloaded");
  } catch (error) {
    showToast(error.message);
  }
}

async function downloadAutoBackup() {
  if (!isAdmin()) return showToast("No permission");
  const auth = currentAuthPayload();
  try {
    const response = await fetch("/api/auto-backup", {
      headers: {
        Accept: "application/json",
        Authorization: auth.sessionToken ? `Bearer ${auth.sessionToken}` : ""
      }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(apiErrorText(data, "Auto backup download failed", "admin"));
    const filename = `wms-auto-backup-${new Date().toISOString().slice(0, 10)}.json`;
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    showToast("Auto backup downloaded");
  } catch (error) {
    showToast(error.message);
  }
}

async function restoreBackup() {
  if (!isAdmin()) return showToast("No permission");
  if (!requireLiveServer("restore backup")) return;
  const file = $("#restoreFile").files[0];
  if (!file) return showToast("Please select a backup JSON file");
  if (!confirm("Restoring backup will overwrite current stock, master data, accounts, and logs. Continue?")) return;
  try {
    const backup = JSON.parse(await readTextFile(file));
    const auth = currentAuthPayload();
    const response = await fetch("/api/restore-backup", {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({ backup, operatorId: auth.operatorId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(apiErrorText(data, "Restore failed", "admin"));
    const currentUserId = state.currentUserId;
    Object.assign(state, migrateState({ ...defaultState(), ...data }));
    state.currentUserId = currentUserId;
    wmsLocalStorage.setItem(storeKey, JSON.stringify(state));
    $("#restoreFile").value = "";
    render();
    showToast("Backup restored");
  } catch (error) {
    showToast(error.message || "Backup file cannot be read");
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
    const sku = normalize(pickField(row, ["Material Code", "Item Code", "sku", "SKU"]));
    const name = String(pickField(row, ["Material Name", "Item Name", "name"]) || "").trim();
    const batch = normalize(pickField(row, ["Batch No.", "batch"]));
    const rawQty = pickField(row, ["Qty", "Quantity", "qty"]);
    const qty = parseSystemQty(rawQty);
    const location = normalize(pickField(row, ["Location", "Location Code", "Warehouse Location", "Storage Location", "location"]));
    const status = String(pickField(row, ["Status", "stockStatus", "status"]) || getDefaultStockStatus()).trim();
    const reasons = [];
    if (!sku) reasons.push("Material code missing");
    if (!name) reasons.push("Material name missing");
    if (!batch) reasons.push("Batch missing");
    if (!location) reasons.push("Location missing");
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
    const sku = normalize(pickField(row, ["Material Code", "Item Code", "sku", "SKU"]));
    const name = String(pickField(row, ["Material Name", "Item Name", "name"]) || "").trim();
    const reasons = [];
    if (!sku) reasons.push("Material code missing");
    if (!name) reasons.push("Material name missing");
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
    const code = normalize(pickField(row, ["Location", "Location Code", "Warehouse Location", "Storage Location", "location", "code"]));
    if (!code) return addInvalid(report, index, ["Location code missing"]);
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
  if (report.invalidSamples.length < 8) report.invalidSamples.push(`Row ${index + 2}: ${reasons.join("; ")}`);
}

function renderImportReport(title, report) {
  const target = $("#importReport");
  if (!target) return;
  target.classList.remove("hidden");
  const invalid = report.invalidSamples.length ? `<br>${report.invalidSamples.map(escapeHtml).join("<br>")}` : "";
  target.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    Source rows: ${report.sourceRows}; valid: ${report.validRows}; invalid: ${report.invalidRows}; duplicate merged: ${report.duplicateRows}; final import: ${report.mergedRows}.
    ${report.totalQty ? `<br>Valid qty total: ${report.totalQty}` : ""}
    ${invalid}`;
}

function importConfirmText(title, report) {
  return `${title} import validation:\nSource rows: ${report.sourceRows}\nValid rows: ${report.validRows}\nInvalid rows: ${report.invalidRows}\nDuplicate merged: ${report.duplicateRows}\nFinal import: ${report.mergedRows}\nContinue importing valid rows?`;
}

async function readSelectedRows(selector) {
  const file = $(selector).files[0];
  if (!file) {
    showToast("Please select an Excel or CSV file");
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
  if (!isAdmin()) return showToast("No permission");
  const sku = normalize($("#newSku").value);
  const name = $("#newName").value.trim();
  const previousSku = editingMaterialSku;
  if (!sku || !name) return showToast("Material code and name are required");
  if (!previousSku && state.materials.some((item) => item.sku === sku)) return showToast("Material code already exists. Search it, then edit.");
  if (previousSku && previousSku !== sku && state.materials.some((item) => item.sku === sku)) return showToast("Material code already exists");
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
      addAuditLog({ action: existing ? (previousSku && previousSku !== sku ? "Edit material code" : "Edit material") : "Add material", entity: "Material Master Data", key: sku, before, after: { sku, name } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheMaterials([{ sku, name }]);
  materialPage.page = 1;
  resetMaterialEdit();
  render();
  showToast("Material master saved");
}

async function addLocation(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("No permission");
  const code = normalize($("#newLocation").value);
  const previousCode = editingLocationCode;
  const status = $("#newLocationStatus").value;
  if (!code) return showToast("Location code is required");
  if (!previousCode && state.locations.some((item) => item.code === code)) return showToast("Location code already exists. Search it, then edit.");
  if (previousCode && previousCode !== code && state.locations.some((item) => item.code === code)) return showToast("Location code already exists");
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
      addAuditLog({ action: existing ? (previousCode && previousCode !== code ? "Edit location code" : "Edit location") : "Add location", entity: "Location Master Data", key: code, before, after: findLocation(code) || { code, status } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  cacheLocations([{ code, status }]);
  locationPage.page = 1;
  resetLocationEdit();
  render();
  showToast("Location master saved");
}

function editMaterial(sku) {
  const material = findMaterial(sku);
  if (!material) return;
  editingMaterialSku = material.sku;
  $("#newSku").value = material.sku;
  $("#newName").value = material.name;
  $("#materialSaveButton").textContent = "Save Changes";
  $("#cancelMaterialEdit").classList.remove("hidden");
  $("#newName").focus();
}

function resetMaterialEdit() {
  editingMaterialSku = "";
  $("#materialForm").reset();
  $("#materialSaveButton").textContent = "Save";
  $("#cancelMaterialEdit").classList.add("hidden");
}

function editLocation(code) {
  const location = findLocation(code);
  if (!location) return;
  editingLocationCode = location.code;
  $("#newLocation").value = location.code;
  $("#newLocationStatus").value = locationStatusLabel(location.status || "Empty");
  $("#locationSaveButton").textContent = "Save Changes";
  $("#cancelLocationEdit").classList.remove("hidden");
  $("#newLocation").focus();
}

function resetLocationEdit() {
  editingLocationCode = "";
  $("#locationForm").reset();
  $("#locationSaveButton").textContent = "Save";
  $("#cancelLocationEdit").classList.add("hidden");
}

async function addUser(event) {
  event.preventDefault();
  if (!isAdmin()) return showToast("No permission");
  const id = normalize($("#newUserId").value);
  const existing = state.users.find((user) => user.id === id);
  const password = $("#newUserPassword").value.trim();
  const role = $("#newUserRole").value;
  const modules = normalizeModules($("#newUserModules").value);
  const user = { id, role, modules: modules.length ? modules : defaultModulesForRole(role) };
  if (!existing && !password) return showToast("New account requires a password");
  try {
    const remote = await postUserData("/api/users", { id, role: user.role, modules: user.modules, userPassword: password });
    if (!remote) {
      const before = existing ? { id: existing.id, role: existing.role, modules: existing.modules || [] } : null;
      if (existing) Object.assign(existing, user);
      else state.users.push(user);
      const afterUser = state.users.find((item) => item.id === id);
      addAuditLog({ action: existing ? "Edit account" : "Add account", entity: "Account Permissions", key: id, before, after: { id: afterUser.id, role: afterUser.role, modules: afterUser.modules || [] } });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  if (id.toLowerCase() === "admin" && password && sessionAuth.userId?.toLowerCase() === "admin") {
    sessionAuth = { ...sessionAuth, mustChangePassword: false };
    wmsSessionStorage.setItem(authKey, JSON.stringify(sessionAuth));
  }
  $("#newUserModules").value = "";
  $("#userForm").reset();
  render();
}

function openPasswordDialog(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  pendingPasswordUserId = user.id;
  $("#passwordDialogAccount").textContent = user.id;
  $("#passwordDialogRole").textContent = roleLabel(user.role);
  $("#passwordDialogNew").value = "";
  $("#passwordDialogConfirm").value = "";
  $("#passwordDialog").classList.remove("hidden");
  $("#passwordDialogNew").focus();
}

function closePasswordDialog() {
  pendingPasswordUserId = "";
  $("#passwordDialogNew").value = "";
  $("#passwordDialogConfirm").value = "";
  $("#passwordDialog").classList.add("hidden");
}

async function submitPasswordChange() {
  if (!isAdmin()) return showToast("No permission");
  if (!pendingPasswordUserId) return showToast("Select an account first");
  const newPassword = $("#passwordDialogNew").value.trim();
  const confirmPassword = $("#passwordDialogConfirm").value.trim();
  if (!newPassword) return showToast("Enter a new password");
  if (newPassword.length < 6) return showToast("Password must be at least 6 characters");
  if (newPassword !== confirmPassword) return showToast("Passwords do not match");
  const account = pendingPasswordUserId;
  if (!confirm(`Change password for account ${account}?`)) return;
  try {
    await postUserData("/api/users/password", {
      targetId: account,
      userPassword: newPassword
    });
    if (account.toLowerCase() === "admin" && sessionAuth.userId?.toLowerCase() === "admin") {
      saveSessionAuth(sessionAuth.userId, sessionAuth.token, sessionAuth.expiresAt, false);
    }
    showToast("Password changed");
    closePasswordDialog();
    render();
  } catch (error) {
    showToast(error.message || "Failed to change password");
  }
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
  setButtonBusy(button, true, "Logging in");
  try {
    debugLogin("sending /api/login");
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WMS-Lite-Lite": "1" },
      body: JSON.stringify({ userId, password })
    });
    const data = await response.json();
    debugLogin(`/api/login status ${response.status}`);
    if (!response.ok) throw new Error(apiErrorText(data, "Wrong account or password", "admin"));
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
      showToast("Administrator is still using the default password. Change it first.");
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
  if (!isAdmin()) return showToast("No permission");
  const target = state.users.find((user) => user.id === userId);
  if (target?.role === "admin") return showToast("Admin account cannot be deleted");
  if (!confirm(`Delete account ${userId}?\nThis account will not be able to log in after deletion.`)) return;
  try {
    const remote = await postUserData("/api/users/delete", { targetId: userId });
    if (!remote) {
      const before = state.users.find((user) => user.id === userId);
      state.users = state.users.filter((user) => user.id !== userId);
      if (state.currentUserId === userId) state.currentUserId = "";
      if (before) addAuditLog({ action: "Delete account", entity: "Account Permissions", key: userId, before: { id: before.id, role: before.role, modules: before.modules || [] }, after: null });
      saveState();
    }
  } catch (error) {
    return showToast(error.message);
  }
  render();
}

function editUserModules(userId) {
  openPasswordDialog(userId);
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
    if (!isAdmin() && !["operate", "count", "stock"].includes(button.dataset.view)) return showToast("No permission");
    if (!canOpenView(button.dataset.view)) return showToast("No permission");
    activateView(button.dataset.view);
  });
});

$("#operationTypeInput").addEventListener("change", (event) => {
  if (event.target.value === "move" && !canUseMoveOperation()) {
    showToast("No permission to move stock between locations");
    event.target.value = "in";
  }
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
$("#displayLanguageSelect")?.addEventListener("change", (event) => setDisplayLanguage(event.target.value));

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
$("#batchModeInput")?.addEventListener("change", () => {
  updateOperationStockList();
  updateOperationHelper();
});
$("#batchRowsInput")?.addEventListener("input", updateOperationHelper);
$("#operationStockSearch").addEventListener("input", updateOperationStockList);
$("#operationStockList").addEventListener("click", selectOperationStock);
$("#qtyInput").addEventListener("blur", (event) => {
  if (event.target.value && parseSystemQty(event.target.value) === null) showToast(qtyErrorText(event.target.value));
  const qty = parseSystemQty(event.target.value);
  const maxQty = Number(event.target.dataset.maxQty || 0);
  if (qty !== null && maxQty && qty > maxQty) showToast("Quantity cannot exceed available stock");
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
$("#importInventory").addEventListener("click", (event) => withButtonBusy(event.currentTarget, displayLanguage === "zh" ? "导入中" : "Importing", importInventory));
$("#importMaterials").addEventListener("click", (event) => withButtonBusy(event.currentTarget, displayLanguage === "zh" ? "导入中" : "Importing", importMaterials));
$("#importLocations").addEventListener("click", (event) => withButtonBusy(event.currentTarget, displayLanguage === "zh" ? "导入中" : "Importing", importLocations));
$("#downloadBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, "Backing up", downloadBackup));
$("#downloadAutoBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, displayLanguage === "zh" ? "下载中" : "Downloading", downloadAutoBackup));
$("#restoreBackup").addEventListener("click", (event) => withButtonBusy(event.currentTarget, displayLanguage === "zh" ? "恢复中" : "Restoring", restoreBackup));
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
  const passwordButton = event.target.closest("[data-password-user]");
  if (passwordButton) openPasswordDialog(passwordButton.dataset.passwordUser);
  const button = event.target.closest("[data-delete-user]");
  if (button) deleteUser(button.dataset.deleteUser);
});
$("#passwordDialogCancel").addEventListener("click", closePasswordDialog);
$("#passwordDialogSubmit").addEventListener("click", submitPasswordChange);
$("#passwordDialog").addEventListener("click", (event) => {
  if (event.target.id === "passwordDialog") closePasswordDialog();
});
window.addEventListener("storage", (event) => {
  if (event.key !== storeKey || !event.newValue) return;
  Object.assign(state, JSON.parse(event.newValue));
  setSyncStatus(displayLanguage === "zh" ? "已更新" : "Updated");
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
    setSyncStatus(displayLanguage === "zh" ? "已更新" : "Updated");
    render();
  });
}

setupInstallPrompt();
registerServiceWorker();
render();
initApiSync();



