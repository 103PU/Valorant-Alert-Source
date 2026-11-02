# 🎯 Valorant Realtime Score Alert (PWA + PC Dashboard)

> Hệ thống theo dõi tỉ số trận đấu Valorant thời gian thực (Realtime HUD) & cảnh báo âm thanh thông minh khi đối thủ đạt Match Point nguy hiểm qua mạng LAN cá nhân.

![Valorant Score Alert Banner](assets/app-icon.svg)

---

## 🌟 Tính Năng Nổi Bật

- **Realtime Score Poller**: Tự động nhận diện trận đấu Valorant (Competitive, Unrated, Custom Games) trực tiếp từ Riot Client Local API & Presences.
- **Kho 5 Âm Chuông Cảnh Báo Độc Quyền (Web Audio Presets)**:
  - 🎼 `Melodic Triad`: Chuỗi hợp âm E-Major 4 nốt du dương, đánh thức êm tai.
  - 📡 `Radar Pulse`: Âm xung radar kép công nghệ cao.
  - 🔔 `Crystal Bell`: Tiếng chuông pha lê dịu nhẹ.
  - 👾 `Arcade 8-Bit`: Âm bleep retro cổ điển.
  - 🛡️ `Tactical Dual-Tone`: Kèn đồng chiến thuật trầm hùng.
- **Tùy Biến Kịch Bản Báo Động (Scenario Event Toggles)**:
  - ⚠️ `Match Point Risk`: Cảnh báo lặp lại khi đối thủ đạt 11 điểm.
  - 🔔 `Round Over Notification`: Phát 1 tiếng chuông ngắn khi kết thúc round đấu.
  - 🔥 `Overtime / Sudden Death`: Cảnh báo khi bước vào round phụ (12 - 12).
- **PC Dashboard (Windows Desktop GUI)**: Giao diện HUD phong cách chuẩn Riot Games ([playvalorant.com](https://playvalorant.com/vi-vn/)) kèm mã QR vector sắc nét, bảng điểm song song, và nút tạo Desktop Shortcut.
- **Mobile Web PWA**: Mở bằng trình duyệt điện thoại; kết nối LAN hoặc dùng Cloud Relay khi tài khoản có quyền tương ứng. Khả năng chạy nền phụ thuộc hệ điều hành và trình duyệt.
- **Kết nối LAN**: Máy chủ lắng nghe trên giao diện mạng; link chia sẻ có token. Không đưa token hoặc dữ liệu `/api/info` cho thiết bị không tin cậy.

---

## 🏗️ Kiến Trúc & Tài Liệu Dự Án

README ban đầu mô tả kiến trúc LAN ba lớp. Bản đồ module, luồng chạy, hợp đồng API,
trạng thái tính năng và hướng dẫn dựng lại được quản lý tại
**[docs/architecture](docs/architecture/README.md)**. Tài liệu phân biệt mã nguồn
đã xác minh với thay đổi chưa commit và đề xuất; PWA/Cloud Relay không đồng nghĩa
với ứng dụng native.

---

## 🚀 Hướng Dẫn Cài Đặt Cho Developer (Source Repo)

### 1. Cài đặt Dependencies:
```bash
npm install
```

### 2. Khởi chạy Server Development:
```bash
npm start
```

### 3. Đóng gói Bản Phát Hành (Portable Release Bundle):
```bash
npm run build
```

---

## 📦 Phát Hành & Tải Về (Release Repository)

- **Source Code Repo**: [https://github.com/103PU/Valorant-Alert-Source.git](https://github.com/103PU/Valorant-Alert-Source.git)
- **Bản Đóng Gói Sẵn Dùng (Release Repo)**: [https://github.com/103PU/Valorant-Alert-Release.git](https://github.com/103PU/Valorant-Alert-Release.git)
- **Bản phát hành**: Kiểm tra [GitHub Releases của Release Repo](https://github.com/103PU/Valorant-Alert-Release/releases). Tên artifact và trạng thái phát hành cần xác minh tại thời điểm tải; repo source không bảo đảm rằng artifact đã được publish.
