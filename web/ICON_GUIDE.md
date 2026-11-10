# ShotDropVN Web App — Next.js App Router Icon Guide

Hướng dẫn chuẩn hóa bộ Favicon, App Icon và iOS Web Clip cho **Next.js App Router** trong thư mục [`web/app/`](file:///Users/namnguyenne/Desktop/shotdropvn/web/app) (đã được khai báo đồng bộ trong `metadata.icons` của [`web/app/layout.tsx`](file:///Users/namnguyenne/Desktop/shotdropvn/web/app/layout.tsx)).

---

## 1. Các file cần đặt trực tiếp vào thư mục `web/app/`

Next.js App Router tự động nhận diện các file đặt tại gốc `web/app/` và sinh thẻ `<link rel="icon">` / `<link rel="apple-touch-icon">` chuẩn SEO + PWA:

| Tên file trong `web/app/` | Kích thước chuẩn (px) | Định dạng | Nền (Background) | Mục đích sử dụng |
| :--- | :--- | :--- | :--- | :--- |
| **`favicon.ico`** | **32 × 32 px** *(hoặc multi-size 16/32/48)* | `.ico` | Trong suốt hoặc Đặc | Favicon mặc định trên thanh tab trình duyệt Desktop & tương thích ngược mọi trình duyệt. *(Ghi đè file `web/app/favicon.ico` hiện tại).* |
| **`icon.png`** | **512 × 512 px** *(hoặc 192 × 192 px)* | PNG (32-bit) | Trong suốt hoặc Đặc (`#111110`) | Favicon độ phân giải cao cho Chrome, Safari, Android Home Screen shortcut & Google Search kết quả tìm kiếm. |
| **`apple-icon.png`** | **180 × 180 px** | PNG (24-bit, **không** trong suốt) | Đặc (`#111110` hoặc `#F7F7F5`) | Icon **iOS Web Clip** (`apple-touch-icon`) khi khách sự kiện bấm *"Add to Home Screen"* trên iPhone/iPad Safari. |
| **`opengraph-image.png`** *(Tùy chọn)* | **1200 × 630 px** | PNG / JPG | Đặc (`#F7F7F5`) | Ảnh thu nhỏ (Thumbnail) tự động hiển thị khi chia sẻ link album `shotdrop.vn/s/[hash]` qua Zalo, Messenger, iMessage. |

---

## 2. Cấu trúc thư mục `web/app/` sau khi thêm Icon

```text
web/app/
├── favicon.ico          <-- Ghi đè (32×32 px)
├── icon.png             <-- Thêm mới (512×512 px)
├── apple-icon.png       <-- Thêm mới (180×180 px, nền đặc)
├── opengraph-image.png  <-- (Tùy chọn) Ảnh preview khi gửi link qua Zalo/Messenger (1200×630 px)
├── layout.tsx           <-- Đã cấu hình metadata.icons
├── page.tsx
└── s/
    └── [hash]/
        └── page.tsx
```

---

## 3. Lưu ý khi xuất từ Figma

1. **`apple-icon.png` (180 × 180 px)**:
   - Không để nền trong suốt (iOS Safari sẽ tô nền đen cho vùng trong suốt khi lưu ra màn hình chính).
   - Không bo góc sẵn khi export từ Figma (iOS tự động bo góc theo chuẩn Apple).
2. **`icon.png` (512 × 512 px)**:
   - Có thể dùng nền trong suốt hoặc hình vuông bo góc sẵn (~20% corner radius) để hiển thị sắc nét trên thanh tab trình duyệt.
3. **Kiểm tra sau khi thêm file**:
   - Chạy `cd web && npm run build` hoặc mở `http://localhost:3000` và kiểm tra thẻ `<head>` trong DevTools sẽ thấy các thẻ `<link rel="icon" ...>` và `<link rel="apple-touch-icon" ...>` được Next.js tự động gắn kèm mã hash chống cache.
