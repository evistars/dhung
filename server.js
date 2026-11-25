require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const { promisify } = require("node:util");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const scrypt = promisify(crypto.scrypt);
const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "";
const sessionCookie = "novatrix_session";
const sessionTtlSeconds = 8 * 60 * 60;
const statusLabels = {
  ready: "Chờ lấy hàng",
  moving: "Đang vận chuyển",
  delivering: "Đang giao",
  done: "Đã giao",
  issue: "Giao thất bại"
};
const statusNotes = {
  ready: "Đơn hàng đang chờ đơn vị vận chuyển lấy.",
  moving: "Kiện hàng đang được vận chuyển.",
  delivering: "Shipper đang giao hàng đến người nhận.",
  done: "Giao hàng thành công.",
  issue: "Giao hàng gặp sự cố, cần kiểm tra lại thông tin người nhận."
};

if (!process.env.DATABASE_URL) {
  throw new Error("Thiếu DATABASE_URL. Hãy tạo tệp .env theo .env.example.");
}
if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET phải có ít nhất 32 ký tự.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 15000
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "50kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Bạn đã thử đăng nhập quá nhiều lần. Hãy đợi 15 phút rồi thử lại." }
});

function asText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function validPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${Buffer.from(derived).toString("hex")}`;
}

async function checkPassword(password, storedHash) {
  const [saltHex, hashHex] = String(storedHash || "").split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, "hex"), expected.length));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function signSession(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    expires: Date.now() + sessionTtlSeconds * 1000
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || "";
  const item = cookieHeader.split(";").map(part => part.trim()).find(part => part.startsWith(`${sessionCookie}=`));
  if (!item) return null;
  let token;
  try {
    token = decodeURIComponent(item.slice(sessionCookie.length + 1));
  } catch {
    return null;
  }
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const providedSignature = Buffer.from(token.slice(separator + 1));
  const expectedSignature = Buffer.from(crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url"));
  if (providedSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(providedSignature, expectedSignature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.expires > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge: sessionTtlSeconds * 1000
  };
}

function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "Phiên đăng nhập đã hết hạn." });
  req.user = session;
  next();
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      minimum INTEGER NOT NULL DEFAULT 0 CHECK (minimum >= 0),
      price BIGINT NOT NULL DEFAULT 0 CHECK (price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shipments (
      id BIGSERIAL PRIMARY KEY,
      display_id TEXT NOT NULL UNIQUE,
      recipient TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      carrier TEXT NOT NULL,
      eta DATE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ready', 'moving', 'delivering', 'done', 'issue')),
      history JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE SEQUENCE IF NOT EXISTS product_number_seq START WITH 6");
  await pool.query("CREATE SEQUENCE IF NOT EXISTS shipment_number_seq START WITH 24088");

  const userCount = Number((await pool.query("SELECT COUNT(*) FROM users")).rows[0].count);
  if (userCount === 0) {
    const email = asText(process.env.ADMIN_EMAIL, 254).toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "";
    if (!email || password.length < 12) {
      throw new Error("Lần chạy đầu cần ADMIN_EMAIL và ADMIN_PASSWORD (tối thiểu 12 ký tự) trong .env.");
    }
    await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [email, await hashPassword(password)]);
  }

  const productCount = Number((await pool.query("SELECT COUNT(*) FROM products")).rows[0].count);
  if (productCount === 0) {
    const seedProducts = [
      ["SP-001", "Tai nghe Bluetooth Pro", "Điện tử", 128, 30, 890000],
      ["SP-002", "Bình giữ nhiệt 500ml", "Gia dụng", 86, 25, 245000],
      ["SP-003", "Bàn phím cơ K68", "Điện tử", 24, 30, 1290000],
      ["SP-004", "Đèn bàn LED thông minh", "Gia dụng", 57, 20, 475000],
      ["SP-005", "Sổ tay bìa da A5", "Văn phòng phẩm", 214, 50, 125000]
    ];
    for (const product of seedProducts) {
      await pool.query(
        "INSERT INTO products (id, name, category, stock, minimum, price) VALUES ($1, $2, $3, $4, $5, $6)",
        product
      );
    }
  }

  const shipmentCount = Number((await pool.query("SELECT COUNT(*) FROM shipments")).rows[0].count);
  if (shipmentCount === 0) {
    const today = new Date();
    const eta = offset => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
    const initialShipments = [
      ["GH-24087", "Nguyễn Hoàng Nam", "0903 456 789", "45 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh", "SP-001", 2, "Giao Hàng Nhanh", eta(1), "delivering", [{ status: "delivering", statusLabel: "Đang giao", note: "Shipper đang giao hàng đến người nhận.", location: "Quận 1, TP. Hồ Chí Minh", time: today.toISOString() }]],
      ["GH-24086", "Trần Thu Hà", "0912 321 654", "128 Lê Lợi, Hải Châu, Đà Nẵng", "SP-002", 1, "Viettel Post", eta(2), "moving", [{ status: "moving", statusLabel: "Đang vận chuyển", note: "Kiện hàng đang được vận chuyển.", location: "Đà Nẵng", time: today.toISOString() }]],
      ["GH-24085", "Lê Minh Khoa", "0987 111 222", "12 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội", "SP-003", 1, "GHN", eta(0), "done", [{ status: "done", statusLabel: "Đã giao", note: "Giao hàng thành công.", location: "Hoàn Kiếm, Hà Nội", time: today.toISOString() }]]
    ];
    for (const shipment of initialShipments) {
      const [displayId, recipient, phone, address, productId, quantity, carrier, expectedDate, status, history] = shipment;
      await pool.query(
        `INSERT INTO shipments (display_id, recipient, phone, address, product_id, quantity, carrier, eta, status, history)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
        [displayId, recipient, phone, address, productId, quantity, carrier, expectedDate, status, JSON.stringify(history)]
      );
    }
  }
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    sendError(res, 503, "Cơ sở dữ liệu chưa kết nối.");
  }
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const email = asText(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const result = await pool.query("SELECT id, email, password_hash FROM users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return sendError(res, 401, "Email hoặc mật khẩu chưa đúng.");
  }
  res.cookie(sessionCookie, signSession(user), cookieOptions());
  res.json({ user: { email: user.email } });
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) return sendError(res, 401, "Bạn chưa đăng nhập.");
  res.json({ user: { id: session.id, email: session.email } });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(sessionCookie, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/"
  });
  res.json({ ok: true });
});

app.use("/api", apiLimiter, requireAuth);

app.get("/api/products", async (req, res) => {
  const result = await pool.query(
    "SELECT id, name, category, stock, minimum, price FROM products ORDER BY created_at DESC, id"
  );
  res.json({ products: result.rows.map(row => ({ ...row, stock: Number(row.stock), minimum: Number(row.minimum), price: Number(row.price) })) });
});

app.post("/api/products", async (req, res) => {
  const name = asText(req.body?.name, 160);
  const category = asText(req.body?.category, 80);
  const stock = req.body?.stock;
  const minimum = req.body?.minimum;
  const price = req.body?.price;
  if (!name || !category || !validCount(stock) || !validCount(minimum) || !validCount(price)) {
    return sendError(res, 400, "Vui lòng kiểm tra tên, danh mục, tồn kho, ngưỡng và giá sản phẩm.");
  }

  const number = Number((await pool.query("SELECT nextval('product_number_seq') AS number")).rows[0].number);
  const id = `SP-${String(number).padStart(3, "0")}`;
  const result = await pool.query(
    "INSERT INTO products (id, name, category, stock, minimum, price) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, category, stock, minimum, price",
    [id, name, category, stock, minimum, price]
  );
  res.status(201).json({ product: result.rows[0] });
});

app.patch("/api/products/:id", async (req, res) => {
  const stock = req.body?.stock;
  if (!validCount(stock)) return sendError(res, 400, "Số lượng tồn phải là số nguyên không âm.");
  const result = await pool.query(
    "UPDATE products SET stock = $1 WHERE id = $2 RETURNING id, name, category, stock, minimum, price",
    [stock, asText(req.params.id, 30)]
  );
  if (!result.rowCount) return sendError(res, 404, "Không tìm thấy sản phẩm.");
  res.json({ product: result.rows[0] });
});

const shipmentSelect = `
  SELECT s.display_id AS id, s.recipient, s.phone, s.address, p.name AS product,
         s.quantity, s.carrier, s.eta::text AS eta, s.status, s.history, s.created_at
  FROM shipments s JOIN products p ON p.id = s.product_id
`;

app.get("/api/shipments", async (req, res) => {
  const result = await pool.query(`${shipmentSelect} ORDER BY s.created_at DESC, s.id DESC`);
  res.json({ shipments: result.rows.map(row => ({ ...row, quantity: Number(row.quantity) })) });
});

app.post("/api/shipments", async (req, res) => {
  const recipient = asText(req.body?.recipient, 160);
  const phone = asText(req.body?.phone, 40);
  const address = asText(req.body?.address, 500);
  const productId = asText(req.body?.productId, 30);
  const quantity = req.body?.quantity;
  const carrier = asText(req.body?.carrier, 80);
  const eta = asText(req.body?.eta, 10);
  if (!recipient || !phone || !address || !productId || !validPositiveInteger(quantity) || !carrier || !validDateOnly(eta)) {
    return sendError(res, 400, "Vui lòng nhập đầy đủ và đúng thông tin đơn giao.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stockResult = await client.query(
      "UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id",
      [quantity, productId]
    );
    if (!stockResult.rowCount) {
      await client.query("ROLLBACK");
      return sendError(res, 409, "Không đủ tồn kho cho số lượng này.");
    }
    const sequence = Number((await client.query("SELECT nextval('shipment_number_seq') AS number")).rows[0].number);
    const displayId = `GH-${String(sequence).padStart(5, "0")}`;
    const history = [{
      status: "ready",
      statusLabel: statusLabels.ready,
      note: "Đơn hàng đã được tạo và chờ lấy hàng.",
      location: "Kho trung tâm",
      time: new Date().toISOString()
    }];
    await client.query(
      `INSERT INTO shipments (display_id, recipient, phone, address, product_id, quantity, carrier, eta, status, history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9::jsonb)`,
      [displayId, recipient, phone, address, productId, quantity, carrier, eta, JSON.stringify(history)]
    );
    await client.query("COMMIT");
    const result = await pool.query(`${shipmentSelect} WHERE s.display_id = $1`, [displayId]);
    res.status(201).json({ shipment: { ...result.rows[0], quantity: Number(result.rows[0].quantity) } });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.patch("/api/shipments/:id/status", async (req, res) => {
  const status = req.body?.status;
  if (!Object.hasOwn(statusLabels, status)) return sendError(res, 400, "Trạng thái đơn giao không hợp lệ.");

  const existing = await pool.query("SELECT address FROM shipments WHERE display_id = $1", [asText(req.params.id, 30)]);
  if (!existing.rowCount) return sendError(res, 404, "Không tìm thấy đơn giao.");
  const location = existing.rows[0].address.split(",").at(-1).trim();
  const update = {
    status,
    statusLabel: statusLabels[status],
    note: statusNotes[status],
    location,
    time: new Date().toISOString()
  };
  const result = await pool.query(
    "UPDATE shipments SET status = $1, history = history || $2::jsonb WHERE display_id = $3 RETURNING display_id AS id, status, history",
    [status, JSON.stringify([update]), asText(req.params.id, 30)]
  );
  res.json({ shipment: result.rows[0] });
});

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.get("/script.js", (req, res) => res.sendFile(path.join(__dirname, "script.js")));
app.use("/api", (req, res) => sendError(res, 404, "Không tìm thấy API này."));

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = Number(error.status) || 500;
  res.status(status).json({ error: status >= 500 ? "Máy chủ gặp lỗi. Vui lòng thử lại." : error.message });
});

async function start() {
  await initializeDatabase();
  app.listen(port, "0.0.0.0", () => {
    console.log(`NOVATRIX đang chạy tại http://localhost:${port}`);
  });
}

start().catch(error => {
  console.error("Không thể khởi động NOVATRIX:", error.message);
  process.exit(1);
});
