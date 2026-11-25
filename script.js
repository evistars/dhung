let products = [];
let shipments = [];
let currentPage = "dashboard";
let searchText = "";

const labels = {
  ready: "Chờ lấy hàng",
  moving: "Đang vận chuyển",
  delivering: "Đang giao",
  done: "Đã giao",
  issue: "Giao thất bại"
};

const pages = {
  dashboard: ["Bảng điều khiển", dashboardPage],
  inventory: ["Kho hàng", inventoryPage],
  shipments: ["Đơn giao hàng", shipmentsPage],
  tracking: ["Hành trình giao", trackingPage],
  reports: ["Báo cáo", reportsPage]
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || "Không thể xử lý yêu cầu.");
    error.status = response.status;
    throw error;
  }

  return data;
}

function money(value) {
  return new Intl.NumberFormat("vi-VN").format(value) + " ₫";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function statusTag(status) {
  return `<span class="tag ${status}">${labels[status] || status}</span>`;
}

function heading(title, description, button = "") {
  return `
    <div class="page-heading">
      <div>
        <h1>${title}</h1>
        <p class="subtitle">${description}</p>
      </div>
      ${button}
    </div>`;
}

function dashboardPage() {
  const stockTotal = products.reduce((sum, product) => sum + product.stock, 0);
  const active = shipments.filter(order => !["done", "issue"].includes(order.status)).length;
  const delivered = shipments.filter(order => order.status === "done").length;
  const lowStock = products.filter(product => product.stock <= product.minimum).length;

  return `
    ${heading(
      "Bảng điều khiển",
      "Tổng quan tình hình kho hàng và giao nhận hôm nay.",
      `<button class="button primary" onclick="openShipmentForm()">+ Tạo đơn giao</button>`
    )}
    <div class="cards">
      <div class="card"><div class="metric-label">Tổng lượng hàng tồn</div><div class="metric-value">${stockTotal}</div><div class="metric-note">${products.length} mã sản phẩm</div></div>
      <div class="card"><div class="metric-label">Đơn đang vận chuyển</div><div class="metric-value">${active}</div><div class="metric-note">Đơn chưa giao xong</div></div>
      <div class="card"><div class="metric-label">Đã giao thành công</div><div class="metric-value">${delivered}</div><div class="metric-note">Trong ${shipments.length} đơn hàng</div></div>
      <div class="card"><div class="metric-label">Sắp hết hàng</div><div class="metric-value">${lowStock}</div><div class="metric-note">Cần kiểm tra và bổ sung</div></div>
    </div>
    <section class="section">
      <div class="section-heading"><h2>Đơn giao hàng gần đây</h2><button class="button" onclick="navigate('shipments')">Xem tất cả</button></div>
      ${shipmentTable(shipments.slice(0, 5))}
    </section>
    <section class="section">
      <div class="section-heading"><h2>Sản phẩm sắp hết hàng</h2><button class="button" onclick="navigate('inventory')">Quản lý kho</button></div>
      ${productTable(products.filter(product => product.stock <= product.minimum))}
    </section>`;
}

function productTable(list) {
  if (!list.length) return `<div class="empty">Không có sản phẩm phù hợp.</div>`;
  return `
    <div class="table-scroll"><table>
      <thead><tr><th>Mã hàng</th><th>Sản phẩm</th><th>Danh mục</th><th>Tồn kho</th><th>Ngưỡng</th><th>Đơn giá</th><th></th></tr></thead>
      <tbody>${list.map(product => `
        <tr>
          <td>${escapeHtml(product.id)}</td>
          <td><strong>${escapeHtml(product.name)}</strong></td>
          <td>${escapeHtml(product.category)}</td>
          <td>${product.stock} sản phẩm ${product.stock <= product.minimum ? statusTag("issue") : ""}</td>
          <td>${product.minimum}</td>
          <td>${money(product.price)}</td>
          <td><button class="button" onclick="changeStock('${escapeHtml(product.id)}')">Sửa tồn</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function shipmentTable(list) {
  if (!list.length) return `<div class="empty">Chưa có đơn giao hàng phù hợp.</div>`;
  return `
    <div class="table-scroll"><table>
      <thead><tr><th>Mã đơn</th><th>Người nhận</th><th>Sản phẩm</th><th>Đơn vị giao</th><th>Dự kiến giao</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
      <tbody>${list.map(order => `
        <tr>
          <td><strong>${escapeHtml(order.id)}</strong></td>
          <td>${escapeHtml(order.recipient)}<br><span class="metric-note">${escapeHtml(order.phone)}</span></td>
          <td>${escapeHtml(order.product)} × ${order.quantity}</td>
          <td>${escapeHtml(order.carrier)}</td>
          <td>${new Date(order.eta + "T12:00:00").toLocaleDateString("vi-VN")}</td>
          <td>${statusTag(order.status)}</td>
          <td><div class="row-actions">
            <select aria-label="Cập nhật trạng thái" onchange="updateStatus('${escapeHtml(order.id)}', this.value)">
              <option value="">Chọn trạng thái</option>
              ${Object.entries(labels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
            </select>
            <button class="button" onclick="showTracking('${escapeHtml(order.id)}')">Theo dõi</button>
          </div></td>
        </tr>`).join("")}</tbody>
    </table></div>`;
}

function inventoryPage() {
  const list = products.filter(product =>
    (product.name + product.id + product.category).toLowerCase().includes(searchText.toLowerCase())
  );
  return `
    ${heading("Quản lý kho hàng", "Theo dõi số lượng, danh mục và giá trị sản phẩm.", `<button class="button primary" onclick="openProductForm()">+ Thêm sản phẩm</button>`)}
    <div class="toolbar"><input placeholder="Tìm tên hoặc mã sản phẩm..." value="${escapeHtml(searchText)}" oninput="searchPage(this.value)"></div>
    <section class="section">${productTable(list)}</section>`;
}

function shipmentsPage() {
  const list = shipments.filter(order =>
    (order.id + order.recipient + order.product + order.address).toLowerCase().includes(searchText.toLowerCase())
  );
  return `
    ${heading("Đơn giao hàng", "Tạo đơn và cập nhật tình trạng giao hàng.", `<button class="button primary" onclick="openShipmentForm()">+ Tạo đơn giao</button>`)}
    <div class="toolbar"><input placeholder="Tìm mã đơn, người nhận..." value="${escapeHtml(searchText)}" oninput="searchPage(this.value)"></div>
    <section class="section">${shipmentTable(list)}</section>`;
}

function trackingPage() {
  const list = shipments.filter(order =>
    (order.id + order.recipient + order.address).toLowerCase().includes(searchText.toLowerCase())
  );
  return `
    ${heading("Theo dõi hành trình", "Tra cứu lịch sử cập nhật của các đơn giao.")}
    <div class="toolbar"><input placeholder="Nhập mã đơn hoặc người nhận..." value="${escapeHtml(searchText)}" oninput="searchPage(this.value)"></div>
    <div class="tracking-list">
      ${list.map(order => `
        <article class="card tracking-card">
          <div>
            <h3>${escapeHtml(order.id)} · ${escapeHtml(order.recipient)}</h3>
            <p>${escapeHtml(order.product)} × ${order.quantity} · ${escapeHtml(order.address)}</p>
            <div class="history">${(order.history || []).map(item => {
              const text = typeof item === "string"
                ? item
                : `${new Date(item.time).toLocaleString("vi-VN")} · ${item.statusLabel} · ${item.note}`;
              return `• ${escapeHtml(text)}`;
            }).join("<br>")}</div>
          </div>
          <div>${statusTag(order.status)}</div>
        </article>`).join("") || `<div class="card empty">Không tìm thấy đơn phù hợp.</div>`}
    </div>`;
}

function reportsPage() {
  const delivered = shipments.filter(order => order.status === "done").length;
  const failed = shipments.filter(order => order.status === "issue").length;
  const stockValue = products.reduce((sum, product) => sum + product.stock * product.price, 0);
  return `
    ${heading("Báo cáo", "Thống kê nhanh về kho hàng và giao nhận.", `<button class="button" onclick="exportCSV()">Tải báo cáo CSV</button>`)}
    <div class="cards">
      <div class="card"><div class="metric-label">Tổng sản phẩm</div><div class="metric-value">${products.length}</div></div>
      <div class="card"><div class="metric-label">Tổng đơn giao</div><div class="metric-value">${shipments.length}</div></div>
      <div class="card"><div class="metric-label">Giao thành công</div><div class="metric-value">${delivered}</div></div>
      <div class="card"><div class="metric-label">Giao thất bại</div><div class="metric-value">${failed}</div></div>
    </div>
    <section class="section"><div class="section-heading"><h2>Giá trị hàng tồn kho</h2><strong>${money(stockValue)}</strong></div></section>`;
}

function render() {
  document.getElementById("breadcrumb").textContent = pages[currentPage][0];
  document.querySelectorAll(".nav-button").forEach(button => {
    button.classList.toggle("active", button.dataset.page === currentPage);
  });
  document.getElementById("content").innerHTML = pages[currentPage][1]();
}

async function loadData() {
  const [productData, shipmentData] = await Promise.all([
    api("/api/products"),
    api("/api/shipments")
  ]);
  products = productData.products;
  shipments = shipmentData.shipments;
  render();
}

function navigate(page) {
  currentPage = page;
  searchText = "";
  render();
}

function searchPage(value) {
  searchText = value;
  const oldInput = document.querySelector("#content .toolbar input");
  const cursor = oldInput ? oldInput.selectionStart : value.length;
  render();
  const newInput = document.querySelector("#content .toolbar input");
  if (newInput) {
    newInput.focus();
    newInput.setSelectionRange(cursor, cursor);
  }
}

function showToast(message) {
  const root = document.getElementById("toast-root");
  root.innerHTML = `<div class="toast">${escapeHtml(message)}</div>`;
  setTimeout(() => { root.innerHTML = ""; }, 2800);
}

function showLogin(message = "") {
  const authRoot = document.getElementById("auth-root");
  document.getElementById("app-shell").hidden = true;
  authRoot.hidden = false;
  authRoot.innerHTML = `
    <form class="login-card card" id="login-form">
      <div class="brand login-brand">NOVA<span>TRIX</span></div>
      <h1>Đăng nhập quản lý</h1>
      <p class="subtitle">Đăng nhập để truy cập kho hàng và đơn giao.</p>
      <label for="login-email">Email quản trị</label>
      <input id="login-email" name="email" type="email" autocomplete="username" required>
      <label for="login-password">Mật khẩu</label>
      <input id="login-password" name="password" type="password" autocomplete="current-password" required>
      <p class="login-error" id="login-error">${escapeHtml(message)}</p>
      <button class="button primary login-submit" type="submit">Đăng nhập</button>
      <p class="login-help">Tài khoản quản trị được thiết lập trong cấu hình máy chủ.</p>
    </form>`;

  document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Đang đăng nhập…";
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      try {
        await showApp(result.user.email);
      } catch {
        showLogin("Đăng nhập được nhưng chưa tải được dữ liệu. Hãy thử lại sau.");
      }
    } catch (error) {
      const errorNode = document.getElementById("login-error");
      if (errorNode) errorNode.textContent = error.message;
      button.disabled = false;
      button.textContent = "Đăng nhập";
    }
  });
}

async function showApp(email) {
  document.getElementById("auth-root").hidden = true;
  document.getElementById("app-shell").hidden = false;
  document.getElementById("user-label").textContent = email;
  await loadData();
}

async function initialize() {
  document.querySelectorAll(".nav-button").forEach(button => {
    button.addEventListener("click", () => navigate(button.dataset.page));
  });
  document.getElementById("logout-button").addEventListener("click", logout);

  try {
    const result = await api("/api/auth/me");
    await showApp(result.user.email);
  } catch (error) {
    showLogin(error.status === 401 ? "" : "Không kết nối được máy chủ. Hãy kiểm tra cấu hình và thử lại.");
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch { /* Phiên có thể đã hết hạn. */ }
  products = [];
  shipments = [];
  showLogin("Bạn đã đăng xuất.");
}

function openProductForm() {
  document.getElementById("modal-root").innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <form class="modal" onsubmit="saveProduct(event)">
        <h2>Thêm sản phẩm</h2>
        <p class="modal-intro">Nhập thông tin mặt hàng mới vào kho.</p>
        <div class="form-grid">
          <div class="field full"><label>Tên sản phẩm</label><input name="name" maxlength="160" required></div>
          <div class="field"><label>Danh mục</label><input name="category" maxlength="80" required placeholder="Điện tử"></div>
          <div class="field"><label>Số lượng tồn</label><input name="stock" type="number" min="0" value="0" required></div>
          <div class="field"><label>Ngưỡng cảnh báo</label><input name="minimum" type="number" min="0" value="10" required></div>
          <div class="field"><label>Đơn giá (₫)</label><input name="price" type="number" min="0" value="0" required></div>
        </div>
        <div class="modal-actions"><button type="button" class="button" onclick="closeModal()">Hủy</button><button class="button primary">Lưu sản phẩm</button></div>
      </form>
    </div>`;
}

async function saveProduct(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    name: form.get("name"),
    category: form.get("category"),
    stock: Number(form.get("stock")),
    minimum: Number(form.get("minimum")),
    price: Number(form.get("price"))
  };
  try {
    await api("/api/products", { method: "POST", body: JSON.stringify(payload) });
    closeModal();
    await loadData();
    showToast("Đã thêm sản phẩm vào cơ sở dữ liệu.");
  } catch (error) { showToast(error.message); }
}

async function changeStock(id) {
  const product = products.find(item => item.id === id);
  const value = prompt(`Số lượng tồn mới của "${product.name}":`, product.stock);
  if (value === null || value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0) return;
  try {
    await api(`/api/products/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ stock: Number(value) })
    });
    await loadData();
    showToast("Đã cập nhật tồn kho.");
  } catch (error) { showToast(error.message); }
}

function openShipmentForm() {
  const available = products.filter(product => product.stock > 0);
  if (!available.length) return showToast("Kho hiện không có sản phẩm để giao.");

  document.getElementById("modal-root").innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)closeModal()">
      <form class="modal" onsubmit="saveShipment(event)">
        <h2>Tạo đơn giao hàng</h2>
        <p class="modal-intro">Số lượng sẽ được trừ khỏi tồn kho khi tạo đơn.</p>
        <div class="form-grid">
          <div class="field"><label>Người nhận</label><input name="recipient" maxlength="160" required></div>
          <div class="field"><label>Số điện thoại</label><input name="phone" maxlength="40" required></div>
          <div class="field full"><label>Địa chỉ giao hàng</label><textarea name="address" maxlength="500" required></textarea></div>
          <div class="field"><label>Sản phẩm</label><select name="productId">${available.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} (còn ${product.stock})</option>`).join("")}</select></div>
          <div class="field"><label>Số lượng</label><input name="quantity" type="number" min="1" value="1" required></div>
          <div class="field"><label>Đơn vị vận chuyển</label><select name="carrier"><option>Giao Hàng Nhanh</option><option>Viettel Post</option><option>J&amp;T Express</option><option>Giao Hàng Tiết Kiệm</option></select></div>
          <div class="field"><label>Ngày dự kiến giao</label><input name="eta" type="date" min="${new Date().toISOString().slice(0, 10)}" required></div>
        </div>
        <div class="modal-actions"><button type="button" class="button" onclick="closeModal()">Hủy</button><button class="button primary">Tạo đơn</button></div>
      </form>
    </div>`;
}

async function saveShipment(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    recipient: form.get("recipient"),
    phone: form.get("phone"),
    address: form.get("address"),
    productId: form.get("productId"),
    quantity: Number(form.get("quantity")),
    carrier: form.get("carrier"),
    eta: form.get("eta")
  };
  try {
    await api("/api/shipments", { method: "POST", body: JSON.stringify(payload) });
    closeModal();
    navigate("shipments");
    await loadData();
    showToast("Đã tạo đơn giao và cập nhật tồn kho.");
  } catch (error) { showToast(error.message); }
}

async function updateStatus(id, status) {
  if (!status) return;
  try {
    await api(`/api/shipments/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    await loadData();
    showToast("Đã cập nhật trạng thái đơn hàng.");
  } catch (error) { showToast(error.message); }
}

function showTracking(id) {
  currentPage = "tracking";
  searchText = id;
  render();
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function exportCSV() {
  const rows = [
    ["Mã đơn", "Người nhận", "Điện thoại", "Địa chỉ", "Sản phẩm", "Số lượng", "Đơn vị giao", "Trạng thái"],
    ...shipments.map(order => [order.id, order.recipient, order.phone, order.address, order.product, order.quantity, order.carrier, labels[order.status]])
  ];
  const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "bao-cao-giao-hang.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function showLoadingError() {
  const authRoot = document.getElementById("auth-root");
  authRoot.hidden = false;
  authRoot.innerHTML = `
    <div class="login-card card">
      <div class="brand login-brand">NOVA<span>TRIX</span></div>
      <h1>Không kết nối được máy chủ</h1>
      <p class="subtitle">Kiểm tra cấu hình cơ sở dữ liệu rồi tải lại trang.</p>
      <button class="button primary login-submit" onclick="location.reload()">Thử lại</button>
    </div>`;
}

document.querySelectorAll(".nav-button").forEach(button => {
  button.addEventListener("click", () => navigate(button.dataset.page));
});

initialize().catch(error => {
  console.error("Khởi tạo ứng dụng thất bại:", error);
  showLoadingError();
});
