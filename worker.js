const encoder = new TextEncoder();
const decoder = new TextDecoder();
const sessionCookie = "novatrix_session";
const sessionTtlSeconds = 8 * 60 * 60;
const statuses = {
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

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}
function errorJson(message, status = 400) {
  return json({ error: message }, status);
}
function asText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function validDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function hmacKey(env) {
  const secret = String(env.SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signSession(user, env) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    id: user.id,
    email: user.email,
    expires: Date.now() + sessionTtlSeconds * 1000
  })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode(payload));
  return payload + "." + bytesToBase64Url(new Uint8Array(signature));
}
function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const item = header.split(";").map(part => part.trim()).find(part => part.startsWith(name + "="));
  return item ? item.slice(name.length + 1) : "";
}
async function readSession(request, env) {
  const token = readCookie(request, sessionCookie);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  try {
    const signature = base64UrlToBytes(token.slice(separator + 1));
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(env), signature, encoder.encode(payload));
    if (!valid) return null;
    const session = JSON.parse(decoder.decode(base64UrlToBytes(payload)));
    return session.expires > Date.now() ? session : null;
  } catch {
    return null;
  }
}
function cookieHeader(token) {
  return sessionCookie + "=" + token + "; Path=/; Max-Age=" + sessionTtlSeconds + "; HttpOnly; Secure; SameSite=Strict";
}
function clearCookieHeader() {
  return sessionCookie + "=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict";
}
async function hashText(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
async function rateLimitKey(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env), encoder.encode("login-rate:" + ip));
  return bytesToBase64Url(new Uint8Array(signature));
}
async function registerLoginAttempt(request, env) {
  const key = await rateLimitKey(request, env);
  const now = Math.floor(Date.now() / 1000);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM login_rate_limits WHERE window_start < ?").bind(now - 86400),
    env.DB.prepare(
      "INSERT INTO login_rate_limits (ip_hash, window_start, attempts) VALUES (?, ?, 1) " +
      "ON CONFLICT(ip_hash) DO UPDATE SET " +
      "attempts = CASE WHEN excluded.window_start - login_rate_limits.window_start >= 900 THEN 1 ELSE login_rate_limits.attempts + 1 END, " +
      "window_start = CASE WHEN excluded.window_start - login_rate_limits.window_start >= 900 THEN excluded.window_start ELSE login_rate_limits.window_start END " +
      "RETURNING attempts"
    ).bind(key, now)
  ]);
  return { key, attempts: Number(results[1].results?.[0]?.attempts || 1) };
}
async function clearLoginAttempts(key, env) {
  await env.DB.prepare("DELETE FROM login_rate_limits WHERE ip_hash = ?").bind(key).run();
}
async function parseJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 50000) throw new Error("Dữ liệu gửi lên quá lớn.");
  try {
    return await request.json();
  } catch {
    throw new Error("Dữ liệu JSON không hợp lệ.");
  }
}
function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    stock: Number(row.stock),
    minimum: Number(row.minimum),
    price: Number(row.price)
  };
}
function mapShipment(row, history) {
  return {
    id: row.display_id,
    recipient: row.recipient,
    phone: row.phone,
    address: row.address,
    product: row.product,
    quantity: Number(row.quantity),
    carrier: row.carrier,
    eta: row.eta,
    status: row.status,
    history,
    created_at: row.created_at
  };
}
async function getShipments(env) {
  const [shipmentsResult, historyResult] = await Promise.all([
    env.DB.prepare(
      "SELECT s.id AS shipment_id, s.display_id, s.recipient, s.phone, s.address, " +
      "p.name AS product, s.quantity, s.carrier, s.eta, s.status, s.created_at " +
      "FROM shipments s JOIN products p ON p.id = s.product_id " +
      "ORDER BY s.created_at DESC, s.id DESC"
    ).all(),
    env.DB.prepare(
      "SELECT shipment_id, status, status_label, note, location, happened_at " +
      "FROM shipment_history ORDER BY id ASC"
    ).all()
  ]);
  const historyByShipment = new Map();
  for (const event of historyResult.results || []) {
    const events = historyByShipment.get(Number(event.shipment_id)) || [];
    events.push({
      status: event.status,
      statusLabel: event.status_label,
      note: event.note,
      location: event.location,
      time: event.happened_at
    });
    historyByShipment.set(Number(event.shipment_id), events);
  }
  return (shipmentsResult.results || []).map(row =>
    mapShipment(row, historyByShipment.get(Number(row.shipment_id)) || [])
  );
}
async function login(request, env) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    return errorJson("Chưa cấu hình tài khoản quản trị trên Cloudflare.", 503);
  }
  const attempt = await registerLoginAttempt(request, env);
  if (attempt.attempts > 10) {
    return errorJson("Bạn đã thử đăng nhập quá nhiều lần. Hãy đợi 15 phút rồi thử lại.", 429);
  }
  let body;
  try {
    body = await parseJson(request);
  } catch (error) {
    return errorJson(error.message, 400);
  }
  const email = asText(body?.email, 254).toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const [expectedEmailHash, suppliedEmailHash, expectedPasswordHash, suppliedPasswordHash] = await Promise.all([
    hashText(String(env.ADMIN_EMAIL).trim().toLowerCase()),
    hashText(email),
    hashText(String(env.ADMIN_PASSWORD)),
    hashText(password)
  ]);
  const valid = equalBytes(expectedEmailHash, suppliedEmailHash) && equalBytes(expectedPasswordHash, suppliedPasswordHash);
  if (!valid) return errorJson("Email hoặc mật khẩu chưa đúng.", 401);
  await clearLoginAttempts(attempt.key, env);
  const adminEmail = String(env.ADMIN_EMAIL).trim().toLowerCase();
  const token = await signSession({ id: "admin", email: adminEmail }, env);
  return json({ user: { email: adminEmail } }, 200, { "Set-Cookie": cookieHeader(token) });
}
async function handleApi(request, env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/health" && request.method === "GET") {
    try {
      await env.DB.prepare("SELECT 1 FROM products LIMIT 1").first();
      return json({ ok: true, database: "connected" });
    } catch {
      return errorJson("D1 chưa được tạo hoặc chưa áp dụng migration.", 503);
    }
  }
  if (path === "/api/auth/login" && request.method === "POST") return login(request, env);
  if (path === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": clearCookieHeader() });
  }
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await readSession(request, env);
    if (!user) return errorJson("Bạn chưa đăng nhập.", 401);
    return json({ user: { id: user.id, email: user.email } });
  }
  const user = await readSession(request, env);
  if (!user) return errorJson("Phiên đăng nhập đã hết hạn.", 401);

  if (path === "/api/products" && request.method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, name, category, stock, minimum, price FROM products ORDER BY created_at DESC, id"
    ).all();
    return json({ products: (result.results || []).map(mapProduct) });
  }
  if (path === "/api/products" && request.method === "POST") {
    let body;
    try { body = await parseJson(request); } catch (error) { return errorJson(error.message, 400); }
    const name = asText(body?.name, 160);
    const category = asText(body?.category, 80);
    const stock = body?.stock;
    const minimum = body?.minimum;
    const price = body?.price;
    if (!name || !category || !validCount(stock) || !validCount(minimum) || !validCount(price)) {
      return errorJson("Vui lòng kiểm tra tên, danh mục, tồn kho, ngưỡng và giá sản phẩm.");
    }
    const id = "SP-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const result = await env.DB.prepare(
      "INSERT INTO products (id, name, category, stock, minimum, price) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, name, category, stock, minimum, price).run();
    if (Number(result.meta?.changes) !== 1) return errorJson("Không thể thêm sản phẩm.", 500);
    return json({ product: { id, name, category, stock, minimum, price } }, 201);
  }
  const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && request.method === "PATCH") {
    let body;
    try { body = await parseJson(request); } catch (error) { return errorJson(error.message, 400); }
    const stock = body?.stock;
    if (!validCount(stock)) return errorJson("Số lượng tồn phải là số nguyên không âm.");
    const id = decodeURIComponent(productMatch[1]);
    const result = await env.DB.prepare("UPDATE products SET stock = ? WHERE id = ?").bind(stock, id).run();
    if (Number(result.meta?.changes) !== 1) return errorJson("Không tìm thấy sản phẩm.", 404);
    const product = await env.DB.prepare(
      "SELECT id, name, category, stock, minimum, price FROM products WHERE id = ?"
    ).bind(id).first();
    return json({ product: mapProduct(product) });
  }
  if (path === "/api/shipments" && request.method === "GET") {
    return json({ shipments: await getShipments(env) });
  }
  if (path === "/api/shipments" && request.method === "POST") {
    let body;
    try { body = await parseJson(request); } catch (error) { return errorJson(error.message, 400); }
    const recipient = asText(body?.recipient, 160);
    const phone = asText(body?.phone, 40);
    const address = asText(body?.address, 500);
    const productId = asText(body?.productId, 40);
    const quantity = body?.quantity;
    const carrier = asText(body?.carrier, 80);
    const eta = asText(body?.eta, 10);
    if (!recipient || !phone || !address || !productId || !validPositiveInteger(quantity) || !carrier || !validDateOnly(eta)) {
      return errorJson("Vui lòng nhập đầy đủ và đúng thông tin đơn giao.");
    }
    const product = await env.DB.prepare("SELECT name FROM products WHERE id = ?").bind(productId).first();
    if (!product) return errorJson("Không tìm thấy sản phẩm.", 404);

    const displayId = "GH-" + crypto.randomUUID().toUpperCase();
    const location = address.split(",").at(-1).trim();
    const time = new Date().toISOString();
    const batch = await env.DB.batch([
      env.DB.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?")
        .bind(quantity, productId, quantity),
      env.DB.prepare(
        "INSERT INTO shipments (display_id, recipient, phone, address, product_id, quantity, carrier, eta, status) " +
        "SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'ready' WHERE changes() = 1"
      ).bind(displayId, recipient, phone, address, productId, quantity, carrier, eta),
      env.DB.prepare(
        "INSERT INTO shipment_history (shipment_id, status, status_label, note, location, happened_at) " +
        "SELECT id, 'ready', ?, ?, ?, ? FROM shipments WHERE display_id = ? AND changes() = 1"
      ).bind(statuses.ready, "Đơn hàng đã được tạo và chờ lấy hàng.", location, time, displayId)
    ]);
    if (Number(batch[0].meta?.changes) !== 1 || Number(batch[1].meta?.changes) !== 1) {
      return errorJson("Không đủ tồn kho cho số lượng này.", 409);
    }
    return json({
      shipment: {
        id: displayId, recipient, phone, address, product: product.name,
        quantity, carrier, eta, status: "ready",
        history: [{
          status: "ready",
          statusLabel: statuses.ready,
          note: "Đơn hàng đã được tạo và chờ lấy hàng.",
          location,
          time
        }]
      }
    }, 201);
  }
  const statusMatch = path.match(/^\/api\/shipments\/([^/]+)\/status$/);
  if (statusMatch && request.method === "PATCH") {
    let body;
    try { body = await parseJson(request); } catch (error) { return errorJson(error.message, 400); }
    const status = body?.status;
    if (typeof status !== "string" || !Object.hasOwn(statuses, status)) {
      return errorJson("Trạng thái đơn giao không hợp lệ.");
    }
    const displayId = decodeURIComponent(statusMatch[1]);
    const existing = await env.DB.prepare("SELECT id, address FROM shipments WHERE display_id = ?")
      .bind(displayId).first();
    if (!existing) return errorJson("Không tìm thấy đơn giao.", 404);
    const event = {
      status,
      statusLabel: statuses[status],
      note: statusNotes[status],
      location: existing.address.split(",").at(-1).trim(),
      time: new Date().toISOString()
    };
    const result = await env.DB.batch([
      env.DB.prepare("UPDATE shipments SET status = ? WHERE display_id = ?").bind(status, displayId),
      env.DB.prepare(
        "INSERT INTO shipment_history (shipment_id, status, status_label, note, location, happened_at) " +
        "SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1"
      ).bind(existing.id, status, event.statusLabel, event.note, event.location, event.time)
    ]);
    if (Number(result[0].meta?.changes) !== 1) return errorJson("Không tìm thấy đơn giao.", 404);
    return json({ shipment: { id: displayId, status, history: [event] } });
  }
  return errorJson("Không tìm thấy API này.", 404);
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (!path.startsWith("/api/") && path !== "/api") return env.ASSETS.fetch(request);
      return await handleApi(request, env);
    } catch (error) {
      console.error("Worker request failed:", error?.stack || error);
      return errorJson("Máy chủ gặp lỗi. Vui lòng thử lại.", 500);
    }
  }
};
