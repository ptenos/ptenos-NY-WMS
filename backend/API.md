# WMS Lite API

Base URL:

```text
http://SERVER_IP:4173/api
```

## Health

```http
GET /api/health
```

## State

```http
GET /api/state
```

`/api/state` is read-only. Do not overwrite inventory state directly.

## Master Data

```http
POST /api/materials
POST /api/locations
```

Material body:

```json
{
  "sku": "RM-1001",
  "name": "甘油"
}
```

Location body:

```json
{
  "code": "A-01-01",
  "status": "空闲"
}
```

## Warehouse Operation

```http
POST /api/operations
```

Body:

```json
{
  "type": "in",
  "operator": "WH-001",
  "sku": "RM-1001",
  "batch": "B20260501",
  "qty": 120,
  "location": "A-01-01",
  "targetLocation": "",
  "status": "可用",
  "expectedVersion": 1,
  "operatorId": "WH-001",
  "password": "123456",
  "note": "PO-001"
}
```

Supported operation types:

- `in`: 入库
- `out`: 出库
- `move`: 移库
- `count`: 盘点调整

Permission rules:

- employee: `in`, `out`
- keeper: `in`, `out`, `count`
- admin: all operations

For `out`, `move`, and `count`, send `expectedVersion` from the selected inventory row. If the row has already changed, the API rejects the operation and the user should refresh.

## Initial Inventory Import

```http
POST /api/import-inventory
POST /api/import-materials
POST /api/import-locations
```

Body:

```json
{
  "operator": "WH-001",
  "rows": [
    {
      "物料编码": "RM-1001",
      "物料名称": "甘油",
      "批号": "B20260501",
      "数量": 120,
      "库位": "A-01-01",
      "状态": "可用"
    }
  ]
}
```

Material import rows:

```json
{
  "operatorId": "admin",
  "password": "admin123",
  "rows": [
    {
      "物料编码": "RM-1001",
      "物料名称": "甘油"
    }
  ]
}
```

Location import rows:

```json
{
  "operatorId": "admin",
  "password": "admin123",
  "rows": [
    {
      "库位": "A-01-01",
      "状态": "空闲"
    }
  ]
}
```
