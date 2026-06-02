# WMS Lite 数据库迁移方案

## 什么时候必须迁移

- 库存明细超过 5 万行，或流水超过 20 万行。
- 多人同时高频作业，频繁出现“库存已被其他人更新，请刷新后重试”。
- 需要按日期、物料、库位长期查询流水和审计记录。
- 需要每天自动备份到公司服务器或对象存储。

当前 Netlify Blob 适合试运行和小规模现场执行；正式长期使用建议迁到 PostgreSQL 或 MySQL。

## 推荐表结构

### users

| 字段 | 说明 |
| --- | --- |
| id | 账号 |
| name | 姓名 |
| role | employee / keeper / admin |
| password_hash | 密码哈希 |
| active | 是否启用 |
| created_at / updated_at | 创建和更新时间 |

### materials

| 字段 | 说明 |
| --- | --- |
| sku | 物料编码，唯一 |
| name | 物料名称 |
| created_at / updated_at | 创建和更新时间 |

### locations

| 字段 | 说明 |
| --- | --- |
| code | 库位编码，唯一 |
| status | 空闲 / 占用 / 冻结 |
| created_at / updated_at | 创建和更新时间 |

### stock

| 字段 | 说明 |
| --- | --- |
| id | 库存明细 ID |
| sku | 物料编码 |
| batch | 批号 |
| location | 库位 |
| status | 状态 |
| qty | 数量，decimal(20, 6) |
| version | 乐观锁版本号 |
| updated_at | 更新时间 |

唯一约束：`sku + batch + location + status`。

### stock_logs

| 字段 | 说明 |
| --- | --- |
| id | 流水 ID |
| time | 操作时间，Asia/Jakarta |
| operator_id / operator_name | 操作账号 |
| type | in / out / move / count |
| sku / batch / location / target_location / status | 作业信息 |
| qty / before_qty | 数量信息 |
| note | 备注 |

### audit_logs

| 字段 | 说明 |
| --- | --- |
| id | 审计 ID |
| time | 操作时间，Asia/Jakarta |
| operator_id / operator_name | 操作账号 |
| action / entity / key | 修改对象 |
| before_json / after_json | 修改前后内容 |
| note | 备注 |

## 迁移步骤

1. 先从系统下载 JSON 备份。
2. 建库并创建以上表结构。
3. 写一次性导入脚本，把 JSON 备份导入数据库。
4. 把 Netlify Function 的存储层从 Blob 切换为数据库查询。
5. 保留原接口路径不变，手机端不需要重新学习。
6. 上线前冻结导入和作业 10 分钟，完成最终备份和最终导入。
7. 切换后核对：物料数、库位数、库存行数、库存总数量、最近流水。

## 必须保留的规则

- 数量字段必须使用 `decimal(20, 6)`，不能用浮点数。
- 出库、移库、盘点必须在数据库事务中完成。
- 出库和移库必须校验库存版本号，防止多人同时扣同一笔库存。
- 流水和审计记录正式部署后只允许新增，不允许修改和删除。
- 物料编码、库位编码、批号按文本保存，不能被数字化处理。
