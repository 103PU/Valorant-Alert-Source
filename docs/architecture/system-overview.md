# Tổng quan hệ thống

## Ranh giới sản phẩm

Valorant Alert là ứng dụng Node.js chạy trên PC Windows. Ứng dụng đọc trạng thái
trận từ Riot Client trên cùng máy, tính trạng thái điểm số rồi gửi snapshot tới
dashboard trình duyệt và mobile PWA. PC host sở hữu việc polling Riot. KLD sở hữu
license/account API và Cloud Relay tùy entitlement; KLD không tự polling game.

Mobile client trong repository này là HTML/JavaScript. Ở snapshot được khảo sát
không có thư mục Android/iOS native, endpoint pairing phía PC hoặc workflow build
APK. KLD có thể có backend capability về pairing/push nhưng không chứng minh app
native đã được tích hợp hoặc phát hành.

## Thành phần runtime

| Thành phần | Trách nhiệm và ranh giới | Bằng chứng chính |
|---|---|---|
| `server/index.js` | Entrypoint: nạp config, xác định đường dẫn, khởi tạo licensing, HTTP/WebSocket, Cloud Relay, score poller, nối callback và listen. | `server/index.js`: khởi tạo subsystem, callback, `server.listen`. |
| `server/riot/lockfile-reader.js` | Đọc Riot lockfile trong `%LOCALAPPDATA%`, trích port/password/protocol, dựng loopback URL và Basic authorization. | `readLockfile`. |
| `server/riot/riot-auth.js` | Gọi Riot Local API `/entitlements/v1/token`, giữ cache access/entitlement token và subject, hỗ trợ refresh. | `refreshAuthData`, `getAuthData`. |
| `server/riot/riot-region.js` | Đọc region, shard và client version từ `ShooterGame.log`; cache kết quả phân tích. | `getRegionInfo`. |
| `server/core/score-poller.js` | Poll presence trước, dùng GLZ khi presence không kết luận được; ánh xạ team/score, metadata, alert status và heartbeat. | `pollOnce`, `notifyUpdate`. |
| `server/core/alert-rules.js` | Hàm thuần đánh giá `IN_MATCH`, `MATCH_POINT_RISK`, `MATCH_VICTORY`, `MATCH_DEFEAT`. | `evaluateAlertStatus`; `test/alert-rules.test.js`. |
| `server/transport/ws-server.js` | WebSocket LAN cùng HTTP listener; token share ngắn, kiểm tra `score_hud`, gửi snapshot cuối và xử lý ping/pong. | `generateToken`, `init`, `broadcastScore`. |
| `server/transport/cloud-relay.js` | Publisher KLD tùy chọn; yêu cầu cấu hình bật, entitlement `cloud_relay`, session; giảm push trùng/thừa và fallback route khi HTTP 404. | `broadcastScore`. |
| `server/licensing/` | KLD client, session store, local service policy, gate, entitlement signature verifier và version check. | `index.js`, `gate.js`, `kld-client.js`, `policy.js`, `signature.js`. |
| `server/app.js` + `server/routes/` | HTTP dispatch cho info, QR, licensing, static files và settings. Settings route chỉ có trong working tree chưa commit tại thời điểm khảo sát. | `createApp`, các route được đăng ký. |
| `public/dashboard.html` | Dashboard PC: trạng thái trận/license/update, cài đặt, liên kết chia sẻ và alert controls. File đang dirty; không dùng làm evidence của HEAD. | DOM và client handlers trong file. |
| `public/index.html` | Mobile PWA: LAN WebSocket hoặc Cloud Relay polling, UI/audio/vibration trên trình duyệt. File đang dirty; không dùng làm evidence của HEAD. | `startCloudRelay`, WebSocket client. |
| KLD Worker | Dịch vụ ngoài cho license/version/relay. Mã nguồn không thuộc repository này. | KLD snapshot được pin trong [mục lục](README.md). |
| GitHub Releases | Nguồn fallback version và artifact; release repo cấu hình là `103PU/Valorant-Alert-Release`. | `RELEASE_REPO`, `checkGitHub`, `UpdateInstaller`. |

## Khởi động

1. Launcher chạy `server/index.js`.
2. Host xác định source/package root, `publicDir` và đọc `config.json`.
3. Giá trị mặc định trong runtime gồm port `3000`, poll active `2500ms`, poll
   idle `5000ms`, token refresh `45` phút và enemy score threshold `12`.
4. Host thử hạ process priority xuống dưới normal.
5. Khởi tạo licensing, HTTP server, WebSocket server, CloudRelay và `ScorePoller`.
   WebSocket cần service `score_hud`; CloudRelay cần `cloud_relay`.
6. Callback của poller chuyển snapshot đến WebSocket và CloudRelay; publisher tự
   kiểm tra entitlement/session và chính sách giảm push.
7. HTTP listen trên `0.0.0.0:<port>`; đây là listener có thể truy cập qua LAN,
   không chỉ loopback. WebSocket upgrade dùng chung server.
8. Startup in URL dashboard/mobile và QR terminal, có thể mở dashboard trên
   Windows, sau đó chạy licensing gate. Gate quyết định khi nào polling bắt đầu.

**Lưu ý an toàn:** share token xuất hiện trong URL tạo sẵn. Không chụp/chia sẻ URL
hoặc response `/api/info` cho người không tin cậy. Do host bind mọi interface,
kiểm tra route-level token/loopback là ranh giới quan trọng.

## Thu thập dữ liệu và tính điểm

`ScorePoller.start()` chạy tuần tự một poll rồi mới lên lịch poll tiếp theo; không
dùng interval timer chồng lặp.

1. `getAuthData()` lấy thông tin Riot local. Nếu không có lockfile, poller phát
   `GAME_CLOSED`, `inGame: false`, score bằng 0.
2. Poller gọi Riot Local API `/chat/v4/presences` qua HTTPS loopback lấy từ
   lockfile.
3. Nếu private presence của người chơi là `INGAME`, đọc score/metadata từ presence
   rồi kết thúc lượt; không gọi GLZ.
4. `MENUS` và `PREGAME` lần lượt ánh xạ thành `NO_MATCH` và `AGENT_SELECT`.
   Presence lỗi hoặc state không nhận diện được thì rẽ sang GLZ.
5. Đường GLZ đọc region/shard/version, gọi
   `/core-game/v1/players/{puuid}` lấy `MatchID`, rồi
   `/core-game/v1/matches/{matchId}` để lấy team và round wins. GLZ 401 kích hoạt
   refresh token và retry player request; 404 nghĩa là không có trận hiện tại.
6. `TeamID` của người chơi quyết định allied score; team còn lại là enemy score.
   Map ID và queue/provisioning được định dạng cho UI.
7. Gọi `evaluateAlertStatus(alliedScore, enemyScore, threshold)`. Mặc định
   `server/index.js` là `12`; `ScorePoller` chỉ dùng `11` nếu không nhận được
   config truthy.
8. `notifyUpdate()` gửi khi field liên quan đổi hoặc đến heartbeat 10 giây.
   WebSocket tiếp tục bỏ qua payload serialize giống hệt payload trước.

Logic thuần trong `alert-rules.js`:

- `MATCH_VICTORY` khi một bên đạt ít nhất 13 và chênh tối thiểu 2; kết quả thắng/
  thua được xác định theo team người chơi.
- `MATCH_POINT_RISK` khi enemy đạt ngưỡng cấu hình và cao hơn allied score.
- Các trường hợp còn lại là `IN_MATCH`.

Overtime không phải backend status riêng; match point overtime vẫn qua cùng luật
score/threshold. UI có thể có event toggle, round-change hoặc âm thanh lặp; các
điều đó không phải state do hàm rule thuần phát ra.

## Gửi điểm và cảnh báo

### PC và LAN

Callback trong `server/index.js` phát JSON snapshot tới WebSocket client đã xác
thực. Kết nối mới nhận snapshot cuối nếu có. Client gửi
`{"type":"ping"}` sẽ nhận `{"type":"pong","timestamp":<epoch-ms>}`.

Dashboard tạo visual/audio alert từ snapshot và cài đặt phía UI. Browser audio
thường cần user activation; thao tác bật audio là một phần luồng sản phẩm. Không
đồng nhất status do server tính với mọi tình huống UI như round-change hoặc sound
preset.

### 4G và Cloud Relay

Khi đã đăng nhập và có `cloud_relay`, PC publisher gửi snapshot đến KLD. Publisher
ngăn request đồng thời, gộp idle payload không đổi và giới hạn nhịp gửi khi đang
trong trận. PWA đọc snapshot bằng HTTP polling; source client không dùng SSE stream.

PWA hiện đọc route legacy `/api/relay/score?userId=...`; PC publisher ưu tiên
`/api/relays/live`. KLD phân biệt hai đường này. Đây là contract tương thích giữa
hai repository, không được gộp thành một endpoint đối xứng khi chưa đổi và test
cả hai phía.

## License, chữ ký và service policy

`server/licensing/config.js` có mặc định KLD base URL/product ID, OAuth callback
loopback port `8750`, timeout `5000ms`, offline grace mặc định 3 ngày và release
repo `103PU/Valorant-Alert-Release`. `server/licensing/policy.js` giới hạn offline
grace tối đa 7 ngày.

| Fallback plan phía client | Services |
|---|---|
| `trial` | `score_hud`, `riot_poller` |
| `plus` | `score_hud`, `riot_poller`, `sound_engine`, `desktop_dashboard` |
| `pro` | Các service của Plus + `match_analytics` |
| `ultra` | Các service của Pro + `cloud_relay` |

Bảng trên chỉ là fallback policy phía client, không phải pricing hay cam kết plan
production của KLD. KLD sở hữu catalog/grants. Mã client nhận diện sáu service
codes trong `policy.js`; thay đổi phải đồng bộ contract và tests.

App nhúng public key Ed25519 ID `va-2026-09`. Signature có mặt sẽ được verify;
binding mismatch hoặc chữ ký sai bị từ chối. `REQUIRE_SIGNATURE` hiện là `false`,
nên trường hợp thiếu signature/unknown key vẫn được tolerate trong rollout.
`docs/kld-entitlement-signing.md` có một số claim cũ; đối chiếu
`signing-keys.js` và `test/license-signature.test.js`.

## Dữ liệu và lưu trữ

| Dữ liệu | Vị trí/owner hiện thấy | Ghi chú |
|---|---|---|
| Runtime config | `config.json` tại source/install root | File user-editable; không phải nơi lưu trust anchor hay authorization policy. |
| Login/license cache | `%APPDATA%\ValorantAlert\` qua licensing store | Session/credential là dữ liệu cục bộ; không chia sẻ log/token. |
| UI settings | `%APPDATA%\ValorantAlert\settings.json` trong working tree | Có `server/routes/api-settings.js` chưa commit; merge defaults khi lưu. |
| Score hiện tại | In-memory poller và WebSocket last payload | Dựng lại từ Riot khi poll; chưa thấy match history bền vững ở luồng được khảo sát. |
| Cloud score snapshot | KLD relay persistence | KLD sở hữu lưu trữ/retention; xem migration `0043_create_live_match_relays.sql` tại repo KLD đã pin. |
| Logs | Đường dẫn cấu hình trong `server/utils/logger.js` | Không ghi/chia sẻ PIN, OAuth credentials hoặc thông tin cá nhân. |

Không tìm thấy relational DB/schema phía PC trong source đã khảo sát; vì vậy không
tạo ERD cục bộ. Không suy diễn schema KLD từ tên migration.

## Trạng thái và phần chưa xác minh

- **Đã triển khai trong source:** PC host, Riot polling, browser dashboard/PWA, LAN
  WebSocket, client licensing, và Cloud Relay.
- **Có test trong repository:** một số logic core, contract và update behavior;
  test không chứng minh Riot/KLD production hoặc thiết bị Windows sạch.
- **Chưa xác minh trong worktree này:** Android/iOS native app, PIN pairing phía
  PC, FCM/APNs alarm receiver, APK artifact và build workflow APK.
- `docs/SERVER_CLOUD_RELAY_SPEC.md` mô tả một route/schema cũ khác (publisher
  `/api/relay/score` và SSE); không dùng làm hợp đồng hiện hành nếu chưa đối chiếu.
- Không khẳng định release repo hiện có artifact tải được, installer đã chạy trên
  Windows VM sạch, hoặc Riot endpoints ổn định như public API.
