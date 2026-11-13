# ShotDropVN

Hệ thống **trả ảnh sự kiện & studio theo thời gian thực (Live Photo Delivery)** giúp nhiếp ảnh gia đồng bộ ảnh từ máy ảnh (qua cáp/Hub USB OTG) hoặc từ thư viện điện thoại lên đám mây và phát hành ngay **mã QR** để khách mời quét xem, tải ảnh trực tiếp trên web.

## Demo

<img width="1545" height="1037" alt="Snapzy_2026-11-13_19-01-37_141" src="https://github.com/user-attachments/assets/65ef0f39-fdb0-4de7-abb6-e8d1e8c9b5c3" />
<img width="720" height="1612" alt="shotdrop_d7307910-1883-4ff0-86e4-7efffd49b113" src="https://github.com/user-attachments/assets/9cea3a22-89ef-4e8a-95c3-25f3b54f0e07" />
<img width="720" height="1612" alt="shotdrop_b06ebf37-0a0f-4566-ab93-fe6955e9bd60" src="https://github.com/user-attachments/assets/d11f04e1-35bb-489c-bb5e-da94f49942d3" />


---

## 1. Tổng quan, cấu trúc các phần & mục đích sử dụng

### Mục đích sử dụng
- Thay thế việc phải chờ kết thúc buổi chụp mới rút thẻ nhớ copy và gửi link thủ công.
- Cho phép khách mời, người mẫu hoặc ban tổ chức sự kiện quét **1 mã QR duy nhất** ngay tại chỗ để nhận liên tục các ảnh vừa chụp theo thời gian thực trên trình duyệt, không cần cài đặt ứng dụng.
- Hỗ trợ nối tiếp ảnh liên tục vào cùng phiên QR hiện tại, đồng thời đối chiếu thẻ nhớ để đẩy bù những tấm bị lỡ khi mạng chập chờn.

### Các phần trong hệ thống
Dự án được tổ chức thành 4 thành phần chính:

1. **`mobile/` — ShotDropVN Studio (Android App)**
   - Xây dựng bằng **React Native / Expo** kết hợp module native **Kotlin (`ShotDropUsbOtg`)** giao tiếp **USB OTG** (Canon EOS PTP / MTP / USB Mass Storage SAF).
   - Nhiệm vụ: kết nối máy ảnh hoặc chọn ảnh trên điện thoại, tự động phát hiện ảnh JPEG mới chụp qua OTG, upload ảnh lên lưu trữ đám mây, sinh mã QR chia sẻ, đối chiếu & sync ảnh còn thiếu từ thẻ nhớ, quản lý/tách QR/xoá ảnh và dọn sạch phiên khi kết thúc.

2. **`web/` — Guest Photo Gallery (Web App)**
   - Xây dựng bằng **Next.js (App Router) + Tailwind CSS**.
   - Nhiệm vụ: trang web công khai tại đường dẫn `/s/[hash]` (kèm API đồng bộ `/api/sync`) hiển thị album ảnh live khi khách quét mã QR, tự cập nhật khi có ảnh mới được đẩy từ Mobile và xoá trắng dữ liệu hiển thị ngay khi nhiếp ảnh gia kết thúc phiên.

3. **`be/` — Backend & Database Schema (Supabase)**
   - Sử dụng **Supabase** (PostgreSQL + Storage Bucket `shotdrop_photos` + Supabase Realtime).
   - Nhiệm vụ: lưu thông tin phiên chụp (`public.sessions`), danh sách ảnh (`public.photos`), file ảnh công khai trên Storage và đẩy sự kiện realtime về Web Gallery.

4. **`scripts/` & `version.json` — Tiện ích phát hành**
   - Chứa script đồng bộ số phiên bản (`scripts/bump-version.js`) giữa root, `mobile/`, Android `build.gradle` và `web/`.

---

## 2. Hướng dẫn các bước sử dụng App Mobile (ShotDrop VN)

### Bước 1: Chuẩn bị & kết nối thiết bị
- Mở app **ShotDrop VN** trên điện thoại Android.
- **Nếu chụp trực tiếp từ máy ảnh qua USB OTG:**
  1. Cắm cáp Mini-USB/USB từ máy ảnh (hoặc đầu đọc thẻ) qua cáp/Hub Type-C OTG vào điện thoại.
  2. Bật nguồn máy ảnh, thiết lập lưu ảnh **JPEG** và nhớ **tắt Wi-Fi trên máy ảnh** (nhiều máy ảnh Canon sẽ khoá cổng USB nếu đang bật Wi-Fi).
  3. Khi hộp thoại Android hiện lên, bấm **Cho phép (OK)** để cấp quyền USB cho ứng dụng. Nếu chưa nhận, bấm **Cấp quyền & Kết nối OTG** hoặc **Quét lại OTG** trong khung trạng thái OTG.
  4. Trường hợp dùng đầu đọc thẻ / chế độ Mass Storage, bấm **Chọn thư mục OTG** và cấp quyền truy cập thư mục `DCIM` trên thẻ.

### Bước 2: Bắt đầu upload & tạo mã QR phiên chụp
Bạn có 2 cách để bắt đầu đẩy ảnh:
- **Cách A — Chụp qua máy ảnh USB OTG (khuyến nghị khi tác nghiệp):**
  - Đảm bảo công tắc ở góc bảng OTG đang ở trạng thái **AUTO ON**.
  - Bấm chụp tấm ảnh đầu tiên trên máy ảnh: app tự lấy file JPEG, tạo **1 mã QR mới** (ví dụ `#abc123`) và upload lên web.
  - Từ tấm thứ 2 trở đi, mỗi ảnh mới chụp sẽ tự động upload nối tiếp vào **chính mã QR & đường link đang mở** (khách không cần quét lại mã mới).
- **Cách B — Chọn ảnh thủ công:**
  - Khi chưa có phiên QR: bấm **Chọn ảnh từ thư viện điện thoại** (hoặc **Chọn ảnh từ máy ảnh / thư viện** nếu đang cắm OTG) để chọn ảnh đẩy lên và sinh mã QR ngay.
  - Khi đã có phiên QR đang mở: bấm **Upload thêm ảnh** để bổ sung ảnh từ thẻ nhớ máy ảnh hoặc chuyển sang **Thư viện điện thoại** chọn ảnh đẩy vào cùng QR hiện tại.

### Bước 3: Dùng nút Sync đối chiếu khi rớt mạng hoặc thiếu ảnh
- Khi mạng chập chờn khiến auto-upload bị trượt tấm mới chụp, hoặc bạn muốn đẩy thêm ảnh cũ từ thẻ nhớ, hãy bấm nút **Sync ảnh mới nhất từ máy ảnh**.
- App sẽ quét danh sách ảnh hiện có trên thẻ nhớ, **đối chiếu (compare)** với danh sách ảnh đã upload ở phiên hiện tại và chỉ tải + upload bù những tấm chưa lên QR.

### Bước 4: Cho khách quét QR hoặc gửi link
- Đưa mã QR đang hiển thị trên màn hình cho khách quét trực tiếp, hoặc bấm **Chia sẻ Link** để gửi URL album sang Zalo/Messenger/tin nhắn.

### Bước 5: Quản lý danh sách ảnh đã upload
- Chạm vào ảnh trong lưới bên dưới để chọn (hiện thanh nổi **Đã chọn X ảnh** cùng các nút **Chọn tất cả**, **Bỏ chọn**, **Mở**), hoặc nhấn giữ 1 ảnh để thao tác nhanh.
- Bấm **Mở** trên thanh chọn để xem danh sách ảnh đã chọn và thực hiện:
  - **Tạo mã QR mới & Upload riêng ... ảnh**: tách nhóm ảnh đã chọn sang một album QR độc lập.
  - **Xoá ... ảnh đã chọn khỏi danh sách**: gỡ ảnh khỏi danh sách mobile, Supabase và Web.

### Bước 6: Kết thúc phiên & xoá dữ liệu Web
- Khi buổi chụp kết thúc và muốn đóng link QR, bấm **Kết thúc phiên**.
- App sẽ xoá toàn bộ phiên, danh sách ảnh và file ảnh trên máy chủ lưu trữ để trang Web không còn load lại dữ liệu của phiên cũ trước khi đưa app về trạng thái sẵn sàng cho buổi chụp mới.
