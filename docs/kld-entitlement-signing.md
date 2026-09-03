# Yêu cầu KLD: sign entitlement response (Ed25519)

**Trạng thái:** đề xuất, chờ triển khai ở phía Keylicense Dashboard.
**Bên yêu cầu:** `Valorant-Alert-Source` (consumer).
**Bên triển khai:** `Keylicensedashboard` (issuer).
**Điều kiện tiên quyết:** không có. KLD đã có sẵn nonce, license record và device
binding tại thời điểm activate — chỉ cần **sign và trả thêm**, không cần thu thập
thêm dữ liệu nào.

---

## 1. Vấn đề đang cần đóng

App là Node plaintext chạy trên máy người dùng, đọc `config.json` nằm cạnh
`.exe`. Hai đường bypass sau **không thể đóng ở phía app**, vì app không có cách
nào phân biệt một response thật với một response tự tạo:

| # | Cách bypass | Vì sao app không tự đóng được |
|---|---|---|
| 2 | Trỏ `keylicense.baseUrl` sang mock server ~20 dòng trả `{ok:true, license:{...}}` | Response hợp lệ về mặt schema. App không có gì để đối chiếu. |
| 3 | Sửa `%APPDATA%\ValorantAlert\session.json` (`lastVerifiedAt`) + `maxOfflineDays` rồi chặn KLD ở hosts → `KldNetworkError` → `OFFLINE_GRACE` vĩnh viễn | Cache entitlement hiện là JSON thường, ai cũng viết được. Mốc thời gian grace (`store.js:77-82`) đọc từ chính file đó. |

Một chữ ký Ed25519 do KLD phát hành, app verify bằng **public key nhúng trong
code** (không phải trong `config.json`), đóng cả hai: mock server không có private
key, và cache offline chỉ được tin nếu chữ ký còn verify được.

Phía KLD hiện **chưa có** license-response signing. Đã grep toàn bộ
`worker/index.ts`: mọi hit `signature` / `ed25519` / `privateKey` đều là code
payment webhook (PayOS HMAC ~`:14134`, Stripe signature ~`:14460`). Đây là việc
mới, không phải bật cờ config.

---

## 2. Contract

### Request — KHÔNG đổi

App gọi y như hiện tại (`server/licensing/kld-client.js:135-149`):

```
GET  /api/licenses/challenge                       (Bearer JWT)  -> { nonce }
POST /api/me/licenses/{key}/activate               (Bearer JWT)
     { licenseKey, productId, deviceId, deviceName, platform, appVersion, nonce }
```

### Response — thêm 3 field, giữ nguyên field cũ

```json
{
  "ok": true,
  "license": { "...": "giữ nguyên như hiện tại, cho backward compat" },

  "entitlement": "<base64url(JSON payload — xem §4)>",
  "sig":         "<base64url(Ed25519(entitlement_bytes))>",
  "kid":         "va-2026-09"
}
```

Ba field mới là **additive**. Client cũ bỏ qua chúng và vẫn chạy như trước, nên
KLD có thể deploy trước app mà không phá install nào đang chạy (xem §7).

---

## 3. Sign trên bytes nào — quyết định duy nhất còn mở

Preview khi chốt phương án ghi `sig = ed25519(nonce|key|device|productId|plan|expiresAt)`.
Đề nghị **đổi sang detached payload** (`sig` ký trên đúng chuỗi `entitlement` được
truyền đi), giữ nguyên tinh thần, vì nó bỏ được cả một lớp lỗi:

| | Chuỗi nối bằng `|` | Detached payload (đề xuất) |
|---|---|---|
| Canonicalisation | Hai bên phải khớp **byte-exact**: thứ tự field, `expiresAt` khi null encode thế nào, `plan` có lower-case không, có trailing space không | Không có vấn đề này — app verify trên đúng bytes nhận được, rồi mới `JSON.parse` |
| Thêm field mới | Đổi format = phá chữ ký cũ | Thêm key vào JSON, không ảnh hưởng client cũ |
| Cache offline | Phải dựng lại chuỗi từ object đã parse để verify lại → dễ lệch | Cache 2 string, verify lại y nguyên |
| Debug khi lệch | "verify fail" không nói được vì sao | So sánh trực tiếp 2 string |

Đây chính là cách JWS detached payload hoạt động, và là lý do nó là chuẩn.

**Nếu KLD vẫn muốn dạng chuỗi nối**, vẫn chấp nhận được, nhưng phải chốt cứng
trong code cả hai bên: thứ tự field, separator, `null` → chuỗi rỗng, không
lower-case, không trim. Ghi rõ vào comment ở cả hai repo.

---

## 4. Payload (nội dung của `entitlement` trước khi base64url)

```json
{
  "v": 1,
  "nonce": "<đúng nonce app vừa gửi trong request activate>",
  "productId": "valorant-alert",
  "licenseKey": "VA-XXXX-XXXX-XXXX",
  "deviceId": "<đúng deviceId app vừa gửi>",
  "plan": "pro",
  "keyType": "subscription",
  "status": "active",
  "maxDevices": 3,
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "issuedAt": "2026-09-03T04:15:00.000Z",
  "kind": "license"
}
```

Vai trò của từng field — không field nào là trang trí:

| Field | Bắt buộc | Chống được gì |
|---|---|---|
| `v` | ✔ | Đổi scheme sau này mà không phá client cũ |
| `nonce` | ✔ | Replay. KLD đã cấp nonce TTL 5 phút, xoá khi dùng (`config.js:17-20`) — ký vào đó khiến một response cũ không dùng lại được |
| `deviceId` | ✔ | Copy `session.json` sang máy khác. Chữ ký chỉ hợp lệ trên đúng device đã activate |
| `productId` | ✔ | Replay một entitlement Valorant Tweaks sang Alert |
| `plan`, `keyType`, `status`, `maxDevices`, `expiresAt` | ✔ | Sửa tay các field này trong cache để tự nâng plan / gia hạn |
| `issuedAt` | ✔ | **Đây là field đóng bypass #3.** Offline grace tính từ `issuedAt` đã ký, không phải từ `lastVerifiedAt` trong `session.json` mà người dùng ghi được |
| `kind` | ✔ | Phân biệt `"license"` với `"trial"` (§6), tránh dùng chữ ký trial cho đường license |

`expiresAt: null` với key vĩnh viễn là hợp lệ — cứ để `null` trong JSON, đừng đổi
thành chuỗi rỗng hay bỏ field.

---

## 5. Quản lý key

- **Thuật toán:** Ed25519 (`crypto.sign`/`crypto.verify` trong Node built-in, app
  **không cần thêm dependency** — hiện app chỉ có 2 runtime dep và muốn giữ vậy).
- **Private key:** chỉ nằm ở Cloudflare Worker secret của KLD. Không commit, không
  log, không trả qua bất kỳ endpoint nào.
- **Public key:** nhúng **trong source app** (`server/licensing/signing-keys.js`),
  base64 raw 32 byte. **Không đặt trong `config.json`** — file đó người dùng ghi
  được, đặt public key vào đó thì tự thay key của mình là bypass lại.
- **`kid` + rotation:** app nhúng **một map nhiều key** (`{ "va-2026-09": "...",
  "va-2027-03": "..." }`) và chọn theo `kid` trong response. Nhờ vậy KLD rotate
  được mà không brick install cũ: thêm key mới vào app trước, KLD đổi sau.
- **Endpoint liệt kê key (tuỳ chọn, chỉ để chẩn đoán):** `GET /api/licenses/signing-keys`
  trả `{ keys: [{ kid, publicKey, notAfter }] }`. App **không được tin** endpoint
  này làm trust anchor — nếu tin thì mock server lại trả được key của nó. Chỉ dùng
  để cảnh báo sớm "app của bạn chưa biết kid mới, hãy cập nhật".

### 5.1 Đã kiểm chứng: verify được bằng built-in, 0 dependency mới

Chạy thật trên Node v24.16.0 của máy này, không cài gì thêm:

```
good signature        -> true
tampered plan         -> false
random sig            -> false
round-trip payload ok -> true
```

Chỗ duy nhất không hiển nhiên: app chỉ nhúng **32 byte raw** public key, nhưng
`crypto.createPublicKey` cần DER/SPKI. Prefix SPKI của Ed25519 là hằng số, nên
dựng lại bằng cách nối chuỗi — không cần thư viện:

```js
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function keyFromRaw(base64Raw) {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(base64Raw, 'base64')]),
    format: 'der',
    type: 'spki'
  });
}

// verify trên đúng bytes của chuỗi entitlement nhận được
crypto.verify(null, Buffer.from(entitlement), keyFromRaw(PUBKEYS[kid]),
              Buffer.from(sig, 'base64url'));
```

Phía KLD lấy 32 byte raw để đưa cho app bằng
`publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64')`.

**Đã kiểm chứng xuyên runtime, không chỉ Node-sign-Node-verify.** Bốn dòng kết
quả ở trên là Node sign rồi Node verify — tự nhất quán, nhưng chưa phải đường đi
thật. Đường đi thật (workerd sign → Node verify bằng đúng `keyFromRaw` ở trên)
đã được chạy và **PASS**; xem bảng ở §11.3. Nên `keyFromRaw` không còn là giả
thiết: nó đã đọc được chữ ký do workerd sinh ra.


---

## 6. Trial phải dùng cùng envelope

`/api/trials/start` và `/api/trials/verify` cũng cấp entitlement
(`gate.js:257` → `recordEntitlement(null, t)`), nên nếu chỉ sign đường license thì
trial trở thành bypass mới: mock server trả trial hợp lệ là xong.

Cùng envelope, `kind: "trial"`, payload:

```json
{ "v": 1, "nonce": "...", "productId": "valorant-alert", "deviceId": "...",
  "kind": "trial", "status": "active",
  "startedAt": "...", "expiresAt": "...", "issuedAt": "..." }
```

`/api/trials/verify` hiện **không** nhận nonce. Cần thêm: app sẽ lấy challenge
trước khi verify trial, giống đường activate. Nếu KLD không muốn đổi signature của
endpoint đó, chấp nhận được là bỏ `nonce` với trial và dựa vào `issuedAt` +
`deviceId` — trial giá trị thấp hơn license nên đánh đổi này hợp lý, nhưng phải là
**quyết định có ý thức**, ghi vào comment, không phải bỏ sót.

---

## 7. Thứ tự rollout — quan trọng, làm sai là chết install đang chạy

```
Bước 1  KLD deploy signing (additive)          → client cũ bỏ qua sig, vẫn chạy
Bước 2  App ship signing-keys.js + verify,
        REQUIRE_SIGNATURE = false               → verify nếu có sig, log khi thiếu
Bước 3  Theo dõi log: mọi activate đều có sig?
Bước 4  App bật REQUIRE_SIGNATURE = true       → response không sig bị từ chối
```

**Trạng thái:** bước 2 **đã xong** (§8). Bước 1 chưa. Chạy trước bước 1 vẫn an toàn
vì `PUBLIC_KEYS` rỗng + `REQUIRE_SIGNATURE = false` nghĩa là app hiện tolerate mọi
response y như client cũ — ràng buộc thứ tự của §7 là "app không được *bắt buộc* sig
trước KLD", chứ không cấm ship phần verify sớm. Bước 3 và 4 chờ KLD.

`REQUIRE_SIGNATURE` là **hằng số trong code**, không phải field trong
`config.json` — nếu để trong config thì người dùng tự tắt là bypass thứ năm.

Đảo thứ tự (app bắt buộc sig trước khi KLD ship) sẽ khiến **mọi** người dùng
không activate được. Đây là lý do bước 1 phải là KLD.

---

## 8. Phần app — ĐÃ LÀM (bước 2 của §7)

Bảng dưới là *đối chiếu kế hoạch với code thật đã ship*, không còn là dự định.
Số dòng đọc từ working tree hiện tại. `npm test` xanh 87/87.

| File | Thay đổi thực tế |
|---|---|
| `server/licensing/signing-keys.js` | **mới** — `PUBLIC_KEYS` (map `kid → base64 raw public key`) **đang để rỗng có chủ ý** vì KLD chưa sinh key; `REQUIRE_SIGNATURE = false`; `canRequireSignature()` để test chặn cấu hình chết |
| `server/licensing/policy.js` | **mới, không có trong kế hoạch** — `ALLOWED_PLANS`, `MAX_OFFLINE_DAYS_HARD_CAP = 7`, `isPlanAllowed()`, `clampOfflineDays()`. §9 mục 1 chỉ đòi "cùng trust class với public key"; tách file để mỗi file một việc |
| `server/licensing/signature.js` | **mới** — `verifyEnvelope`, `extractEnvelope`, `decodePayload`, `keyFromRaw`, `issuedAtMs`, `SignatureError`. **Sửa so với kế hoạch:** Ed25519 phải gọi `crypto.verify(null, ...)`, tham số algorithm là `'ed25519'` sẽ throw. Public key dựng bằng `ED25519_SPKI_PREFIX` (12 byte DER) + 32 byte raw → `createPublicKey({format:'der',type:'spki'})`. 0 dep mới, đã probe thật |
| `kld-client.js:135-149` | **không sửa gì.** Đọc code thật thì `activateLicense` đã `return this.request(...)` nguyên JSON đã parse — envelope tới nguyên vẹn từ trước. Chỗ làm mất envelope nằm ở `gate.js`, không phải đây |
| `gate.js:147-160` | **mới** — `verifyEntitlement()`: gói `verifyEnvelope`, ghi `this.signature = {verified, kid, warning}` cho cả nhánh thành công và nhánh throw, log warn khi tolerate |
| `gate.js:225-253` | verify **trước** `recordEntitlement`. `SignatureError` → `BLOCKED` (`reason` = mã lỗi), không rơi vào `KldNetworkError`/grace. Và `plan` đọc từ **payload đã ký**, không đọc `license.plan` không ký đi cùng response |
| `gate.js:382-409` | grace verify lại envelope cache mỗi lần boot; số ngày tính từ `issuedAt` **đã ký**, chỉ fallback về `lastVerifiedAt` khi không có envelope |
| `gate.js:78-94` | thêm seam `trust` (`{keys, requireSignature}`) vào constructor để test bơm key tạm; production truyền `null` → dùng đúng hằng số trong code |
| `store.js:17-20,60-74` | `entitlement: null` trong `EMPTY`; `recordEntitlement(license, trial, envelope)` lưu envelope **nguyên văn** (serialise lại payload đã parse là phá chữ ký); thêm `getEnvelope()`. `publicSnapshot()` giữ nguyên shape → `dashboard.html` không phải sửa |
| `config.js:5,77` | `clampOfflineDays(merged.maxOfflineDays)` — `config.json` rút ngắn được cửa sổ offline nhưng không nới ra được |
| `config.json` | xoá `allowedPlans` (đã chết, không chỗ nào trong `server/` đọc). Test chặn nó quay lại |
| `test/license-signature.test.js` | **mới, 32 test** — sinh keypair tạm mỗi lần chạy nên **không có key material nào nằm trong repo** |

### 8.1 Hai khoảng hở được tolerate khi `REQUIRE_SIGNATURE = false`

Chỗ này làm sai một trong hai chiều đều là lỗi thật, nên ghi rõ:

| Tình huống | `false` (đang ship) | `true` (sau khi KLD xong) |
|---|---|---|
| Không có `sig` | tolerate, log warn | từ chối |
| `kid` không có trong `PUBLIC_KEYS` | tolerate, log warn | từ chối |
| `sig` **sai** dưới `kid` **đã biết** | **từ chối** | từ chối |

Hai dòng đầu là version skew — chặt quá thì mọi install chết trước khi KLD deploy.
Dòng thứ ba là tampering thật: đã có key để verify mà verify fail thì không có lý
do nào để tolerate, nên nó `BLOCKED` ở cả hai mode. Có test cho từng ô.

`REQUIRE_SIGNATURE = true` + `PUBLIC_KEYS` rỗng sẽ từ chối *mọi* response, online
lẫn offline — có một test invariant chặn đúng tổ hợp đó.

---

## 9. Những gì việc này KHÔNG đóng — nói rõ để không tưởng là xong

1. ~~**Bypass #4 — `allowedPlans` sửa từ `config.json`.**~~ **ĐÃ ĐÓNG.**
   `ALLOWED_PLANS` giờ là hằng số `Object.freeze` trong `server/licensing/policy.js`
   (cùng trust class với public key), `config.json` đã bỏ field chết. `gate.js:242`
   check `isPlanAllowed(plan)` với `plan` lấy từ **payload đã ký** — response tự
   khai `pro` mà ký `free` vẫn bị `plan_not_allowed`; có test riêng cho đúng ca đó.
   Một quyết định cố ý: `plan` **rỗng/null thì không coi là vi phạm**. Chặn `null`
   sẽ brick khách thật trong khi không đóng được gì, vì kẻ tấn công sửa file thì
   xoá field còn dễ hơn đổi nó.
   (Bản tham chiếu logic cũ nằm ở `relay/worker/routes/gate.ts:38`, nhưng `relay/`
   đã bỏ từ 2026-09-02 và giờ nằm trong `.gitignore` — chỉ còn trên máy local, đừng
   trông đợi đường dẫn đó tồn tại trong repo.)
   Kèm theo đó, nửa còn lại của bypass #3 cũng đóng: `clampOfflineDays()` kẹp
   `maxOfflineDays` ở `MAX_OFFLINE_DAYS_HARD_CAP = 7` ngày, nên
   `"maxOfflineDays": 999999` trong config không kéo dài grace được nữa.
2. **Đổi giờ hệ thống.** Grace tính từ `issuedAt` đã ký vẫn bị lùi đồng hồ máy.
   Chặn được bằng cách so với `Date` header của một HTTPS response, nhưng khi
   offline thì không có. Đây là giới hạn ValorantTweaks cũng có; ghi nhận, không
   giả vờ đã đóng.
3. **Patch JS trong archive caxa (bypass loại 2).** Xoá luôn dòng verify là xong.
   Đây là trần của mọi app Node plaintext; code signing (`D1`) chỉ làm nó ồn ào
   hơn, không chặn được. Ngoài scope.

Nói cách khác: signing đưa bypass từ **"sửa file text, 0 công cụ"** lên
**"phải patch code trong archive"**. Đó là toàn bộ mục tiêu, và đúng bằng mức
ValorantTweaks đang có.

---

## 10. Acceptance

Phía KLD:

- [ ] `POST /api/me/licenses/{key}/activate` trả `entitlement` + `sig` + `kid`
- [ ] `sig` verify được bằng public key tương ứng `kid`, trên đúng bytes của `entitlement`
- [ ] `nonce` trong payload khớp nonce app gửi; nonce cũ vẫn bị từ chối như hiện tại
- [ ] `deviceId`, `productId` trong payload khớp request
- [ ] `/api/trials/*` dùng cùng envelope với `kind: "trial"`
- [ ] private key chỉ ở Worker secret; không endpoint nào trả nó
- [ ] client cũ (không đọc `sig`) vẫn activate bình thường

Phía app — **đã verify, `npm test` 87/87 xanh**:

- [x] sửa 1 byte trong `entitlement` → activate bị từ chối
- [x] mock server trả `{ok:true}` không có `sig` → bị từ chối khi `REQUIRE_SIGNATURE=true`
      (và tolerate + log warn khi `false`, đúng bước 2 của §7)
- [x] copy `session.json` sang máy khác → grace không chạy (lệch `deviceId`)
- [x] `maxOfflineDays: 999999` trong `config.json` → **không** kéo dài được grace
- [x] sửa `lastVerifiedAt` trong `session.json` → không kéo dài được grace
      (đếm ngày từ `issuedAt` đã ký)
- [x] `npm test` xanh, CI `node --check` phủ toàn bộ file mới (discovery tự động,
      36 file, floor guard ở 15)

Còn **chờ KLD**, không làm được ở phía app:

- [ ] điền `kid` + public key thật vào `PUBLIC_KEYS` (đang rỗng có chủ ý)
- [ ] bước 3 §7: theo dõi `snapshot().signature` xem mọi activate đã có `sig` chưa
- [ ] bước 4 §7: bật `REQUIRE_SIGNATURE = true`


## 11. Phía KLD làm gì — cụ thể, đã đọc code thật

Phần trên là *hợp đồng*. Phần này là *việc*. Mọi số dòng dưới đây đọc từ
`E:\PROJECT\Keylicensedashboard` (chỉ đọc, không sửa gì).

### 11.1 Kết luận quan trọng nhất: không phải thu thập thêm gì cả

`activateLicense` (`worker/index.ts:9060-9795`) **đã có sẵn trong scope** đủ 10
field của payload §4, tại đúng thời điểm hai câu `return` thành công. Không cần
thêm query, không cần đổi request, không cần đổi bảng D1:

| Field payload §4 | Biến đã có | Ở đâu |
|---|---|---|
| `licenseKey` | `licenseKey` (đã normalize) | `index.ts:9098` |
| `deviceId` | `deviceId` (đã trim) | `index.ts:9100` |
| `productId` | `license.product_id` | SELECT `index.ts:9116` |
| `plan` | `license.plan` | SELECT `index.ts:9117` |
| `keyType` | `keyType` (đã normalize) | `index.ts:9188` |
| `status` | `license.status` | SELECT `index.ts:9120` |
| `expiresAt` | `license.expires_at` | SELECT `index.ts:9122` |
| `maxDevices` | `usageMaxDevices` | **hai biến riêng biệt** — `index.ts:9440` và `index.ts:9628` |
| `nonce` | nonce **đã normalize** | consume `index.ts:9192`, normalize `index.ts:1615` |
| `issuedAt` | `new Date().toISOString()` | — |

Nói cách khác việc của KLD là **một helper + ba field thêm vào hai câu return**.
Đó là toàn bộ đường license.

### 11.2 Hai câu return phải sign — cả hai, không phải một

Đây là chỗ dễ làm sai nhất. `activateLicense` có **hai** exit thành công, và
block `license` của chúng giống nhau từng byte:

| Dòng | Trường hợp | Dấu hiệu |
|---|---|---|
| `index.ts:9528-9545` | device đã active từ trước | `reused: true` |
| `index.ts:9777-9794` | activate mới / tái dùng slot inactive | `reused: Boolean(inactiveDevice)` |

Chỉ sign một cái là tạo ra bypass mới: client chỉ cần activate hai lần, lần thứ
hai rơi vào nhánh còn lại và nhận response **không có** `sig`. Nếu app đang chạy
`REQUIRE_SIGNATURE = false` (bước 2 của §7) thì lỗi này **im lặng** — log vẫn
xanh, không ai thấy, đến lúc bật `true` thì user activate lần hai bị chặn.

Vì hai block giống nhau, cách đúng là tách một hàm dùng chung rồi gọi ở cả hai
chỗ, không copy-paste đoạn sign hai lần.

**Đã verify lại bằng công cụ, không phải đọc lướt.** Con số "hai" là chỗ dễ lọt
nhất trong cả tài liệu này, nên nó được kiểm bằng ba đường độc lập rồi mới bị ba
lens đối kháng cố bác bỏ:

- Bounds hàm `9060-9795` khớp nhau ở **ba** phương pháp: brace matcher tự viết
  trên code-mask (đã lọc comment/string/template/regex; brace balance = 0,
  minBalance = 0), TypeScript compiler API (`FunctionDeclaration activateLicense`
  start 9060 / end 9795, `parseDiagnostics: 0`), và cross-check cấu trúc:
  `:9795` là `}`, `:9797` là `async function verifyLicense`, và **không có**
  declaration cột-0 nào nằm trong `9061..9794`.
- AST đếm đúng **29 `ReturnStatement`** trong thân hàm, khớp 1:1 với 29 dòng chứa
  `return`; đúng **một** nested function (arrow `9157-9161`, expression body,
  không có return). Trong 76 statement top-level, statement terminal vô điều kiện
  duy nhất là `[75]` = chính return `9777`. Không có gì che được exit nào.
- `json(` được gọi ở đúng **năm** chỗ (`9167`, `9195`, `9200`, `9528`, `9777`), và
  **không** có `new Response(` nào trong thân hàm.
- Nhánh delegate `:9327` (`markActivationOutdated`, `8924-9058`) đã mở ra đọc:
  đúng hai return, cả hai là từ chối (`403 device_banned`, `426 app_update_required`).
  Không có entitlement nào thoát qua đó.

Ba lens — tìm exit thứ ba / chứng minh một exit chết / chứng minh một exit không
phải success dưới mắt client — đều **không bác bỏ được**. Lens thứ hai chỉ ra lý
do cấu trúc: hai exit nằm trên hai nhánh bù nhau của **cùng một** predicate
`if (existingDevice)` (`9437`), không phải hai nhánh song song ngẫu nhiên. Nên
"quên một cái" chính là quên một nửa của một if/else.

**Nhưng có một exit thứ ba mà bản trước không nêu, và nó là cảnh báo thật:**

```ts
// worker/index.ts:9166-9172
if (!isProductAllowedForLicense(license.product_id, productId)) {
  return json({
    ok: true,               // <-- HTTP 200 + ok:true
    valid: false,           // <-- nhưng valid:false
    reason: "product_not_allowed_for_license",
```

`json()` mặc định status 200 (`worker/shared/http.ts:23`). Nên đếm theo "HTTP 2xx
có `ok:true`" thì là **ba**, không phải hai. Exit này *không* cấp entitlement —
không `license`, không `usage`, không `status:"active"`, không ghi DB — nên theo
định nghĩa "exit cấp quyền" vẫn đúng là hai, và `signEntitlement` **không** gọi ở
đây.

Điều phải ghi lại là **quy tắc phân định**: contract là *sign mọi entitlement*,
không phải *sign mọi response 200 có `ok:true`*. Ai implement sau này theo cách
nghe hợp lý hơn — "sign mọi response thành công" — sẽ kéo `:9167` vào diện phải
sign, và lúc đó payload không có `licenseKey`/`deviceId` để ký. Phía app đã đúng:
`gate.js:215-217` bắt `res.valid === false` **trước** khi coi là entitled.

### 11.3 Ràng buộc runtime — bắt buộc dùng WebCrypto, không dùng `node:crypto`

`wrangler.jsonc:5` có `"compatibility_date": "2026-05-01"` và **không có
`compatibility_flags`** — tức là **không có `nodejs_compat`**. Nên:

- `import crypto from "node:crypto"` sẽ **fail lúc build**. Phải dùng `crypto.subtle`.
- Tên thuật toán dùng **`"Ed25519"`** (Secure Curves). Workers cũng còn nhận
  `"NODE-ED25519"` (legacy, cần thêm `namedCurve`), nhưng chính Cloudflare
  khuyến nghị dùng `"Ed25519"` cho code mới và ghi rõ bản legacy "may change
  over time" — đừng chọn nó cho một chữ ký mà install cũ phải verify được nhiều năm.
- Private key **không import được dạng `"raw"`**. Phải là `"pkcs8"` hoặc `"jwk"`.
  Đây là chỗ hay mất buổi chiều nếu không biết trước.

**Đã kiểm chứng trên workerd thật, không phải đọc doc.** `wrangler dev --local`
chạy workerd thật — nên Workers *có* test được ở máy này, và đã test. Dựng một
Worker throwaway, chạy đúng các cặp lệnh mà §11.4 sẽ dùng:

| Kiểm chứng | Kết quả |
|---|---|
| `crypto.subtle.importKey("pkcs8", …, { name: "Ed25519" })` | PASS |
| `crypto.subtle.sign("Ed25519", key, bytes)` | PASS |
| `crypto.subtle.importKey("raw", <32 byte public>, …)` | PASS |
| self-verify ngay trong worker | PASS |
| Node verify chữ ký **workerd sinh ra**, bằng `keyFromRaw` của §5.1 | PASS |
| độ dài PKCS#8, đo độc lập ở cả hai phía | **64 ký tự base64**, khớp |

Hai kết luận rút ra, và cả hai đều đóng một chỗ trước đây chỉ dựa vào tài liệu:

1. **`"Ed25519"` hoạt động trên đúng `compatibility_date: 2026-05-01`** của repo
   này. Không cần `NODE-ED25519`, không cần đổi compat date, không cần thêm flag.
2. Chữ ký đi **xuyên runtime** được: workerd sign → Node verify. Đây chính là
   đường đi thật (Worker sign, app Node verify), nên nó đã được chứng minh
   end-to-end trước khi viết một dòng code production nào.

Nhà của helper mới là `worker/shared/crypto.ts` — file đó đã là chỗ chứa
WebCrypto helper (`hmacSha256Hex:10-28`, `sha256Hex:30-36`,
`timingSafeHexEqual:1-8`) và đã dùng đúng pattern `crypto.subtle.importKey("raw", …)`.
Lưu ý: repo **chưa có** helper base64url nào (đã grep toàn bộ `worker/`: 0 hit),
nên phải viết mới — và phải là base64**url** (`+/=` → `-_`, bỏ padding), không
phải base64 thường, vì chuỗi này đi trong JSON và app decode bằng `base64url`.

### 11.4 Helper cần viết (`worker/shared/crypto.ts`)

```ts
// Ed25519 entitlement signing. WebCrypto, không phải node:crypto — worker này
// không bật nodejs_compat (wrangler.jsonc:5, không có compatibility_flags).
const encoder = new TextEncoder();

export const LICENSE_SIGNING_KID = "va-2026-09";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Module scope tồn tại xuyên request trong cùng isolate, nên importKey chỉ chạy
// một lần cho mỗi isolate. Đánh đổi: rotate secret thì isolate đang sống vẫn giữ
// key cũ đến khi bị recycle — chấp nhận được, và là lý do §5 dùng `kid` chứ
// không phải thay key tại chỗ.
let cachedSigningKey: CryptoKey | null = null;

async function getSigningKey(env: Env): Promise<CryptoKey> {
  if (cachedSigningKey) return cachedSigningKey;
  const raw = env.LICENSE_SIGNING_KEY;
  if (!raw) throw new Error("LICENSE_SIGNING_KEY is not configured");
  cachedSigningKey = await crypto.subtle.importKey(
    "pkcs8",                 // "raw" KHÔNG dùng được cho private key trên Workers
    fromBase64(raw),
    { name: "Ed25519" },     // không dùng "NODE-ED25519" (legacy)
    false,                   // không extractable — không có đường nào lộ ra ngoài
    ["sign"],
  );
  return cachedSigningKey;
}

export type SignedEnvelope = { entitlement: string; sig: string; kid: string };

// Sign trên đúng bytes của chuỗi entitlement được truyền đi (detached payload,
// §3) — app verify chính chuỗi nó nhận, rồi mới JSON.parse. Không có bước
// canonicalise nào để lệch.
export async function signEntitlement(
  env: Env,
  payload: Record<string, unknown>,
): Promise<SignedEnvelope> {
  const entitlement = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await getSigningKey(env);
  const sig = await crypto.subtle.sign("Ed25519", key, encoder.encode(entitlement));
  return { entitlement, sig: toBase64Url(new Uint8Array(sig)), kid: LICENSE_SIGNING_KID };
}
```

Gọi ở `activateLicense`, dùng chung cho cả hai return ở §11.2:

```ts
const envelope = await signEntitlement(env, {
  v: 1,
  kind: "license",
  nonce: body.nonce,               // nonce vừa consume ở :9192
  productId: license.product_id,
  licenseKey: license.license_key,
  deviceId,                        // :9100, đã trim
  plan: license.plan,
  keyType,                         // :9188, đã normalize
  status: license.status,          // SELECT :9120 — response hiện KHÔNG trả field này
  maxDevices: usageMaxDevices,
  expiresAt: license.expires_at,   // null với key vĩnh viễn là hợp lệ, để nguyên null
  issuedAt: new Date().toISOString(),
});

return json({
  ok: true,
  reused: /* … */,
  status: "active",
  usage: { /* … giữ nguyên */ },
  license: { /* … giữ nguyên, không xoá field nào */ },
  ...envelope,                     // entitlement + sig + kid — additive
});
```

Ba field mới nằm ở **top level**, không nhét vào trong `license`, để client cũ
đọc `license` y như trước (§2). Không xoá và không đổi tên field nào trong
`license` — app hiện tại đọc nó ở `gate.js:175` qua `normalizeLicense`.

### 11.5 Sinh key — chạy một lần, ở máy local

```bash
node -e "const c=require('crypto');const{publicKey,privateKey}=c.generateKeyPairSync('ed25519');console.log('SECRET (pkcs8 base64, dán vào wrangler secret):');console.log(privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));console.log();console.log('PUBLIC (32 byte raw base64, nhúng vào app):');console.log(publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64'))"
```

Đã chạy thật trên máy này để xác nhận format: private key PKCS#8 DER ra **48
byte (64 ký tự base64)**, public SPKI DER ra **44 byte** với 12 byte đầu đúng là
prefix `302a300506032b6570032100` và 32 byte cuối là raw public key. Round-trip
sign/verify theo đúng đường detached payload: chữ ký đúng → `true`, sửa 1 byte
payload → `false`.

Nạp secret (private key **không bao giờ** vào git, vào `wrangler.jsonc`, hay vào
log):

```bash
npx wrangler secret put LICENSE_SIGNING_KEY
```

Chỉ dòng `PUBLIC` được đưa cho app, và nó không phải secret.

### 11.6 Đường trial — chướng ngại thật nằm ở chỗ khác với đường license

Đường license có 2 exit. Đường trial có **10**, vì mọi response trial đi qua một
builder chung `trialResponse(trial, reason?)` ở `index.ts:3610-3640`, và builder
đó là hàm **đồng bộ, không side-effect, nhưng phụ thuộc thời gian** — nó đọc
`Date.now()` ở `index.ts:3632` và lần nữa trong `getTrialStatus` (`index.ts:3496`),
nên cùng một `TrialRow` cho ra `valid`/`status`/`remainingSeconds` khác nhau tuỳ
lúc gọi. Trả `Record<string, unknown>`, không phải `Response`:

| Hàm | Call site của `trialResponse` |
|---|---|
| `verifyTrial` (`:10365`) | `:10388`, `:10393`, `:10399`, `:10413`, `:10443` |
| `startTrial` (`:14923`) | `:14948`, `:14989`, `:15042`, `:15065` + return trial mới `:15124-15135` |

Đừng biến `trialResponse` thành `async` — nó thuần, đang được gọi ở 9 chỗ, và
phần lớn trong đó là **từ chối** (`trial_device_mismatch`, `trial_device_used`,
`trial_ip_used`), sign một cái từ chối là vô nghĩa. Bọc thêm một lớp mỏng, chỉ
sign khi `valid === true`:

```ts
async function signedTrialResponse(
  env: Env,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (body.valid !== true) return body;      // từ chối: không có gì để sign
  const t = body.trial as Record<string, unknown>;
  const envelope = await signEntitlement(env, {
    v: 1,
    kind: "trial",                            // §6 — tách khỏi kind:"license"
    productId: t.productId,
    deviceId: t.deviceId,
    status: t.status,
    startedAt: t.startedAt,
    expiresAt: t.expiresAt,
    issuedAt: new Date().toISOString(),
  });
  return { ...body, ...envelope };
}
```

Rồi `json(trialResponse(x))` → `json(await signedTrialResponse(env, trialResponse(x)))`
ở cả 10 chỗ. Thuần cơ học, không đổi logic nào.

Đọc code xác nhận điều §6 đã ghi: `trialResponse` **không** có nonce, và
`TrialVerifyBody` (`:10369`) không nhận nonce. Nên payload trial dựa vào
`deviceId` + `issuedAt`, và đây là **quyết định có ý thức**, không phải bỏ sót —
ghi comment ngay tại `signedTrialResponse`.

Không sign trial thì trial trở thành bypass mới, vì `gate.js:257` cũng gọi
`recordEntitlement` và `STATE.TRIAL` cũng nằm trong `ENTITLED` (`gate.js:14`).

### 11.7 Khai báo secret — ba chỗ, chỗ thứ ba dễ bỏ quên

1. `worker/index.ts:86-153` — thêm `LICENSE_SIGNING_KEY?: string;` vào `interface Env`.
   (66 field. Số cũ `86-137` **sai**: `:137` là ` STRIPE_PRICE_PRO?: string;`, còn 15
   field nữa mới hết — chèn theo số cũ là chèn vào giữa block Stripe.)
2. `worker/shared/env.ts:3-19` — `export type RuntimeEnvironment = { … }`, là `type`
   alias chứ không phải `interface`; thêm cùng field. (Số cũ `13-19` **sai**: `:13`
   là ` API_KEY?: string;`, tức field thứ 11, không phải đầu type.)
3. `worker/index.ts:1337-1356` — `DEBUG_ENV_KEYS`. **Nên thêm** vào đây.

Chỗ thứ ba nghe như rủi ro nhưng ngược lại: `maskEnvValue` (`:1358-1362`) chỉ trả
`"***set***"` / `"***unset***"`, **không bao giờ trả value**. Thêm vào nghĩa là
endpoint debug trả lời được đúng câu hỏi cần thiết — "key đã cấu hình chưa" — mà
không lộ gì. Nếu không thêm, lúc `signEntitlement` throw
`"LICENSE_SIGNING_KEY is not configured"` thì không có cách nào chẩn đoán từ ngoài.

**Không** đưa private key vào `wrangler.jsonc` `vars` (`:6-12`) — block đó là
plaintext, đã commit, và đang chứa `CF_ACCOUNT_ID`. Secret vào `wrangler secret put`.

### 11.8 Thứ tự làm và checklist

Nhắc lại §7 vì đây là chỗ làm sai sẽ chết install đang chạy: **KLD deploy trước**.
Ba field mới là additive, client hiện tại bỏ qua chúng, nên deploy KLD một mình
không phá gì. Ngược lại (app bắt buộc `sig` trước) thì mọi user mất activate.

```
[ ] 1. Sinh keypair (§11.5). Private → `wrangler secret put LICENSE_SIGNING_KEY`.
       Public (32 byte base64) → gửi cho phía app, kèm `kid`.
[ ] 2. `worker/shared/crypto.ts`: base64url helper + `signEntitlement` (§11.4).
       Repo chưa có base64url — phải viết mới, dùng `-_`, bỏ padding.
[ ] 3. `Env` (`index.ts:86-137`) + `worker/shared/env.ts:13-19` + `DEBUG_ENV_KEYS`
       (`index.ts:1337`).
[ ] 4. `activateLicense`: sign ở CẢ HAI return — `:9528-9545` và `:9777-9794`.
       Dùng một hàm chung, không copy-paste.
[ ] 5. Thêm `keyType` (`:9188`) và `status` (`:9120`) vào cả payload đã sign và
       block `license` trả về — response hiện thiếu hai field này, và app cần
       chúng cho `normalizeLicense` (`gate.js:39-51`) và cho enforcement plan sau này.
[ ] 6. Trial: `signedTrialResponse` + sửa 10 call site (§11.6).
[ ] 7. Deploy. Kiểm tra bằng một activate thật: response có `entitlement`+`sig`+`kid`,
       và activate **lần thứ hai** (nhánh `reused:true`) cũng có — đây là bước dễ trượt nhất.
[ ] 8. Xác nhận không endpoint nào trả private key: `/api/licenses/signing-keys` (§5,
       tuỳ chọn) chỉ trả public key.
```

Cách tự kiểm chữ ký mà không cần app, chạy ở local với dòng `PUBLIC` đã lưu:

```bash
node -e "const c=require('crypto');const[e,s,p]=process.argv.slice(1);const k=c.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(p,'base64')]),format:'der',type:'spki'});console.log(c.verify(null,Buffer.from(e),k,Buffer.from(s,'base64url'))?'OK':'FAIL');console.log(JSON.parse(Buffer.from(e,'base64url').toString()))" "<entitlement>" "<sig>" "<public-key-base64>"
```

### 11.9 Một quyết định cần chốt trước khi code

§3: sign trên **detached payload** (`sig` ký đúng chuỗi `entitlement` truyền đi),
thay cho chuỗi nối `nonce|key|device|productId|plan|expiresAt` ở bản preview ban
đầu. Cùng tinh thần, nhưng bỏ được cả lớp lỗi canonicalisation, và thêm field về
sau không phá chữ ký cũ. Toàn bộ §11.4 viết theo phương án này.

Nếu chốt giữ dạng chuỗi nối thì §11.4 vẫn dùng được, chỉ đổi dòng tạo
`entitlement`, nhưng phải pin cứng trong code cả hai repo: thứ tự field,
separator, `null` encode thế nào, không lower-case, không trim.
