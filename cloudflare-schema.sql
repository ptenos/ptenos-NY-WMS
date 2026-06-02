CREATE TABLE IF NOT EXISTS wms_state (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wms_backups (
  backup_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wms_stock (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  batch TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL,
  qty REAL NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wms_logs (
  id TEXT PRIMARY KEY,
  time TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  type TEXT NOT NULL,
  sku TEXT NOT NULL,
  batch TEXT NOT NULL,
  qty REAL NOT NULL,
  before_qty REAL,
  location TEXT NOT NULL,
  target_location TEXT,
  status TEXT NOT NULL,
  note TEXT,
  gps TEXT
);

CREATE TABLE IF NOT EXISTS wms_audit_logs (
  id TEXT PRIMARY KEY,
  time TEXT NOT NULL,
  operator_id TEXT NOT NULL,
  operator_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  key TEXT NOT NULL,
  before TEXT,
  after TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS wms_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
