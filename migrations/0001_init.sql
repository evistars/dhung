CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 80),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  minimum INTEGER NOT NULL DEFAULT 0 CHECK (minimum >= 0),
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_products_created ON products (created_at DESC, id);

CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_id TEXT NOT NULL UNIQUE,
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 1 AND 160),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 1 AND 40),
  address TEXT NOT NULL CHECK (length(address) BETWEEN 1 AND 500),
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  carrier TEXT NOT NULL CHECK (length(carrier) BETWEEN 1 AND 80),
  eta TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'moving', 'delivering', 'done', 'issue')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_shipments_created ON shipments (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_product ON shipments (product_id);

CREATE TABLE IF NOT EXISTS shipment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('ready', 'moving', 'delivering', 'done', 'issue')),
  status_label TEXT NOT NULL,
  note TEXT NOT NULL,
  location TEXT NOT NULL,
  happened_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shipment_history_order ON shipment_history (shipment_id, id);

CREATE TABLE IF NOT EXISTS login_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
