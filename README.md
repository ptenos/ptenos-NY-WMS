# WMS Lite

一个轻量级、移动端优先、实时库存和库位管理系统，不做复杂 ERP，只解决仓库现场执行和库存准确性问题。

## 当前功能

- 手机浏览器操作，可添加到手机桌面作为 PWA 使用，不需要先做原生 APP
- 作业、盘点、库存并列
- 作业支持入库、出库、移库
- 盘点显示现有库存数量和库位，并填写盘点数量和盘点库位
- 账号管理和三种角色权限
- 登录必须输入账号和密码
- 管理员可以新增账号、修改角色、修改密码、删除账号
- 员工：入库、出库、库存查看
- 仓管：入库、出库、盘点、库存查看
- 管理员：全部权限，包括移库、导入、主数据、账号权限、日志
- 物料编码、名称、批号、数量、库位、状态管理
- 物料和库位都从主数据搜索选择
- 库存可按库位、物料编码、物料名称、批号、状态搜索
- 库存可按当前搜索结果实时导出 CSV
- Excel 或 CSV 导入期初库存
- Excel 或 CSV 后续导入物料主数据、库位主数据
- 操作人、操作时间、操作日志追溯
- 入库、出库、移库、盘点通过独立操作接口处理
- 库存行带版本号，提交时校验版本，避免多人同时操作覆盖库存
- 盘点只调整选中的库存明细，不会按批号清空其他库位

## 数量格式规则

数量只允许系统标准数字格式：

```text
1000
1000.5
0.25
```

不允许印尼千分位或印尼小数格式：

```text
1.000
1.000,5
1000,5
```

前端录入、库存导入、后端 API 都会校验这个规则。

## 导入模板

库存导入：

```text
物料编码,物料名称,批号,数量,库位,状态
RM-1001,甘油,B20260501,120,A-01-01,可用
```

物料主数据：

```text
物料编码,物料名称
RM-1001,甘油
```

库位主数据：

```text
库位,状态
A-01-01,空闲
```

## 后端原型

已包含一个无依赖 Node.js 后端骨架：

```text
backend/server.js
backend/schema.sql
backend/API.md
```

在有标准 Node.js 的服务器上启动：

```text
cd backend
npm start
```

默认服务地址：

```text
http://服务器IP:4173/
```

当前后端用 `backend/data/wms-lite.json` 保存数据，适合小范围试用。正式上线建议按 `backend/schema.sql` 改为 MySQL 或 PostgreSQL。

## 第一阶段上线方式

第一阶段按移动端 Web/PWA 处理：

- 员工用手机浏览器访问服务器地址，例如 `https://wms.example.com/`
- 支持浏览器提示“安装”或“添加到主屏幕”，安装后像手机 APP 一样从桌面打开
- 页面外壳会缓存，网络短暂波动时仍能打开系统界面
- `/api/*` 库存接口不缓存，入库、出库、移库、盘点、导入和主数据维护必须连接服务器后才能提交
- 如果服务器不可用，系统会显示“服务器未连接”，并暂停所有写入按钮，避免手机本地账和服务器账不一致

上线前建议准备：

- HTTPS 域名或内网可信证书
- 固定服务器地址，手机访问不能使用 `127.0.0.1`
- 定时备份数据库和附件导入文件
- 管理员先导入物料主数据、库位主数据和期初库存，再开放员工账号
- 试运行 1-2 周后，再决定是否进入 Android 企业 APP 或 iOS 企业分发

## Netlify 部署

项目已带 Netlify 配置：

```text
netlify.toml
netlify/functions/api.mjs
scripts/build-netlify.mjs
```

部署逻辑：

- `npm run build` 只把前端文件复制到 `netlify-dist`
- Netlify 静态发布目录是 `netlify-dist`
- `/api/*` 请求交给 Netlify Function
- Function 使用 Netlify Blobs 的强一致读写和 ETag 条件写入保存库存状态
- 首次部署时，如果 Blobs 还没有数据，会用 `backend/data/wms-lite.json` 初始化当前库存

部署前置条件：

- Netlify 账号已登录或准备好 Personal Access Token
- Netlify 会安装 `package.json` 里的 `@netlify/blobs`
- 生产使用前建议先在 Netlify 后台确认 Blobs 数据已生成，并导出备份一份

CLI 部署命令：

```text
npm install
npx netlify deploy --prod --dir netlify-dist
```

如果使用 Git 连接 Netlify，Build command 填：

```text
npm run build
```

Publish directory 填：

```text
netlify-dist
```

Functions directory 会从 `netlify.toml` 读取：

```text
netlify/functions
```

注意：Netlify Blobs 适合第一阶段轻量试运行。多仓库、高并发、强审计的正式生产版本，建议升级到 Postgres / Netlify Database。

## Cloudflare Pages 迁移

当前项目已经补了一套 Cloudflare Pages 入口，静态页面和 API 可以分开部署：

- 静态输出目录：`cloudflare-dist`
- Pages Functions：`functions/api.js`
- 数据库：Cloudflare D1
- 备份表：`wms_backups`

建表脚本：

```text
cloudflare-schema.sql
```

Cloudflare Pages 项目建议配置：

- Build command: `npm run build:cloudflare`
- Build output directory: `cloudflare-dist`
- Functions directory: `functions`

首次迁移时要在 Cloudflare D1 中执行 `cloudflare-schema.sql`，然后把现有库存数据导入到 D1。  
如果你需要我继续推进，我会先把 GitHub 仓库整理好，再把 Cloudflare Pages 需要的变量、函数和部署说明补齐。

## 账务安全规则

- 不允许整包覆盖库存状态，`/api/state` 只读。
- 所有库存变化必须通过 `/api/operations`。
- 员工只能入库、出库。
- 仓管可以入库、出库、盘点。
- 管理员拥有全部权限，包括移库、导入和主数据维护。
- 出库、移库、盘点提交时会带库存版本号；如果库存已被别人更新，需要刷新后重试。

## 默认账号

```text
admin / admin123
WH-001 / 123456
WH-MGR / 123456
```

演示版密码以明文保存在本地 JSON 中。正式上线必须改为后端哈希加密存储。
