# NOVATRIX — Quản lý kho và giao hàng

Ứng dụng web tiếng Việt để quản lý tồn kho, tạo đơn giao, cập nhật trạng thái và xem lịch sử hành trình. Backend dùng Node.js/Express; PostgreSQL lưu tài khoản, sản phẩm, đơn giao và lịch sử trạng thái. Giao diện được phục vụ từ cùng máy chủ với API.

## 1. Chạy ứng dụng trên máy tính

### Chuẩn bị

- Cài Node.js 22 trở lên và Git.
- Tạo một cơ sở dữ liệu PostgreSQL. Neon có gói miễn phí để học và thử nghiệm.
- Mở thư mục `E:\code` trong VS Code, chọn **Terminal → New Terminal** và dùng PowerShell.

### Tạo cấu hình riêng trên máy

Dán từng lệnh sau vào Terminal:

```powershell
Set-Location E:\code
Copy-Item .env.example .env
notepad .env
```

Trong cửa sổ Notepad, điền các giá trị thật vào `.env`:

- `DATABASE_URL`: chuỗi kết nối PostgreSQL từ Neon.
- `ADMIN_EMAIL`: email đăng nhập quản trị.
- `ADMIN_PASSWORD`: mật khẩu riêng dài ít nhất 12 ký tự.
- `SESSION_SECRET`: khóa ngẫu nhiên ít nhất 32 ký tự. Có thể tạo khóa bằng lệnh:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Lưu `.env` rồi đóng Notepad. Không tải `.env` lên GitHub và không gửi các giá trị trong tệp này qua cuộc trò chuyện.

### Cài thư viện và khởi chạy

```powershell
Set-Location E:\code
npm install
npm start
```

Mở `http://localhost:3000`, sau đó đăng nhập bằng `ADMIN_EMAIL` và `ADMIN_PASSWORD` đã đặt trong `.env`. Dừng máy chủ bằng `Ctrl+C` trong Terminal.

Khi kết nối cơ sở dữ liệu lần đầu, máy chủ tự tạo bảng, tài khoản quản trị và dữ liệu minh họa. Đổi `ADMIN_EMAIL` hoặc `ADMIN_PASSWORD` sau khi tài khoản đã được tạo sẽ không tự thay đổi tài khoản đó.

## 2. Đưa mã lên GitHub để triển khai

### Tạo kho riêng

1. Đăng nhập GitHub và tạo một repository **Private** tên `novatrix-inventory`.
2. Tạo kho trống; không chọn thêm README, `.gitignore` hoặc license.
3. Sao chép đường dẫn HTTPS của kho. Đường dẫn có dạng `https://github.com/TEN_TAI_KHOAN/novatrix-inventory.git`.

### Đẩy mã từ VS Code

Trong Terminal PowerShell, thay `TEN_TAI_KHOAN` trong lệnh cuối bằng tên tài khoản GitHub của bạn, rồi chạy:

```powershell
Set-Location E:\code
git add .
git config user.name "Tên hiển thị của bạn"
git config user.email "Email đã đăng ký GitHub"
git commit -m "Hoan thien NOVATRIX"
git remote add origin https://github.com/TEN_TAI_KHOAN/novatrix-inventory.git
git push -u origin main
```

`git config` ở đây chỉ áp dụng cho kho `E:\code`. Nếu Git báo đã có `origin`, dùng `git remote set-url origin https://github.com/TEN_TAI_KHOAN/novatrix-inventory.git` thay cho lệnh `git remote add origin`.

Tệp `.env` bị loại khỏi Git bởi `.gitignore`; chỉ `.env.example` với giá trị mẫu được đưa lên kho.

## 3. Triển khai trên Render và Neon

1. Tạo cơ sở dữ liệu PostgreSQL trên Neon. Sao chép connection string và giữ kín.
2. Đăng nhập Render, chọn **New → Blueprint** và kết nối repository GitHub riêng `novatrix-inventory`.
3. Render đọc cấu hình trong `render.yaml`. Khi được hỏi, nhập `DATABASE_URL`, `ADMIN_EMAIL` và `ADMIN_PASSWORD`. Render tự tạo `SESSION_SECRET`; không cần đăng giá trị bí mật lên GitHub.
4. Chờ trạng thái deploy thành công. Mở địa chỉ `https://...onrender.com`; đăng nhập bằng email và mật khẩu đã nhập trên Render.
5. Có thể kiểm tra máy chủ và cơ sở dữ liệu tại `https://TEN_DU_AN.onrender.com/api/health`. Kết quả hoạt động là `{"ok":true}`.

Render yêu cầu người dùng ít nhất 16 tuổi. Nếu bạn dưới 16 tuổi, phụ huynh hoặc người giám hộ cần đứng tên và quản lý tài khoản hosting. Không gửi mật khẩu, connection string, mã đăng nhập hay khóa bí mật trong cuộc trò chuyện.

## Tính năng

- Bảng điều khiển: tổng tồn kho, đơn đang giao, đơn hoàn tất và cảnh báo sắp hết.
- Quản lý sản phẩm: thêm sản phẩm, tìm kiếm và điều chỉnh tồn kho.
- Đơn giao: tạo đơn, kiểm tra tồn kho và trừ hàng bằng giao dịch cơ sở dữ liệu.
- Hành trình: cập nhật trạng thái và ghi lịch sử thời gian, vị trí.
- Báo cáo: tổng hợp và tải danh sách đơn giao dạng CSV.
- Đăng nhập quản trị: mật khẩu được băm, cookie phiên bảo vệ và giới hạn số lần đăng nhập.

## Giới hạn gói miễn phí

Dịch vụ web Render miễn phí có thể ngủ sau thời gian không có truy cập nên lần mở đầu có thể chậm. Neon miễn phí có giới hạn tài nguyên và có thể tạm dừng khi không hoạt động. Đây là cấu hình phù hợp để học và thử nghiệm; trước khi dùng trong hoạt động thật, cần chọn gói phù hợp và thiết lập sao lưu dữ liệu.
