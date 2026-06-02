const runtimeProcess = globalThis.process || { argv: [], env: {} };
const baseUrl = (runtimeProcess.argv?.[2] || runtimeProcess.env?.WMS_BASE_URL || "https://ptenos-ny-wms.pages.dev").replace(/\/$/, "");
const userId = runtimeProcess.env?.WMS_SMOKE_USER || "admin";
const password = runtimeProcess.env?.WMS_SMOKE_PASSWORD || "admin123";

async function readJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} did not return JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${data?.error || text.slice(0, 120)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await readJson("/api/health");
assert(health.ok === true, "/api/health did not return ok:true");

const state = await readJson("/api/state?lite=1");
assert(state.summary && typeof state.summary === "object", "/api/state?lite=1 did not return summary");
assert(Array.isArray(state.users), "/api/state?lite=1 did not return users array");
assert(state.users.some((user) => user.id === userId), `/api/state?lite=1 does not include ${userId}`);

const login = await readJson("/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-WMS-Lite-Lite": "1" },
  body: JSON.stringify({ userId, password })
});
assert(login.user?.id === userId, "/api/login did not return the expected user");
assert(login.token, "/api/login did not return a session token");

console.log(`WMS Lite login smoke test passed: ${baseUrl} (${login.user.name || login.user.id})`);
