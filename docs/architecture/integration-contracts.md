# Hợp đồng tích hợp

Trang này mô tả giao diện giữa PC host, browser client và các dịch vụ ngoài tại
snapshot được pin trong [mục lục kiến trúc](README.md). Các file source liên quan
có thay đổi chưa commit; những thay đổi đó không được xem là contract của HEAD.
Tên route trong tài liệu không tự chứng minh client đang gọi route đó.

## HTTP của PC host

Node server listen trên `0.0.0.0:<port>` (mặc định `3000`) và dispatch trong
`server/app.js`. Request không khớp API route được chuyển tới static-file handler.

| Method / path | Caller | Auth/guard | Hành vi |
|---|---|---|---|
| `GET /` và static files | Browser | Static handler không kiểm tra route token | Serve `public/index.html`, dashboard và assets. Path được decode/normalize, kiểm tra nằm trong `publicDir`; hỗ trợ ETag và gzip. |
| `GET /api/info` | Dashboard/PWA | Không yêu cầu route token | Trả port/IP, share token, URLs, relay status, entitlement summary, settings và Riot metadata. Response nhạy cảm vì có share token. |
| `GET /api/qr?type=lan\|cloud` | Dashboard | Không yêu cầu route token | Sinh PNG QR chứa URL và share token; chọn cloud nếu có, nếu không dùng LAN. |
| `GET /api/settings` | Dashboard | Loopback caller được phép không token; caller khác cần share token | Đọc settings đã merge với defaults. |
| `POST /api/settings` | Dashboard | Loopback caller được phép không token; caller khác cần share token; không có loopback-only restriction | Parse JSON body có giới hạn và merge vào `%APPDATA%\ValorantAlert\settings.json`. Route/test settings hiện chưa commit. |
| `POST /api/create-shortcut` | Dashboard | Không yêu cầu route token hoặc loopback trong handler | Chạy `Create-Desktop-Shortcut.vbs` bằng `cscript`; chỉ có method check. |
| `/api/license/status?token=<share-pin>` | Dashboard/PWA | Share token chính xác | Trả gate snapshot hiện tại. |
| `POST /api/license/recheck?token=<share-pin>` | Dashboard | Share token | Chạy lại gate check. |
| `GET /api/license/app-version?token=<share-pin>` | Dashboard | Share token | Kiểm tra thông tin update; không đổi trạng thái license. |
| `POST /api/license/login`, `/logout`, `/apply-key` | Dashboard | Share token và caller loopback | Bắt đầu OAuth, xóa session hoặc áp dụng key. |
| `POST /api/license/update/start`, `/cancel` | Dashboard | Share token và caller loopback | Bắt đầu/hủy công việc update; server tự chọn version/artifact, không nhận URL do caller chọn. |
| `GET /api/license/update/state?token=<share-pin>` | Dashboard/PWA | Share token | Đọc stage/progress; không khởi động thay đổi. |

`server/routes/api-license.js` áp method/caller guard theo action. `/api/info`,
`/api/qr` và `/api/create-shortcut` không có route-token guard trong dispatch hiện
được khảo sát. `/api/settings` cho loopback caller bỏ qua token, còn remote caller
cần token nhưng không bị giới hạn loopback. Server bind mọi interface; đây là
description của source, không phải security audit hay khuyến nghị cấu hình. Không
đưa PIN, response `/api/info`, QR hoặc URL chứa token cho thiết bị không tin cậy.

Ở snapshot này chưa xác minh được `POST /api/license/mobile-pin` hay endpoint
pairing tương đương; không dùng các route trong handoff làm contract hiện hành.

## WebSocket LAN

| Thuộc tính | Contract |
|---|---|
| Transport | WebSocket upgrade trên cùng host/port với HTTP. |
| Xác thực | `?token=<six-character-random-share-token>`; thiếu/sai token bị từ chối HTTP 401. |
| Entitlement | Cần `score_hud`; token hợp lệ nhưng thiếu quyền nhận HTTP 402. |
| Event server | JSON serialize từ snapshot của `ScorePoller`. |
| Snapshot ban đầu | Nếu có, gửi last payload ngay sau khi kết nối. |
| Heartbeat | Client gửi `{"type":"ping"}`; server trả `{"type":"pong","timestamp":<epoch-ms>}`. |
| Khử trùng lặp | Không broadcast payload serialize giống hệt payload trước. |

Nguồn: `server/transport/ws-server.js`; browser clients ở
`public/dashboard.html` và `public/index.html`.

## Riot Client và GLZ

Client lấy credential cục bộ từ Riot lockfile; không yêu cầu người dùng nhập Riot
credential. Lockfile cung cấp loopback HTTPS URL và Basic header. Endpoint
`/entitlements/v1/token` cấp access/entitlement token và subject. Region, shard và
client version được đọc từ `ShooterGame.log`.

| Request | Khi nào gọi | Input/kết quả |
|---|---|---|
| `GET https://127.0.0.1:<lockfile-port>/entitlements/v1/token` | Refresh local Riot auth | Riot local Basic auth; trả access/entitlement token và subject. |
| `GET <lockfile-base>/chat/v4/presences` | Đầu mỗi score poll | Lấy presence hiện tại của người chơi và giải mã private payload. |
| `GET https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/players/{puuid}` | Presence không kết luận được | Riot access/entitlement/client headers; trả `MatchID`; 404 nghĩa là không có trận hiện tại. |
| `GET https://glz-{region}-1.{shard}.a.pvp.net/core-game/v1/matches/{matchId}` | Có MatchID | Lấy players/teams/round wins/map/mode. |

Đây là endpoint mà client hiện quan sát/gọi, không phải bảo đảm về API công khai
của Riot. Polling, response field và fallback cần được rà soát lại nếu Riot thay
đổi dịch vụ.

## License và version API KLD

`server/licensing/config.js` sở hữu path constants và product ID
`valorant-alert`. `server/licensing/kld-client.js` gửi JSON, gắn session JWT ở
những request cần xác thực. Implementation route KLD thuộc repository riêng.

| Tác vụ KLD | Caller cục bộ | Mục đích |
|---|---|---|
| Google client ID / OAuth exchange | `KldClient` và loopback callback | Đăng nhập Google từ browser PC, đổi kết quả OAuth thành KLD session. |
| License đã áp dụng / license người dùng / claim / apply | `KldClient`, `LicenseGate` | Tìm license tài khoản và liên kết license với account hiện tại. |
| Public license verify | `KldClient.verifyPublic` | Kiểm tra key cục bộ theo `productId`, device identity và app version. |
| Challenge nonce + activate | `KldClient`, `LicenseGate.activate` | Yêu cầu nonce ngắn hạn rồi bind/activate license; không tái sử dụng nonce. |
| Trial start/verify | `KldClient`, `LicenseGate` | Bắt đầu hoặc xác minh trial theo response KLD và local policy. |
| Plan feature/config | `KldClient` | Tìm feature grants cho product. |
| App version/download resolver | `server/licensing/app-version.js` | Ưu tiên KLD metadata; kiểm tra product echo; fallback GitHub Releases. |

### Product scoping và comment cũ

KLD snapshot `1e8c296d1db0019284c57e1b00f06f45f52852d2` có public version handler
theo product trong `worker/domains/releases/release-handlers.ts`, product-specific
cache key và optional `productId` echo. Migration bao gồm
`0044_add_application_version_configs.sql`. Điều này khác với comment cũ trong
`server/licensing/app-version.js` nói version row KLD là global. Runtime guard của
app vẫn yêu cầu KLD echo đúng product trước khi tin version response. Comment
source cũ chưa được sửa trong task tài liệu.

KLD download resolver cũng theo product. App trỏ GitHub fallback tới
`103PU/Valorant-Alert-Release`, không phải source repository.

## Publisher và subscriber của Cloud Relay

### PC publisher

`server/transport/cloud-relay.js` chỉ publish khi relay bật, có entitlement
`cloud_relay`, session có JWT/user identity, không bị policy bỏ qua payload idle
giống hệt và không có request đang chạy.

Publisher POST score payload tới `/api/relays/live` kèm session authorization.
Chỉ khi HTTP 404 mới fallback sang route legacy `/api/relay/score`, sau đó ghi nhớ
endpoint dùng được. Response lỗi khác làm relay disconnected và ghi nhận error.

### Mobile PWA subscriber

PWA đọc `/api/relay/score?userId=<account-id>` theo chu kỳ HTTP polling. KLD
snapshot được pin có xử lý riêng route legacy `/api/relay/score` và hiện đại
`/api/relays/live`; `userId` không có pairing token chỉ được chấp nhận ở legacy
path. Modern route yêu cầu pairing token. KLD trả `no_active_match` nếu không có
row hoặc snapshot cũ hơn 10 phút.

Đây là ranh giới tương thích và có ý nghĩa security, không phải khuyến nghị thiết
kế. Không mô tả legacy read thành token-authenticated; không gỡ route nếu chưa
migrate PWA và contract tests ở cả hai repo.

KLD snapshot có backend migrations `0053_mobile_companion_and_relay.sql`,
`0054_mobile_pairing_security.sql`, `0055_mobile_push_tokens.sql`. Tuy nhiên
worktree Valorant Alert hiện không có native Android/iOS client, PC pairing route
hoặc APK build workflow để hoàn tất user flow. Đây là backend capability, chưa
phải feature client đã xác minh.

## GitHub Releases, updater và Discord

Update check ưu tiên KLD download/version metadata. Nếu không tin cậy được, app
kiểm tra latest release ở GitHub. GitHub fallback chỉ có thể đề xuất soft update
(`forceUpdate: false`); force-update chỉ nhận từ KLD product-version response.

`POST /api/license/update/start` loopback-only, cần share PIN và không nhận
version/URL do caller chọn. `server/updater/index.js` tải setup executable hoặc
compatibility ZIP, xác minh với `SHA256SUMS.txt`, có thể kiểm tra artifact
signature theo secure release mode rồi handoff cho installer.

Dashboard có hành vi Discord webhook tùy cấu hình. Đây khác với shared Discord
release proxy trong
`docs/superpowers/specs/2026-10-02-shared-discord-proxy-design.md`; design spec
không chứng minh proxy đã deploy hoặc đang được release workflow dùng.
