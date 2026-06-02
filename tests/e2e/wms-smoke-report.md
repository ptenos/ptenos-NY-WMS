# WMS Lite Playwright Smoke Report

Target: https://2be8f2e2.ptenos-ny-wms.pages.dev/
Credentials: `admin / admin123`

## Result

Status: partial pass

## Passed

1. Login page loaded and login was possible after returning to a logged-out state.
2. Login succeeded and the top-right badge changed to `admin / 管理员`.
3. Business menu appeared: `作业`, `盘点`, `库存`, `导入`, `主数据`, `账号权限`, `流水账`, `修改记录`.
4. `服务器未连接` was not visible after login.
5. Inventory page, operation page, and logs page could be opened in the browser.
6. Console had no JavaScript errors during this smoke run.
7. No failed network requests were captured during this smoke run.

## Failed

1. The page still shows runtime/build diagnostic text in the body:
   `BUILD: runtime-parsefix-20260603 | render called after login`
2. The page still shows the default-password warning:
   `管理员仍在使用默认密码，请先修改密码`

## Screenshots

- `tests/e2e/artifacts/login-page.png`
- `tests/e2e/artifacts/after-login.png`
- `tests/e2e/artifacts/stock-page.png`
- `tests/e2e/artifacts/operation-page.png`
- `tests/e2e/artifacts/logs-page.png`

## Notes

The smoke run did not add a new test inventory record. It only verified the browser flow, navigation, and page state.
