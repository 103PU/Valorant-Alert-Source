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
- **Universal Mobile PWA**: Tương thích 100% với iPhone (Safari) và tất cả điện thoại Android (Chrome, Edge, Samsung Internet, Firefox Mobile).
- **Bảo Mật LAN & Chi Phí 0đ**: Chạy hoàn toàn nội bộ trong mạng gia đình, xác thực mã token ngẫu nhiên, không cần API Key công khai.

---

## 🏗️ Kiến Trúc Hệ Thống (3-Layer Architecture)

```
Valorant Alert/
├─ config.json                   <-- Dynamic Config (Port, Interval, Alert Thresholds)
├─ assets/                       <-- High-res Brand Icons (.ico, .png, .svg)
├─ server/
│  ├─ riot/                      <-- LỚP 1: DATA ACQUISITION
│  │  ├─ lockfile-reader.js      <-- Lockfile reader
│  │  ├─ riot-auth.js            <-- Token Auth & Auto-refresh (45m)
│  │  └─ riot-region.js          <-- ShooterGame.log Region parser
│  ├─ core/                      <-- LỚP 2: CORE LOGIC & ALERT RULES
│  │  ├─ score-poller.js         <-- Real-time score poller (Presence + GLZ)
│  │  └─ alert-rules.js          <-- Alert condition evaluator (Pure function)
│  ├─ transport/                 <-- LỚP 3: TRANSPORT & COMMUNICATION
│  │  └─ ws-server.js            <-- WebSocket LAN server with Token Auth
│  ├─ utils/
│  │  └─ logger.js               <-- Dual Console & File Logger (logs/app.log)
│  └─ index.js                   <-- Entrypoint (Xử lý process.pkg path resolution)
├─ public/                       <-- Mobile PWA & PC Dashboard Assets
│  ├─ index.html
│  ├─ dashboard.html
│  ├─ manifest.json
│  └─ sw.js
├─ scripts/                      <-- Build & Icon generation scripts
│  ├─ build.js
│  └─ generate-icons.js
├─ Start-ValorantAlert.bat       <-- 1-Click Desktop Launcher
└─ Create-Desktop-Shortcut.vbs   <-- Windows Desktop Shortcut Creator
```

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
- **Tải trực tiếp bản ZIP**: Truy cập mục [GitHub Releases](https://github.com/103PU/Valorant-Alert-Source/releases) tải `Valorant-Score-Alert-Portable-v1.0.0.zip`, giải nén và nhấp đúp `Start-ValorantAlert.bat` là dùng được ngay!
