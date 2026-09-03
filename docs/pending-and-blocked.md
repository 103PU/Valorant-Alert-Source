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
2. Theo dõi `snapshot().signature` (`{verified, kid, warning}`) trên máy thật: mọi
   activate đã có `sig` chưa? `warning: 'signature_missing'` còn xuất hiện không?
3. Chỉ khi (2) sạch mới đổi `REQUIRE_SIGNATURE = false` → `true`, ship version mới.

---

## 2. Chờ quyết định của người dùng — không phải chờ code

| Việc | Trạng thái | Cần gì |
|---|---|---|
| `relay/` | Đã cho vào `.gitignore`, **file vẫn còn trên đĩa** | Xác nhận: giữ local vĩnh viễn, hay xoá hẳn. Tôi không xoá vì không hoàn tác được |
| Version tiếp theo | `package.json` + `config.json` đang `1.0.0` | Bump cả **hai** chỗ cùng lúc; test `release-artifacts` pin chúng với nhau, workflow assert tag khớp `package.json` |

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
