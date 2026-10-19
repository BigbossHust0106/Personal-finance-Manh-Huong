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

## Bản 0.3.0: lịch sử đầu tư, hiển thị tài sản và PIN

### Cập nhật database trước khi triển khai web

1. Sao lưu dữ liệu bằng **Sao lưu / khôi phục**.
2. Với database đã chạy các bản cũ, mở Supabase > **SQL Editor > New query**, dán toàn bộ `supabase-update-0.3.0.sql`, bấm **Run**. Có thể chạy lại file này mà không xoá dữ liệu hay nhân đôi mốc lịch sử ban đầu.
3. Với database mới: chạy lần lượt `supabase-setup.sql`, `supabase-update-0.0.9.sql`, rồi `supabase-update-0.3.0.sql`.
4. Triển khai cả `public/index.html`, `public/features.js`, `public/sw.js` và `src/worker.js` cùng nhau. Tải lại trang; nếu dùng app đã cài, đóng rồi mở lại khi có mạng.

Bản web mới cần migration này để kiểm tra PIN và lưu phiên bản. Chưa cập nhật database thì web sẽ báo tên file cần chạy; không tự bỏ qua bước kiểm tra bảo mật. Không dùng khoá `service_role` trong trình duyệt. Các kiểm thử tự động dùng database cục bộ/fixture, không chạy migration trên Supabase đang dùng thật.

### Lịch sử và khôi phục theo mã

- Trong **Đầu tư > Danh mục tài sản**, bấm vào mã (ví dụ **FPT**) để xem giao dịch và các phiên bản trên toàn bộ thời gian, cho mọi chủ sở hữu, không phụ thuộc bộ lọc tháng đang chọn. Mã đã bán hết vẫn xem được qua **Hiện mã đã bán hết**; mã đã xoá có trong **Lịch sử mã đã xoá**.
- Nhật ký ghi tên, email và mã tài khoản người thực hiện từ phiên đăng nhập, thời điểm ghi nhận, cùng nội dung trước/sau khi thêm, mua, bán, sửa, xoá. Người thực hiện không nhất thiết là người sở hữu cổ phiếu.
- Dữ liệu trước bản cập nhật được giữ thành mốc ban đầu và ghi **Chưa ghi nhận (dữ liệu cũ)**; không thể suy ngược chính xác ai đã tạo/sửa trước đó. Cập nhật giá thị trường không tạo phiên bản giao dịch.
- Bấm **Xem nội dung thay đổi**, rồi **Khôi phục trước thay đổi** hoặc **Khôi phục phiên bản này**. Xem bản xem trước và xác nhận. Chỉ chủ trang/người được chỉnh sửa được khôi phục; người chỉ xem vẫn đọc được lịch sử.
- Khôi phục thay thế thông tin và toàn bộ giao dịch của riêng mã đó, gồm phần vợ/chồng/chung. Các mã khác, thu chi và giá thị trường hiện tại được giữ. Thao tác khôi phục tạo phiên bản mới; muốn hoàn tác, khôi phục trạng thái trước thao tác đó. Phiên bản bán quá số lượng đang có sẽ bị từ chối.
- Chỉ thay đổi đã lưu thành công mới có nhật ký trên server. Nếu thiết bị khác vừa sửa dữ liệu, ứng dụng báo xung đột thay vì ghi đè: tải bản sao lưu thay đổi đang có trước khi tải lại trang và đối chiếu. Lưu xong các thay đổi mới khôi phục hoặc chuyển trang quản lý.
- Nhật ký không bị giới hạn 500 dòng như nhật ký bán hàng cũ; giao diện tải mỗi lần 50 phiên bản. Xoá hẳn trang quản lý vẫn xoá toàn bộ dữ liệu và nhật ký của trang đó.

### Chọn tiền mặt hoặc tổng tài sản

Ở **Mục tiêu chi tiêu > Tổng tài sản hiện có**, bấm nút nhỏ **⚙** cạnh tiêu đề. Chọn cách hiển thị riêng cho thẻ tổng, tiền chồng, tiền vợ và tiền chung. Mặc định là tổng tài sản như trước; cài đặt lưu theo tài khoản và đồng bộ qua Supabase.

**Tiền mặt** chỉ gồm tiền mặt/ngân hàng ngoài tài khoản đầu tư. **Tổng tài sản** gồm thêm cổ phiếu/quỹ và tiền trong tài khoản đầu tư. Tổng riêng từng người trừ nợ margin của người đó; thẻ tổng toàn bộ giữ cách tính tài sản gộp và hiển thị nợ/tài sản ròng ở các thẻ riêng. Tùy chọn chỉ thay cách hiển thị, không thay đổi số liệu gốc.

### PIN 4 số riêng từng tài khoản

- Bấm ảnh đại diện > **Cài đặt PIN bảo mật**. Mặc định **Tắt**. Chọn **Bật / đổi PIN**, nhập PIN mới hai lần rồi lưu. PIN có thể bắt đầu bằng số 0.
- Khi đã bật PIN, mỗi lần mở trang, mở tab mới hoặc tải lại trang đều phải nhập PIN, kể cả khi Supabase vẫn giữ đăng nhập. Quay lại trang qua nút Back/Forward từ bộ nhớ trình duyệt cũng phải nhập lại. Trong cùng lần mở trang đã mở khoá, chuyển các mục không yêu cầu nhập lại. Muốn kết thúc phiên đăng nhập, bấm **Đăng xuất**. Bản sửa 0.3.1 chỉ cập nhật web, không cần chạy thêm SQL.
- Đổi hoặc tắt PIN phải nhập PIN hiện tại. Đổi PIN thu hồi trạng thái mở khoá của các phiên khác. Nhập sai 5 lần sẽ khoá thử PIN trong 5 phút trên toàn tài khoản, kể cả đổi thiết bị.
- PIN được băm bằng bcrypt trong schema riêng, không lưu PIN trong mã web, `localStorage`, dữ liệu tài chính hay metadata người dùng. Quyền truy cập dữ liệu và khôi phục được kiểm tra lại ở database. PIN là khoá bổ sung, không thay thế mật khẩu và không phải 2FA.
- Quên PIN: quản trị viên Supabase phải xác minh chủ tài khoản qua kênh riêng, rồi dùng SQL Editor để xoá PIN và các phiên mở khoá của **đúng user ID** trong `finance_private.account_pins` và `finance_private.pin_sessions`. Đăng xuất rồi đăng nhập lại để đặt PIN mới. Không có nút bỏ qua PIN trên web.

### Chạy và kiểm thử khi phát triển

Ứng dụng không có bước build frontend. Dùng Node 24+, Wrangler 4; cài công cụ bên ngoài checkout để không thêm dependency vào ứng dụng:

```bash
npm install --prefix /tmp/finance-dev-tools --save-exact wrangler@4.151.1 playwright@1.64.1 pg@8.23.1
cd /workspace/Personal-finance-Manh-Huong
WRANGLER_SEND_METRICS=false /tmp/finance-dev-tools/node_modules/.bin/wrangler dev --ip 127.0.0.1 --port 8787
```

Kiểm thử bằng Chromium và PostgreSQL cục bộ có extension `pgcrypto`. `DB_TEST_URL` phải trỏ đến máy cục bộ với tài khoản được tạo database và role; bộ kiểm thử tự tạo rồi xoá database riêng, mô phỏng `auth.uid()`/`auth.jwt()` của Supabase:

```bash
NODE_PATH=/tmp/finance-dev-tools/node_modules node --test tests/ui.test.cjs tests/worker.test.cjs
DB_TEST_URL=postgres://postgres@127.0.0.1:55432/postgres NODE_PATH=/tmp/finance-dev-tools/node_modules node --test tests/database.test.cjs
WRANGLER_SEND_METRICS=false /tmp/finance-dev-tools/node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/finance-build
```

`CHROMIUM_PATH` có thể chỉ định binary khác `/usr/bin/chromium`. Kiểm thử giao diện dùng fixture Supabase để không truy cập tài khoản/dữ liệu thật; kiểm thử database thực thi migration, RLS, nhật ký, khôi phục, giới hạn PIN và chống ghi đè phiên bản trên PostgreSQL thật. Kiểm thử Worker giả lập các dịch vụ ngoài để kiểm tra chặn đăng nhập/PIN trước khi lấy giá.
