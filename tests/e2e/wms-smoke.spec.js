import { test, expect } from "@playwright/test";

const baseUrl = process.env.WMS_E2E_URL || "https://2be8f2e2.ptenos-ny-wms.pages.dev/";
const userId = process.env.WMS_E2E_USER || "admin";
const password = process.env.WMS_E2E_PASSWORD || "admin123";

test("WMS Lite smoke flow", async ({ page }) => {
  const consoleErrors = [];
  const failedRequests = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText || "failed"}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: "tests/e2e/artifacts/login-page.png", fullPage: true });
  await expect(page.getByLabel("账号")).toBeVisible();
  await page.getByLabel("账号").fill(userId);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page.getByText("管理员").or(page.getByText("admin"))).toBeVisible();
  await expect(page.getByText("作业")).toBeVisible();
  await expect(page.getByText("盘点")).toBeVisible();
  await expect(page.getByText("库存")).toBeVisible();
  await expect(page.getByText("导入")).toBeVisible();
  await expect(page.getByText("主数据")).toBeVisible();
  await expect(page.getByText("账号权限")).toBeVisible();
  await expect(page.getByText("流水账")).toBeVisible();
  await expect(page.getByText("修改记录")).toBeVisible();
  await expect(page.getByText("服务器未连接")).toHaveCount(0);
  await expect(page.getByText("runtime.js not executed")).toHaveCount(0);

  await page.getByRole("button", { name: "库存" }).click();
  await expect(page.getByRole("heading", { name: "库存" })).toBeVisible();
  await page.screenshot({ path: "tests/e2e/artifacts/stock-page.png", fullPage: true });

  await page.getByRole("button", { name: "作业" }).click();
  await expect(page.getByRole("heading", { name: "作业" })).toBeVisible();
  await page.screenshot({ path: "tests/e2e/artifacts/operation-page.png", fullPage: true });

  await page.getByRole("button", { name: "流水账" }).click();
  await expect(page.getByRole("heading", { name: "出入库流水账" })).toBeVisible();
  await page.screenshot({ path: "tests/e2e/artifacts/logs-page.png", fullPage: true });

  await page.screenshot({ path: "tests/e2e/artifacts/after-login.png", fullPage: true });

  expect(consoleErrors, `Console errors: ${consoleErrors.join(" | ")}`).toEqual([]);
  expect(failedRequests, `Failed requests: ${failedRequests.join(" | ")}`).toEqual([]);
});
