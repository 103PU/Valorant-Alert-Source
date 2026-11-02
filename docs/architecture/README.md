# Tài liệu kiến trúc Valorant Alert

Đây là mục lục chuẩn cho tài liệu kiến trúc. Nội dung mô tả hành vi có bằng chứng
trong mã nguồn; tài liệu cũ, handoff và kế hoạch không thay thế source code, test,
schema hoặc migration.

## Lộ trình đọc

1. Bắt đầu từ [Tổng quan hệ thống](system-overview.md): sản phẩm, thành phần,
   luồng điểm số, cảnh báo, trạng thái và lưu trữ.
2. Tra [Hợp đồng tích hợp](integration-contracts.md) khi cần endpoint, giao thức,
   kiểm soát truy cập hoặc quan hệ với Riot/KLD/GitHub.
3. Dùng [Dựng, kiểm thử và phát hành](rebuild-release.md) để clone, chạy, test,
   đóng gói và chẩn đoán.

### Sơ đồ tổng quan

[Sơ đồ kiến trúc runtime](diagrams/valorant-alert-system.html) trả lời câu hỏi
“PC host, dashboard, PWA và dịch vụ ngoài kết nối với nhau như thế nào?”.
[Nguồn Archify](diagram-src/valorant-alert-system.json) là file cần sửa; HTML và
receipt là output được sinh. Đây là sơ đồ overview duy nhất hiện có. Chưa tạo ERD:
ứng dụng PC không có relational schema riêng để chứng minh; dữ liệu relay do KLD
quản lý trong repository khác.

## Bản đồ chủ đề và nguồn chuẩn

| Chủ đề / câu hỏi | Tài liệu chuẩn | Bằng chứng trong mã/schema/test | Tài liệu phụ / liên kết | Trạng thái |
|---|---|---|---|---|
| Thành phần nào chạy ở đâu? | [Tổng quan hệ thống](system-overview.md) | `server/index.js`, `server/app.js`, `public/` | [Sơ đồ runtime](diagrams/valorant-alert-system.html) | Hành vi ứng dụng hiện tại |
| Điểm số thành cảnh báo ra sao? | [Tổng quan hệ thống](system-overview.md) | `server/core/score-poller.js`, `server/core/alert-rules.js`, `test/alert-rules.test.js` | [Hợp đồng Riot](integration-contracts.md) | Có test cho logic cốt lõi; chưa chứng minh Riot production |
| Browser kết nối host/KLD thế nào? | [Hợp đồng tích hợp](integration-contracts.md) | `server/app.js`, `server/routes/`, `server/transport/`, `public/index.html`, `public/dashboard.html` | [Luồng gửi điểm số](system-overview.md) | Có LAN/WebSocket và Cloud Relay |
| Dữ liệu nào được lưu? | [Tổng quan hệ thống](system-overview.md) | `config.json`, `server/licensing/store.js`, `server/routes/api-settings.js` trong worktree | KLD migrations được pin riêng | Không có ERD SQL cục bộ; settings route chưa commit |
| License, update và ranh giới an toàn ra sao? | [Hợp đồng tích hợp](integration-contracts.md) | `server/licensing/`, `server/routes/api-license.js`, `server/updater/`, tests tương ứng | [Runbook build/release](rebuild-release.md) | Tài liệu mô tả source; không phải security audit |
| Clone, test, build và phát hành thế nào? | [Dựng, kiểm thử và phát hành](rebuild-release.md) | `package.json`, `scripts/`, `.github/workflows/` | [`docs/release-runbook.md`](../release-runbook.md) | Lệnh có thể kiểm tra; runtime/release thật cần môi trường riêng |
| Đề xuất, lịch sử và quyết định cũ ở đâu? | Không phải nguồn chuẩn về runtime | Không chứng minh implementation | [`pending-and-blocked.md`](../pending-and-blocked.md), [`SERVER_CLOUD_RELAY_SPEC.md`](../SERVER_CLOUD_RELAY_SPEC.md), [`kld-entitlement-signing.md`](../kld-entitlement-signing.md), `docs/superpowers/` | Đọc như tài liệu phụ; đối chiếu source trước khi dùng |

Không lập sơ đồ BA riêng cho native companion, FCM/APNs hay APK release trong
snapshot này: chưa thấy app Android/iOS, endpoint pairing phía PC, hoặc workflow
build APK trong worktree. Cũng không mô hình hóa cơ sở dữ liệu KLD bằng suy luận từ
tên migration; muốn có ERD KLD phải khảo sát đúng repository và revision của KLD.

## Quy ước bằng chứng và trạng thái

- **Implemented**: có đường chạy trong source được nêu.
- **Test-covered**: test tự động bao phủ hành vi; không chứng minh dịch vụ Riot/KLD
  production, thiết bị thật hoặc installer sạch.
- **Uncommitted**: chỉ thấy ở working tree; chưa thuộc commit được pin.
- **Documented-only / proposed**: chỉ có trong spec/handoff, chưa thấy đường chạy
  tương ứng trong mã nguồn hiện tại.
- **Historical / legacy**: được giữ để tra cứu, không phải hợp đồng runtime.
- **Unknown**: bằng chứng chưa đủ để kết luận.

Mỗi claim phải ghi rõ revision và nguồn kiểm chứng. Khi có mâu thuẫn, ưu tiên
source/config/schema/test tại revision được pin; không dùng nội dung trong báo cáo
agent để nâng trạng thái một tính năng. Handoff chỉ là manh mối cần xác minh.

## Snapshot và thay đổi chưa commit

Kiểm tra ngày **2026-11-02** trên repository `103PU/Valorant-Alert-Source`,
nhánh `main`, `HEAD`:
`195cdac2cf44ab1753911d28b60a71b3d450eeec`. Working tree vẫn dirty. Các thay đổi
chưa commit ngoài bộ docs này bao gồm README/package lock, dashboard/PWA, tray,
host/server, licensing, API info, Cloud Relay, WebSocket, settings route và test.
Không dùng byte của các file dirty làm evidence cho commit HEAD; những dòng chưa
được đối chiếu lại chỉ được gọi là trạng thái working tree.

Các ghi chú local về mobile ghi nhận tiến độ nhưng chưa đủ làm bằng chứng triển
khai. Trong worktree kiểm tra, không có `android/`, `public/download/`,
`server/routes/api-mobile-pin.js`, `test/mobile-alert-scenarios.test.js` hay
`.github/workflows/build-apk.yml`; tìm trong `server/`, `public/`, `test/` và
workflow cũng không thấy pairing endpoint, FCM receiver hoặc APK build flow.
Vì vậy Android native, push alarm, PIN pairing và phân phối APK hiện là
**chưa được xác minh trong repository này**, bất kể trạng thái ghi trong handoff.
Không xóa hay sửa handoff local trong task tài liệu này.

KLD là repository riêng `103PU/Keylicensedashboard`. Những tham chiếu backend
được pin vào snapshot
[`1e8c296d1db0019284c57e1b00f06f45f52852d2`](https://github.com/103PU/Keylicensedashboard/tree/1e8c296d1db0019284c57e1b00f06f45f52852d2).
Worktree KLD khác không được kiểm chứng trong task này. Không đọc hoặc ghi secret
production.

## Quyền riêng tư và phạm vi phát hành

Repository GitHub này là **public**: mọi tài liệu được commit tại đây sẽ công khai
trên GitHub. Không đưa credential, token, dữ liệu người dùng, URL vận hành riêng
tư hoặc quy trình nội bộ nhạy cảm vào docs. Các thư mục agent/handoff local không
phải tài liệu sản phẩm và được `.gitignore` loại khỏi commit mặc định.

Build static hiện sao chép riêng `public/` vào `dist/`; docs không nằm trong bundle
đó. Điều này không làm docs riêng tư nếu chúng được commit vào repository public.
Không deploy/publish trong task này.

## Sinh và kiểm tra sơ đồ

- Sửa JSON tại `diagram-src/`, không chỉnh HTML sinh bằng tay.
- Archify được dùng để render/validate; `diagram-design` định hướng chọn loại sơ
  đồ, cấu trúc, readability và accessibility, không phải compiler.
- Evidence trong IR trỏ vào byte đã commit tại revision nêu trong `meta.repository`;
  worktree dirty không thể thay thế bằng chứng revision đó.
- Sau khi sửa source, chạy Archify `finalize` với `--repo-root`, kiểm tra
  provenance/receipt và browser-check; mở và xem screenshot desktop/mobile/theme
  liên quan. Nếu Archify không tạo viewport điện thoại, chụp thủ công bằng
  Chromium; ghi warning còn lại thay vì tuyên bố pass chung chung.
- KLD có workflow Archify riêng; không giả định npm script/build của KLD tồn tại
  ở repository này.

Sơ đồ hiện dùng renderer/theme của Archify. Đây không phải tuyên bố về brand
palette chính thức của Valorant Alert. Diagram labels và navigation dùng tiếng
Việt; tên API, enum, route và component giữ nguyên để tra cứu mã.

Lần kiểm tra **2026-11-02**: Archify finalize/browser-check pass, screenshot
1440×900 và 2048×1320 ở cả hai theme đã được xem. Canvas không có crossing,
clipping hoặc text collision. Screenshot Chromium 390×844 cho thấy canvas dùng
thanh cuộn ngang cục bộ, nhưng toolbar và các card phụ bị cắt ở viewport hẹp;
mobile review vì vậy **PARTIAL**, không phải responsive pass. Validator gợi ý
review đường host → GitHub vì có 3 bend; giữ route hiện tại vì đường nối/nhãn
đọc được và không giao cắt ở desktop. Renderer chưa có locale tiếng Việt hoặc
palette tùy chỉnh cho toolbar/canvas; legend và nội dung do dự án viết được Việt
hóa, nhưng theme hiện tại không phải brand palette chính thức của Valorant Alert.

`diagram-design/scripts/self_check.py` không phải validator cho HTML do Archify
sinh: nó áp dụng contract template riêng (một script controls, không có asset URL
ngoài fragment và một motion root). Lệnh đã chạy nhưng không tương thích với
artifact này; dùng Archify `finalize`, `check --require-provenance` và
`visual-check` làm validator của sơ đồ Archify.
