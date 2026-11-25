# NOVATRIX — Quản lý kho và giao hàng

Ứng dụng tiếng Việt quản lý tồn kho, đơn giao và lịch sử trạng thái. Giao diện chạy bằng Cloudflare Workers Static Assets; API dùng Cloudflare Workers; dữ liệu lưu trong Cloudflare D1 (SQLite). Tài khoản quản trị được cấu hình bằng Worker secrets.

## Tính năng

- Tổng quan tồn kho, đơn đang giao, đã giao và cảnh báo sắp hết.
- Thêm và tìm kiếm sản phẩm; điều chỉnh tồn kho.
- Tạo đơn giao; D1 cập nhật tồn kho và ghi đơn trong một giao dịch.
- Cập nhật trạng thái và lưu lịch sử thời gian, vị trí.
- Báo cáo CSV.
- Đăng nhập quản trị bằng cookie HTTP-only, chữ ký HMAC, chống thử mật khẩu liên tiếp.
- Không chèn dữ liệu khách hàng giả vào database mới.

## Điều kiện tài khoản Cloudflare

Tài khoản Cloudflare cần do người lớn (18+) đứng tên và quản lý. Cloudflare nêu độ tuổi 18+ cho Website và Online Services; chính sách riêng của họ cũng nói dịch vụ không hướng tới người dưới 18 tuổi. Nhờ phụ huynh/người giám hộ quản lý tài khoản và chạy các lệnh đăng nhập/deploy. Không gửi API token hay secret qua cuộc trò chuyện.

## 1. Cài công cụ

Cài Node.js 22 trở lên và Git trên máy tính. Mở thư mục E:\code trong VS Code, chọn Terminal → New Terminal, rồi chạy:

    Set-Location E:\code
    npm install

## 2. Tạo D1 và cấu hình bí mật

Lệnh Wrangler đăng nhập cần được chạy bởi phụ huynh/người giám hộ trong tài khoản Cloudflare của họ:

    npx wrangler login
    npm run db:create

Lệnh tạo database sẽ thêm ID D1 và binding DB vào wrangler.jsonc. Tạo schema trong database local để chạy thử:

    npm run db:migrate:local

Tạo tệp bí mật dùng riêng cho phát triển local:

    Copy-Item .dev.vars.example .dev.vars
    notepad .dev.vars

Trong .dev.vars, đặt email quản trị, mật khẩu riêng dài ít nhất 12 ký tự và SESSION_SECRET ngẫu nhiên dài ít nhất 32 ký tự. Tạo khóa bằng:

    node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"

Không commit .dev.vars. Tệp này đã bị loại trừ bởi .gitignore.

## 3. Chạy thử local

    npm run dev

Mở URL local mà Wrangler in ra. Dừng bằng Ctrl+C.

## 4. Tạo schema production, nhập secrets và deploy

Dùng database D1 vừa tạo trên tài khoản Cloudflare của phụ huynh/người giám hộ:

    npm run db:migrate:prod
    npx wrangler secret put ADMIN_EMAIL
    npx wrangler secret put ADMIN_PASSWORD
    npx wrangler secret put SESSION_SECRET
    npm run deploy

Wrangler sẽ hỏi giá trị cho từng secret trực tiếp trong terminal. Không gửi các giá trị đó vào chat hoặc đưa chúng vào GitHub. SESSION_SECRET cần ít nhất 32 ký tự; tạo một giá trị ngẫu nhiên bằng lệnh Node ở bước trên.

Sau khi deploy thành công, Wrangler in ra địa chỉ workers.dev. Mở địa chỉ đó và đăng nhập. Kiểm tra API tại /api/health; kết quả cần có {"ok":true,"database":"connected"}.

## Giới hạn hiện tại

- Hành trình được cập nhật thủ công trong giao diện; chưa có GPS trực tiếp hoặc kết nối API hãng vận chuyển.
- Có một tài khoản quản trị từ secrets; chưa có nhiều vai trò, mời người dùng hoặc đặt lại mật khẩu.
- Giao diện tải toàn bộ danh sách đơn và sản phẩm; với dữ liệu lớn cần thêm phân trang.
- D1 phù hợp ứng dụng nhỏ và vừa; theo dõi quota, bật/kiểm tra khả năng khôi phục dữ liệu trước khi dùng nghiệp vụ thật.
