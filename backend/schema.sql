CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  display_name VARCHAR(120) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'operator',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE materials (
  id BIGSERIAL PRIMARY KEY,
  sku VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  unit VARCHAR(40) NOT NULL DEFAULT 'pcs',
  status VARCHAR(40) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  area VARCHAR(80),
  status VARCHAR(40) NOT NULL DEFAULT '空闲',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory_batches (
  id BIGSERIAL PRIMARY KEY,
  material_id BIGINT NOT NULL REFERENCES materials(id),
  batch_no VARCHAR(120) NOT NULL,
  location_id BIGINT NOT NULL REFERENCES locations(id),
  stock_status VARCHAR(40) NOT NULL DEFAULT '可用',
  qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (material_id, batch_no, location_id, stock_status)
);

CREATE TABLE inventory_transactions (
  id BIGSERIAL PRIMARY KEY,
  tx_no VARCHAR(80) NOT NULL UNIQUE,
  tx_type VARCHAR(40) NOT NULL,
  material_id BIGINT REFERENCES materials(id),
  batch_no VARCHAR(120),
  from_location_id BIGINT REFERENCES locations(id),
  to_location_id BIGINT REFERENCES locations(id),
  stock_status VARCHAR(40),
  qty NUMERIC(18, 4) NOT NULL DEFAULT 0,
  before_qty NUMERIC(18, 4),
  after_qty NUMERIC(18, 4),
  operator_id BIGINT REFERENCES users(id),
  operator_name VARCHAR(120) NOT NULL,
  gps_lat NUMERIC(11, 7),
  gps_lng NUMERIC(11, 7),
  gps_accuracy INTEGER,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_jobs (
  id BIGSERIAL PRIMARY KEY,
  file_name VARCHAR(255) NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  operator_id BIGINT REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_inventory_batches_search
  ON inventory_batches (material_id, batch_no, location_id, stock_status);

CREATE INDEX idx_inventory_transactions_time
  ON inventory_transactions (created_at DESC);

CREATE INDEX idx_inventory_transactions_operator
  ON inventory_transactions (operator_id, created_at DESC);
