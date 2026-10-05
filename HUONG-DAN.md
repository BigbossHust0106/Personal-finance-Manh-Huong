# Tài chính gia đình: GitHub + Cloudflare

## Cấu trúc thư mục
```
wrangler.jsonc        cấu hình Cloudflare (tên Worker phải là ancient-voice-154b)
supabase-setup.sql    câu lệnh tạo database (đã chạy rồi, chỉ để lưu)
public/
  index.html          trang web  <- file này thay đổi khi nâng cấp
  config.js           khoá Supabase (đã điền sẵn, ít khi phải sửa)
  manifest.webmanifest, sw.js, icon-192.png, icon-512.png   (cài như app)
```

## 1. Đưa lên GitHub (không cần dòng lệnh)
1. Vào github.com > **New repository**. Đặt tên (ví dụ `tai-chinh-gia-dinh`), chọn **Private**, bấm Create.
2. Trong trang repo trống, bấm **uploading an existing file**.
3. Giải nén zip, rồi kéo thả **toàn bộ nội dung** vào (gồm cả thư mục `public`, file `wrangler.jsonc`, `supabase-setup.sql`, `HUONG-DAN.md`). Kiểm tra trên GitHub thấy `public/index.html` và `wrangler.jsonc` ở thư mục gốc.
4. Bấm **Commit changes**.

## 2. Nối Cloudflare với GitHub
Web của bạn đang chạy trên một Worker tên `ancient-voice-154b`. Ta nối chính Worker đó với repo nên địa chỉ không đổi.
1. Cloudflare dashboard > **Workers & Pages** > bấm vào Worker `ancient-voice-154b`.
2. Bấm **Connect** (hoặc vào **Settings > Build** > Connect), chọn GitHub, cấp quyền và chọn repo vừa tạo.
3. Giữ **Deploy command** mặc định `npx wrangler deploy`, để trống Build command. Lưu.
4. Mỗi lần có commit mới trên GitHub, Cloudflare tự triển khai. Xem tiến trình ở **Deployments > View build history**.
5. Lỗi thường gặp: tên Worker trên Cloudflare phải trùng `name` trong `wrangler.jsonc`, nếu không build sẽ lỗi.

## 3. Cập nhật những lần sau
Tôi gửi bạn file mới (thường chỉ `index.html`). Bạn:
1. Mở repo trên GitHub, bấm vào thư mục `public`.
2. **Add file > Upload files**, kéo `index.html` mới vào, bấm **Commit changes** (nó ghi đè file cũ).
3. Đợi khoảng 1 phút, mở web và bấm **Ctrl + F5**.
`config.js` giữ nguyên nên không phải dán lại khoá.

## Lưu ý
- Dữ liệu nằm trên Supabase nên đăng lại web không làm mất số liệu. Vẫn nên bấm **Sao lưu / khôi phục** trước các lần nâng cấp lớn.
- Khoá anon public không phải bí mật, nhưng vẫn nên để repo Private. Không bao giờ commit khoá `service_role`.
- Địa chỉ web không đổi nên cấu hình Site URL ở Supabase giữ nguyên.
