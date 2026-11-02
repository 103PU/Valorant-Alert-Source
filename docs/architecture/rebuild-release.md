# Clone, phát triển, kiểm thử và phát hành

## Yêu cầu môi trường

- Git và Node.js. Project dùng CommonJS và Node built-in test runner.
- Đóng gói portable Windows cần dependencies trong `scripts/build.js`, gồm
  `caxa`; installer `.exe` cần toolchain Inno Setup trong
  `tools/installer/ValorantAlert.iss`.
- Muốn có telemetry thật cần Riot Client và Valorant đang chạy. Test tự động có
  thể mock network, không chứng minh Riot production endpoint luôn hoạt động.
- KLD, GitHub Releases, OAuth và Discord tùy chọn là dịch vụ ngoài. Không cần
  credential để chạy test cục bộ cơ bản.

`package.json` chưa khai báo `engines`. Node version cần dùng trong CI/release cần
được đối chiếu `.github/workflows/` và dependency trước khi pin vào tài liệu.

## Clone và chạy local

```powershell
git clone https://github.com/103PU/Valorant-Alert-Source.git
Set-Location Valorant-Alert-Source
npm install
npm start
```

`npm start` chạy `node server/index.js`. Server tạo `config.json` mặc định nếu
chưa có và listen port `3000` trừ khi `PORT` hoặc config ghi đè. Không có Riot
lockfile thì poller báo `GAME_CLOSED`.

| Lệnh | Mục đích |
|---|---|
| `npm start` | Chạy local host và dashboard server. |
| `npm test` | Chạy Node test runner trên `test/`. |
| `npm run build` | Tạo portable và installer artifacts; cần môi trường Windows phù hợp. |
| `npm run build:pages` | Copy riêng `public/` vào `dist/` cho static Pages flow. |
| `npm run generate-icons` | Sinh icon qua `scripts/generate-icons.js`. |

`config.json` là runtime config, không phải nguồn chuẩn cho license trust hoặc plan
policy. Không thêm signing private key, KLD admin secret, Discord webhook secret
hay OAuth client secret vào file này.

## Kiểm thử

Chạy:

```powershell
npm test
```

Các suite tiêu biểu:

- `test/score-poller.test.js`, `test/alert-rules.test.js`: phát hiện trận, metadata
  và pure score rules.
- `test/cloud-relay.test.js`: publisher gating, payload, fallback và suppression.
- `test/licensing-contract.test.js`, `test/licensing-public.test.js`,
  `test/licensing-enforcement.test.js`, `test/license-signature.test.js`: KLD
  contracts, gate, service policy và signature behavior.
- `test/app-version.test.js`: update selection theo product và fallback safety.
- `test/update-download.test.js`, `test/update-routes.test.js`,
  `test/update-handoff.test.js`: download/verification/routes/handoff.
- `test/release-artifacts.test.js`, `test/installer-contract.test.js`: naming,
  checksums, packaging và installer contracts.
- `test/api-settings.test.js`: settings route/persistence; test và route này chưa
  commit tại thời điểm khảo sát.

Tests dùng injected fetch/spawn không tải release hoặc chạy installer thật. Proof
trên thiết bị cần Windows VM/máy riêng, Riot Client, network và KLD account hợp lệ.
Không ghi “tests pass” nếu chưa chạy trên đúng working tree cần bàn giao.

## Build output và xác minh artifact

`package.json` là nguồn version. `scripts/release-naming.js` định nghĩa filenames.
Build tạo portable ZIP, compatibility installer ZIP, Setup executable và
`SHA256SUMS.txt`; `scripts/verify-release-artifacts.js` kiểm tra artifact/checksum.
Secure release mode bật bằng `SECURE_RELEASE=1` và cần certificate thumbprint cùng
signing tool. Không đưa signing material vào docs hoặc command output.

Sau khi build, chạy:

```powershell
npm run build
node scripts/verify-release-artifacts.js
```

Artifact build local và CI không nhất thiết byte-reproducible. Checksum phát hành
phải đi cùng đúng bytes do release build tạo ra; không build lại local rồi thay
file đã publish.

KLD resolver đợi filenames từ `scripts/release-naming.js`. Source repo và binary
distribution repo là hai nơi khác nhau:

- Source: `103PU/Valorant-Alert-Source`.
- Distribution được cấu hình trong app: `103PU/Valorant-Alert-Release`.

Trước khi phát hành, đọc [`docs/release-runbook.md`](../release-runbook.md) và
xác minh lại approval gates, target repository, secret names và artifact status.
Repo constant không chứng minh release đã tồn tại.

## Installer và nơi lưu dữ liệu

Windows setup được định nghĩa bởi `tools/installer/ValorantAlert.iss` và các
PowerShell installer scripts. Layout được thiết kế:

- Program files theo user tại `%LOCALAPPDATA%\Programs\ValorantAlert`.
- User data bền vững tại `%APPDATA%\ValorantAlert`.
- Desktop shortcut chạy launcher script thay vì mở trực tiếp bundled executable.

Installer có mục tiêu giữ user data qua upgrade/uninstall trừ khi chọn purge rõ
ràng. Cần kiểm chứng trên Windows VM sạch trước khi khẳng định hành vi installer
đã được test thực tế.

## Vòng đời in-app update

1. Dashboard gọi `/api/license/app-version`.
2. App hỏi KLD về product-aware version/download metadata; nếu không dùng được có
   thể fallback GitHub latest release.
3. GitHub fallback chỉ đề xuất soft update; không force-lock app.
4. Dashboard POST `/api/license/update/start`; host yêu cầu share token và
   loopback caller.
5. Version/download URL do server chọn; không tin URL/version từ caller.
6. Updater tải vào app-data update working directory, kiểm tra size và SHA-256 với
   `SHA256SUMS.txt`, có thể chạy Authenticode policy nếu được cấu hình.
7. Installer thay app, giữ user data và khởi chạy bản mới qua launcher/handoff.
8. `/api/license/update/state` cung cấp progress; `/api/license/update/cancel`
   hủy trước handoff và loopback-only.

Checksum phát hiện hỏng dữ liệu và một phần can thiệp transport; checksum được
phát hành cạnh artifact không phải chữ ký độc lập nếu release publisher bị xâm
nhập. Entitlement Ed25519 key không ký release files.

## Chẩn đoán

| Triệu chứng | Kiểm tra đầu tiên |
|---|---|
| Dashboard không mở | Kiểm tra port, app log và gọi `GET /api/info` từ máy local. |
| Riot bị disconnected | Kiểm tra Riot Client/lockfile, `LOCALAPPDATA`, region log và token refresh. |
| Không có score | Kiểm tra `/chat/v4/presences`, PUUID/subject, GLZ region/shard và response status. |
| LAN client không kết nối | Kiểm tra firewall, LAN address, share token, WebSocket URL và entitlement `score_hud`. |
| PWA 4G không có score | Kiểm tra login, entitlement `cloud_relay`, publisher status, freshness ở KLD và KLD URL trên PWA. |
| License state sai | Kiểm tra `/api/license/status` từ loopback, session cache, product/device binding, signature verdict, KLD response và offline grace. Không chia sẻ token/personal fields. |
| Không có update | Kiểm tra `/api/license/app-version`, KLD product echo/download metadata, release tag/assets và warning list. |
| Download update lỗi | Kiểm tra release asset, checksum filename/content, byte limit, quyền thư mục update và Authenticode policy nếu bật. |

## Ngoài phạm vi runbook

Production deployment, secret rotation, KLD migrations, Discord proxy deployment,
release publishing và account/billing operations cần quy trình phê duyệt riêng.
Không suy diễn cách làm từ local source và không ghi secret vào repository.
