# ShotDropVN Mobile App — Icon & Splash Export Guide (iOS & Android)

Hướng dẫn xuất (export) bộ icon & splash screen từ **Figma** và ghi đè trực tiếp vào thư mục [`mobile/assets/`](file:///Users/namnguyenne/Desktop/shotdropvn/mobile/assets) để khớp với cấu hình trong [`mobile/app.json`](file:///Users/namnguyenne/Desktop/shotdropvn/mobile/app.json).

---

## 1. Danh sách file cần ghi đè trong `mobile/assets/`

| File trong `mobile/assets/` | Kích thước chuẩn (px) | Định dạng | Nền (Background) | Mục đích sử dụng |
| :--- | :--- | :--- | :--- | :--- |
| **`icon.png`** | **1024 × 1024 px** | PNG (24-bit, **không** trong suốt) | Đặc (`#111110` hoặc `#F7F7F5`) | Icon chính cho **iOS App Store** & fallback trên Android. Không bo góc sẵn (hệ điều hành tự bo góc). |
| **`android-icon-foreground.png`** | **1024 × 1024 px** *(hoặc 512 × 512 px)* | PNG (32-bit, **trong suốt**) | Trong suốt (`Transparent`) | Lớp biểu tượng nổi (Foreground) của **Android Adaptive Icon**. Đặt logo chính nằm gọn trong vùng an toàn **66%** ở tâm (**676 × 676 px**). |
| **`android-icon-background.png`** | **1024 × 1024 px** *(hoặc 512 × 512 px)* | PNG (24-bit, đặc) | Đặc (`#F7F7F5` hoặc `#111110`) | Lớp nền (Background) của **Android Adaptive Icon** (kết hợp cùng `adaptiveIcon.backgroundColor: "#F7F7F5"`). |
| **`android-icon-monochrome.png`** | **1024 × 1024 px** *(hoặc 432 × 432 px)* | PNG (32-bit, **trong suốt**) | Trong suốt (`Transparent`) | Icon đơn sắc (1 màu trắng/đen thuần với kênh Alpha) cho **Android 13+ Themed Icons**. |
| **`splash-icon.png`** | **1024 × 1024 px** | PNG (32-bit, **trong suốt**) | Trong suốt (`Transparent`) | Logo hiển thị giữa màn hình chờ (**Splash Screen**) trên nền `#F7F7F5` (`resizeMode: "contain"`). |
| **`favicon.png`** | **48 × 48 px** *(hoặc 192 × 192 px)* | PNG (32-bit, trong suốt) | Trong suốt (`Transparent`) | Favicon khi chạy bản Expo Web (`npx expo start --web`). |

---

## 2. Quy tắc thiết kế trên Figma (Safe Zone)

1. **iOS App Icon (`icon.png` — `1024 × 1024`)**:
   - **Không dùng nền trong suốt (Alpha channel)**: Apple App Store sẽ từ chối hoặc biến phần trong suốt thành màu đen tuyền.
   - **Không tự bo góc (No rounded corners)**: Xuất nguyên khung hình vuông 1024×1024; iOS sẽ tự áp mặt nạ squircle.
2. **Android Adaptive Icon (`android-icon-foreground.png` — `1024 × 1024`)**:
   - Android cắt icon theo nhiều hình dáng khác nhau (tròn, squircle, giọt nước).
   - Giữ toàn bộ phần chữ/biểu tượng quan trọng của logo **ShotDropVN** nằm bên trong vòng tròn đường kính **676 px** ở chính giữa khung 1024×1024 (tương đương lề an toàn ~174 px mỗi cạnh).
3. **Splash Screen (`splash-icon.png` — `1024 × 1024`)**:
   - Đặt biểu tượng ở trung tâm với kích thước khoảng **320 × 320 px → 480 × 480 px** bên trong khung 1024×1024 trong suốt để màn hình khởi động thanh thoát, không bị tràn sát mép màn hình.

---

## 3. Áp dụng Icon mới vào bản Build Android / iOS

Sau khi chép đè các file PNG mới vào `mobile/assets/`, chạy lệnh sau để cập nhật lại tài nguyên native (`mipmap-*` và `drawable-*`) rồi đóng gói lại APK:

```bash
cd /Users/namnguyenne/Desktop/shotdropvn/mobile
npx expo prebuild --platform android --no-install
./android/gradlew -p ./android assembleRelease
```
