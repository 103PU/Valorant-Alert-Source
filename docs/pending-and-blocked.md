# Đang chờ gì, chờ ai, yêu cầu chính xác cái gì

Cập nhật: 2026-09-04. Nhánh `feature/license-gate`.

Mục đích của file này: mọi thứ **chưa xong** đều phải có tên người chịu và một câu
yêu cầu cụ thể. Không có mục nào ghi "đang chờ" chung chung.

---

## 1. Chờ KLD — 3 việc, theo đúng thứ tự này

Thứ tự không đổi được: đảo lại là **mọi** install đang chạy sẽ không activate được.
Lý do đầy đủ ở `kld-entitlement-signing.md` §7.

### 1.1 KLD sinh keypair Ed25519 và deploy signing

**Yêu cầu gửi KLD, nguyên văn:**

> Implement §11 của `docs/kld-entitlement-signing.md`. Cụ thể: sinh 1 keypair
> Ed25519, để private key trong Worker secret (`wrangler secret put`), rồi thêm 3
> field `entitlement` / `sig` / `kid` vào response của **cả hai** endpoint:
> `POST /api/me/licenses/{key}/activate` và `/api/trials/*`. Field cũ giữ nguyên
> hết — client cũ không đọc `sig` vẫn phải activate bình thường.
> Bắt buộc dùng WebCrypto (`crypto.subtle`), **không** dùng `node:crypto` (§11.3).
> Sign trên **đúng bytes của string `entitlement`** đã base64url, không sign trên
> object đã parse — canonicalisation là chỗ hai bên lệch nhau dễ nhất (§3).

**Cần họ trả về:** `kid` (string) + public key 32 byte raw, base64. Public key
không phải secret, gửi qua kênh nào cũng được. **Private key thì không.**

**Chặn cái gì:** không có key thì `PUBLIC_KEYS` trong `server/licensing/signing-keys.js`
phải để rỗng, và `REQUIRE_SIGNATURE` phải là `false`. Đây là lý do app hiện tolerate
response không có `sig`.

### 1.2 KLD trỏ application record về đúng repo

**Yêu cầu:**

> Application record của `valorant-alert` trong KLD phải trỏ owner/repo về
> `103PU/Valorant-Alert-Source`. Download resolver quét release của repo này;
> trỏ sai repo thì nút Download vẫn dead end dù asset đã đúng tên.

**Không kiểm được từ repo này.** Phía app đã làm hết phần của mình: release sinh ra
`ValorantScoreAlert-v<ver>-win-x64.zip` + `SHA256SUMS.txt`, release không draft,
không prerelease, asset `state === 'uploaded'` — cả 3 điều kiện release đều được
assert trong `.github/workflows/release.yml`. Chi tiết ở `release-runbook.md`.

### 1.3 Sau khi 1.1 xong — bật `REQUIRE_SIGNATURE`

Việc của phía app, nhưng **chỉ làm được sau** 1.1. Ba bước, không gộp:

1. Điền `kid` + public key vào `PUBLIC_KEYS` (`signing-keys.js`). Có test invariant
   chặn tổ hợp `REQUIRE_SIGNATURE = true` + map rỗng, nên bước này phải trước.
2. Theo dõi trên máy thật bằng endpoint có sẵn — app đang chạy thì:

   ```
   GET http://127.0.0.1:3000/api/license/status
   ```

   Nó trả `gate.snapshot()` (`server/licensing/gate.js:116-138`), trong đó có block
   `signature: {verified, kid, warning}`. Cần thấy: mọi activate đã có `sig` chưa
   (`verified: true`), và `warning: 'signature_missing'` còn xuất hiện không.
3. Chỉ khi (2) sạch mới đổi `REQUIRE_SIGNATURE = false` → `true`, ship version mới.

---

## 2. Đã quyết — không chờ ai nữa

Hai việc dưới đây từng là "chờ người dùng quyết". Người dùng giao lại quyền quyết
(2026-09-04), đã chốt như sau.

### 2.1 `relay/` — GIỮ trên đĩa, không xoá

Quyết định: **giữ**, và giữ nguyên trong `.gitignore`.

Lý do quyết định được, không phải phỏng đoán:

- `git log --all -- relay/` **rỗng**, và `git rev-list --all --objects` có **0** object
  nào mang path `relay/`. Tức là `relay/` chưa từng được commit. Xoá là mất vĩnh viễn,
  không `git checkout` nào lấy lại được — đây là bản duy nhất còn tồn tại.
- Giữ tốn **183 KB / 36 file**. Đã gitignore nên không lọt vào commit; `build.js` đã
  liệt `relay` trong `--exclude` của caxa nên không lọt vào `.exe` (đã verify bằng
  cách bung tar trong exe đã publish của v1.0.0: 436 entry, không có `relay/`).
- Bất đối xứng rõ: giữ tốn 183 KB, xoá mất không hoàn tác. Không có lý do chọn cái thứ hai.

Chống nhầm lẫn: `relay/wrangler.jsonc:1-11` đã ghi rõ ABANDONED + ngày, và tên Worker
đã bị đổi thành `valorant-alert-relay-abandoned-do-not-deploy` để `wrangler deploy`
lỡ chạy thì tạo Worker rác chứ không ghi đè Worker notice đang live. Thêm
`relay/README-ABANDONED.md` ở gốc thư mục để không phải mở `wrangler.jsonc` mới biết.

### 2.2 Version — xoá bản copy, không đồng bộ nó

Quyết định: **`package.json` là nguồn duy nhất.** Đã xoá block `build` khỏi
`config.json`.

Lý do: `config.json:build.version` **không có gì đọc**. `resolveAppVersion`
(`server/licensing/config.js:41-48`) đọc `package.json`; không route nào trong
`server/routes/` serve version; không frontend nào hiển thị. Nó chỉ tồn tại để bị
quên lúc bump. Cùng lý do đã xoá `keylicense.allowedPlans` — field chết trong file
người dùng sửa được thì phải xoá, không phải đồng bộ.

Bump version từ giờ = sửa **một** dòng `package.json`, rồi `git tag` đúng con số đó.
Workflow assert tag khớp `package.json`; test assert `config.json` không mọc lại field
version. Chi tiết ở `release-runbook.md` §4.

---

## 3. KHÔNG chờ ai cả — đã chốt là ngoài scope

Ghi ra để không ai tưởng đây là việc còn dở. Chi tiết ở
`kld-entitlement-signing.md` §9.

- **Lùi đồng hồ hệ thống.** Grace tính từ `issuedAt` đã ký vẫn bị lùi clock máy.
  Chặn được bằng `Date` header của một HTTPS response, nhưng offline thì không có.
  ValorantTweaks cũng có đúng giới hạn này.
- **Patch JS trong archive caxa.** Xoá dòng verify là xong. Đây là trần của mọi app
  Node plaintext; code signing chỉ làm nó ồn ào hơn, không chặn được.
- **Installer artifact.** `installerZipName()` đã có trong `release-naming.js` và có
  test, nhưng chưa có installer thật. Resolver phân biệt bằng chữ `installer` trong
  tên, nên thêm sau không phá gì.

Nói gọn: signing đưa bypass từ *"sửa file text, 0 công cụ"* lên *"phải patch code
trong archive"*. Đúng bằng mức ValorantTweaks đang có, và đó là toàn bộ mục tiêu.
