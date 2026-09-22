# Đang chờ gì, chờ ai, yêu cầu chính xác cái gì

Cập nhật: 2026-09-04. Nhánh `chore/single-version-source`.

Mục đích của file này: mọi thứ **chưa xong** đều phải có tên người chịu và một câu
yêu cầu cụ thể. Không có mục nào ghi "đang chờ" chung chung.

---

## 1. Chờ KLD đúng 1 việc (1.4). 1.2 + 1.3 là việc của MÌNH, 1.5 là của người dùng

Thứ tự 1.1 → 1.3 không đổi được: đảo lại là **mọi** install đang chạy sẽ không
activate được. Lý do đầy đủ ở `kld-entitlement-signing.md` §7.

1.2 trước đây ghi ở đây là "chờ KLD". **Sai.** Đã verify bằng API production ngày
2026-09-04: KLD trỏ đúng repo theo convention của cả họ sản phẩm; chỗ thiếu nằm ở
phía mình. Chi tiết và bằng chứng ở 1.2.

| # | Việc | Ai làm | Trạng thái |
|---|---|---|---|
| 1.1 | KLD sinh keypair Ed25519 + deploy signing | KLD | **XONG** 2026-09-04 |
| 1.2 | Publish release vào repo `-release` | mình | chờ approval |
| 1.3 | Bật `REQUIRE_SIGNATURE` | mình | mở khoá, chờ ship 1 build |
| 1.4 | Tách `app_version_config` theo product | **KLD** | **chờ KLD** |
| 1.5 | Thêm 2 secret Discord | **người dùng** | channel đã chốt; chờ deploy Worker rồi thêm secret |

### 1.1 KLD sinh keypair Ed25519 và deploy signing — XONG 2026-09-04

Private key nằm trong Worker secret `LICENSE_SIGNING_KEY`, không có bản copy nào
ngoài secret store của Cloudflare. Public key đã nằm trong
`server/licensing/signing-keys.js`:

```
kid: va-2026-09
```

Verify **trước khi** cài kid vào code, vì cài kid là điểm không quay lại được:
`signature_invalid` và mọi mismatch của `assertBinding` đều throw bất kể
`REQUIRE_SIGNATURE`, nên một key sai sẽ **chặn** activate chứ không fallback. Đã
chạy `verifyEnvelope` của chính module đó trên một envelope ký thật từ production
với `requireSignature: true` — positive verify đủ binding, và các negative case
throw đúng code (`signature_product_mismatch`, `signature_device_mismatch`,
`signature_kind_mismatch`, `signature_unknown_kid`, `signature_invalid` khi sửa
1 byte).

Không còn gì phải xin KLD ở mục này.

### 1.2 Publish release vào repo phân phối `103PU/Valorant-Alert-Release`

**Đây là việc của mình, không phải của KLD.** Cần approval để publish (xem
`release-runbook.md` §3), nên nó nằm ở file này.

Trạng thái thật, đo bằng API production ngày 2026-09-04:

```
GET https://keylicensedashboard.dungbd2005.workers.dev/api/app-config/applications/valorant-alert/download
→ {"ok":true,"status":"degraded","release":null,"recommended":null,
   "portable":null,"checksumUrl":null,
   "releasePageUrl":"https://github.com/103PU/Valorant-Alert-Release/releases",
   "error":"github_http_404"}
```

Application record **có thật** và `downloadEnabled: true` (thấy trong
`/api/app-config/applications`). Repo nó trỏ về — `103PU/Valorant-Alert-Release` —
cũng **có thật**: public, 9 MB, commit `26181f87` ngày 2026-08-26 *"release: initial
portable standalone release v1.0.0"*, chứa một bản portable đã bung sẵn
(`Start-ValorantAlert.bat`, `Create-Desktop-Shortcut.vbs`, `server/`, `public/`,
`node_modules/`).

Thiếu đúng một thứ: repo đó có **0 GitHub Release và 0 tag**. Build 2026-08-26 được
commit thành file rời trên `main`, chưa bao giờ tạo Release object. Nên
`GET /repos/103PU/Valorant-Alert-Release/releases/latest` trả **404**, và resolver
báo `github_http_404`.

**`-release` là convention, không phải cấu hình sai.** App đang chạy được của cùng
chủ dùng đúng kiểu đó:

| product | repo KLD đọc | status |
|---|---|---|
| `valorant-tweaks` | `103PU/ValorantTweaks.App-release` | `available` — có installer + portable + checksum |
| `valorant-alert` | `103PU/Valorant-Alert-Release` | `degraded` — 0 release |

**Việc phải làm:** publish 2 asset của `v1.0.0` vào `103PU/Valorant-Alert-Release`,
release không draft / không prerelease. Ba điểm bắt buộc:

1. Dùng **đúng bytes CI đã build** — sha256 `8121a019…9077`, tải từ release của
   `Valorant-Alert-Source` rồi đẩy sang. **Không** dùng `dist/` local: bản local
   37.8 MB, digest `d700f08e…`, khác bytes vì `npm ci` từ lockfile cho
   `node_modules` sạch hơn cây local.
2. Không cần installer. `download-resolver.ts:100-101` là
   `recommended = installer ?? portable`, chỉ `return null` khi thiếu **cả hai**.
   Portable-only cho `status: "available"` với `recommended.kind === "portable"`.
3. `.github/workflows/release.yml:111` gọi `gh release create` **không** có
   `--repo`, và `GH_TOKEN` là `secrets.GITHUB_TOKEN` — chỉ ghi được vào repo đang
   chạy. Muốn CI tự đẩy sang repo kia thì phải thêm PAT làm secret mới; đó là thay
   đổi secret nên phải xin phép riêng. Lần này publish tay bằng `gh` local là đủ.

**Lựa chọn thay thế (không khuyến nghị):** nhờ KLD trỏ record về
`103PU/Valorant-Alert-Source`, nơi `v1.0.0` đã nằm sẵn. Được, nhưng cần người khác
làm và phá convention `-release` của cả họ sản phẩm.

### 1.3 Sau khi 1.1 xong — bật `REQUIRE_SIGNATURE`

Việc của phía app. 1.1 đã xong nên mục này **đã mở khoá**; bước 1 dưới đây cũng
xong rồi. Ba bước, không gộp:

1. ~~Điền `kid` + public key vào `PUBLIC_KEYS`~~ — **XONG 2026-09-04** (`va-2026-09`).
   Có test invariant chặn tổ hợp `REQUIRE_SIGNATURE = true` + map rỗng, nên bước này
   phải trước.
2. Theo dõi trên máy thật bằng endpoint có sẵn — app đang chạy thì:

   ```
   GET http://127.0.0.1:3000/api/license/status
   ```

   Nó trả `gate.snapshot()` (`server/licensing/gate.js:116-138`), trong đó có block
   `signature: {verified, kid, warning}`. Cần thấy: mọi activate đã có `sig` chưa
   (`verified: true`), và `warning: 'signature_missing'` còn xuất hiện không.
3. Chỉ khi (2) sạch mới đổi `REQUIRE_SIGNATURE = false` → `true`, ship version mới.

### 1.4 KLD tách `app_version_config` theo product

**Quyết định của người dùng (2026-09-04):** *"tôi muốn tách theo product giống
valorant tweaks luôn"* — mỗi product có version row riêng, `valorant-alert` không
dùng chung row với `valorant-tweaks` nữa.

**Vì sao bắt buộc, không phải nice-to-have.** Bảng version của KLD là **một row
duy nhất ở tầng schema**, không phải "tình cờ đang có một row":

```sql
-- Keylicensedashboard/migrations/0013_add_app_version_config.sql:2
-- (khẳng định lại trong worker/index.ts:2442)
CREATE TABLE IF NOT EXISTS app_version_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ...
);
```

`CHECK (id = 1)` làm cho row thứ hai **không insert được**. Cộng thêm:

| Chỗ | Bằng chứng | Hệ quả |
|---|---|---|
| `worker/index.ts:3790` | `getAppVersionConfig(env)` — không có tham số product | 1 row cho mọi app |
| `worker/index.ts:3862` | `key: publicCacheKey("app-version")` | cache không có chiều product |
| `worker/index.ts:15405` | `getGitHubReleaseRepository(env)` đọc env var | sync về 1 repo |
| `worker/index.ts:739` | `DEFAULT_GITHUB_RELEASE_REPOSITORY = "103PU/ValorantTweaks.App-source"` | mặc định là ValorantTweaks |

Đo live 2026-09-04 — `?productId=` bị **bỏ qua hoàn toàn**, hai call trả byte
giống nhau:

```
GET /api/app/version
GET /api/app/version?productId=valorant-alert
→ {"ok":true,"version":{"current_version":"3.4.4","minimum_version":"3.4.4",
   "force_update":false,"release_notes":"Release highlights\n- Fix Key License Not Found...
```

**Rủi ro cụ thể nếu app cứ tin con số đó:** Valorant Alert 1.0.0 thấy 3.4.4 →
banner "có bản mới" vĩnh viễn, bấm vào không có gì để tải. Và nếu có ai bật
`force_update` cho ValorantTweaks với `minimum_version` 3.4.x thì **toàn bộ install
Valorant Alert bị khoá cứng** khỏi app — 1.0.0 < 3.4.4. Đây là lý do phải tách,
không phải để cho đẹp.

**Mẫu để làm theo đã có sẵn trong KLD, không phải mình bịa ra.** Chính KLD đã
product-scope một bảng khác đúng kiểu này:

```sql
-- migrations/0027_app_plan_catalog_hardening.sql:12,19
CREATE TABLE IF NOT EXISTS service_categories (
  product_id TEXT NOT NULL DEFAULT 'valorant-tweaks',
  key TEXT NOT NULL,
  ...
  PRIMARY KEY (product_id, key)
);
```

Và repo phát hành **đã** per-application rồi, chỉ riêng version channel là chưa
dùng nó: `migrations/0037_application_download_config.sql:2` thêm
`applications.release_repository`, với `valorant-tweaks` →
`103PU/ValorantTweaks.App-release` và `valorant-alert` →
`103PU/Valorant-Alert-Release`.

**Yêu cầu gửi KLD, nguyên văn:**

> Tách `app_version_config` theo product, đúng kiểu các bạn đã làm với
> `service_categories` ở `migrations/0027_app_plan_catalog_hardening.sql:12,19`.
>
> 1. **Migration.** Bảng mới hoặc migrate bảng cũ, khoá chính là `product_id`:
>    `product_id TEXT PRIMARY KEY REFERENCES applications(id)`. Bỏ
>    `CHECK (id = 1)`. Backfill row đang có thành `product_id = 'valorant-tweaks'`
>    (nó là row của ValorantTweaks, xác nhận bằng `current_version = 3.4.4`), rồi
>    seed thêm row `valorant-alert` với `current_version = '0.0.0'`,
>    `force_update = 0`. **`0.0.0` là mặc định an toàn:** mọi install đều `>=` nó
>    nên không ai bị nag và không ai bị khoá trong lúc chuyển.
> 2. **`getAppVersionConfig(env, productId)`** — thêm tham số. Product không có
>    row thì trả `0.0.0 / 0.0.0 / force_update: false`, **không** fallback sang
>    row của product khác.
> 3. **Cache key phải có chiều product:** `publicCacheKey("app-version", productId)`
>    (`worker/index.ts:3862`). Giữ nguyên key cũ là hai product ghi đè cache của
>    nhau — lỗi này khó thấy hơn cả lỗi hiện tại vì nó phụ thuộc ai gọi trước.
> 4. **`GET /api/app/version?productId=<id>`** đọc row của product đó. **Không
>    truyền `productId` thì phải vẫn trả `valorant-tweaks`** — mọi client
>    ValorantTweaks 3.4.x đang chạy đều gọi endpoint này không kèm param
>    (`ValorantTweaks.App/Licensing/AppVersionService.cs`: request là
>    `"/api/app/version"` trần), nên đổi default là làm chết auto-update của app
>    đang bán. `productId` lạ / không tồn tại → `404` hoặc row `0.0.0`, tuỳ các
>    bạn, miễn đừng trả row của product khác.
> 5. **Response phải echo lại `productId`** — thêm field `productId` (và
>    `product_id` nếu muốn giữ cặp snake/camel như các field khác) vào object
>    `version` ở `appVersionConfigResponse` (`worker/index.ts:3817-3839`). Đây là
>    yêu cầu **bắt buộc**, không phải cosmetic: client của Valorant Alert **từ
>    chối** mọi response không echo product id, vì không có echo thì client không
>    phân biệt được "KLD đã tách" với "KLD trả row của ValorantTweaks". Có echo là
>    lúc auto-update của Valorant Alert tự bật.
> 6. **`syncLatestGitHubRelease(env, productId)`** nên đọc
>    `applications.release_repository` của product đó
>    (`migrations/0037_application_download_config.sql:2`) thay vì env var toàn cục
>    `GITHUB_RELEASE_REPOSITORY`. Giữ env var làm fallback cho `valorant-tweaks` để
>    không đổi hành vi hiện tại. Không sửa chỗ này thì admin bấm sync trên trang
>    `valorant-alert` sẽ ghi tag của ValorantTweaks vào row của Valorant Alert.
> 7. Trang admin: thêm bộ chọn product cho khối App Version, giống các khối đã
>    product-scoped khác.
>
> **Không cần** đổi gì ở `/api/app-config/applications/{id}/download` —
> `download-resolver.ts` đã product-aware và đã đúng.

**Trong lúc chờ, app đã an toàn — không phải chờ mới chạy được.**
`server/licensing/app-version.js` yêu cầu KLD chứng minh câu trả lời là của
`valorant-alert` trước khi tin: response không echo `productId` → bị từ chối với
warning `kld_not_product_scoped`, và client rơi xuống nguồn thứ hai là
`releases/latest` của `103PU/Valorant-Alert-Release`. Nguồn GitHub **chỉ được
phép nag, không được phép khoá** (`forceUpdate` hard-false), vì
`releases/latest` không có khái niệm `minimum_version` — suy ra force từ một tag
nghĩa là mỗi lần publish là một lần khoá cứng toàn bộ user.

Đo live 2026-09-04, sau khi wire xong:

```json
{"appVersion":"1.0.0","source":"none","forceUpdateRequired":false,
 "softUpdateAvailable":false,
 "warnings":["kld_not_product_scoped","github_http_404"]}
```

Đúng như thiết kế: không banner sai, không khoá. `github_http_404` là **cùng một
nguyên nhân** với nút Download chết ở 1.2 — repo `-release` chưa có Release nào.
Làm 1.2 là cả hai đường tự sống, kể cả khi KLD chưa làm 1.4.

Test giữ hợp đồng này: `test/app-version.test.js` — 15 test, trong đó
*"an unscoped KLD row cannot force-update this product"* dựng đúng payload 3.4.4
live kèm `force_update: true` và assert `forceUpdateRequired === false`. Xoá guard
là test đó đỏ. Ba test cuối giữ phía UI: dashboard phải **gọi** endpoint này (trước
đó endpoint không có ai gọi), phải render quyết định của server chứ không tự so
version, và banner bắt buộc cập nhật không được có nút "để sau".

### 1.5 Hai secret cho Discord — chỉ chủ repo thêm được

Việc của **người dùng**, không ai khác làm thay được: thêm 2 secret vào repo
`103PU/Valorant-Alert-Source` (Settings → Secrets and variables → Actions).

| Secret | Dùng ở đâu | Thiếu thì sao |
|---|---|---|
| `CLOUDFLARE_WORKER_URL` | `release.yml` step *Notify Discord*, `notify-discord.yml` | `release.yml` **bỏ qua** step (`::notice`, exit 0) — release vẫn xanh; `notify-discord.yml` fail có chủ ý vì đó là lệnh gửi tay |
| `CLOUDFLARE_AUTH_TOKEN` | cùng hai chỗ | Worker trả 401 → `curl --fail` / `Invoke-RestMethod` làm đỏ step |

**Câu hỏi channel: ĐÃ TRẢ LỜI (2026-09-04).** Người dùng chọn phương án (a) —
"sử dụng worker riêng và sử dụng channel khác tôi muốn tạo thêm channle trong disocrd
là valorant-alert". Nên: Worker riêng cho app này, channel `#valorant-alert`. Source
Worker đã viết, nằm ở `tools/discord-relay/` (không đi vào .exe — `tools` nằm trong
`--exclude` của caxa, `scripts/build.js:115`), README trong đó có đúng 8 bước deploy.
Thứ tự bắt buộc: tạo channel → tạo webhook của channel đó → deploy Worker với webhook
làm secret → **rồi mới** thêm 2 secret ở trên. Thêm secret trước khi Worker sống thì
step Discord sẽ đỏ trên một release vốn đã publish đúng.

Lý do không dùng lại Worker của ValorantTweaks: payload không mang channel id
(`scripts/discord-release-notice.js` chỉ có `embeds` + `components`), nên channel đích
nằm trong Worker — dùng chung URL là thông báo của Valorant Alert vào channel của
ValorantTweaks.

Không liên quan repo này nhưng phải nói: `ValorantTweaks.App/.github/workflows/`
`notify-discord-manual.yml:14` commit **thẳng** một webhook URL Discord dạng
plaintext. Nếu repo đó public thì webhook đó cần **rotate**. Không copy sang đây,
không in lại giá trị.

---

## 2. Đã quyết — không chờ ai nữa

Ba việc dưới đây từng là "chờ người dùng quyết". Người dùng giao lại quyền quyết
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

### 2.3 Tự tải cập nhật trong app — LÀM, đã xong 2026-09-04

Quyết định của người dùng: **"làm luôn trong app"**. Đã làm, `server/updater/index.js`.

Không có `Updater.exe` như ValorantTweaks, và đó là kết luận từ việc đọc bộ cài chứ
không phải cắt bớt: `Install-ValorantAlert.ps1:80-104` đã tự dừng bản đang chạy,
`:264-270` (`-Launch`) đã tự khởi động lại bản mới làm việc cuối cùng. Thêm một
`Updater.exe` chỉ là thêm một binary làm đúng việc bộ cài đang làm.

Khác ValorantTweaks theo hướng chặt hơn: verify sha256 với `SHA256SUMS.txt` **trước**
khi chạy bất cứ gì (upstream không ship checksum), và route `update/start` không đọc
body — version lấy từ `checkAppVersion()` của server, còn giá trị **thô** phải qua
regex `^v?\d{1,4}\.\d{1,4}\.\d{1,4}$` trước khi thành path segment.

Giới hạn phải nói thẳng: sha256 chặn hỏng file và MITM, **không** chặn repo bị chiếm —
ai thay được zip thì thay được `SHA256SUMS.txt` bên cạnh. Key Ed25519 `va-2026-09` ký
envelope entitlement của KLD, không ký release, nên nó không đóng được khoảng đó.

Chưa verify được: bộ cài thật **cố tình chưa bao giờ** được updater khởi động trên máy
này (nó sẽ giết và thay chính bản đang chạy). Toàn bộ 29 test inject `fetch` và `spawn`.
Bảng ràng buộc đầy đủ ở `release-runbook.md` §6.

---

## 3. KHÔNG chờ ai cả — đã chốt là ngoài scope

Ghi ra để không ai tưởng đây là việc còn dở. Chi tiết ở
`kld-entitlement-signing.md` §9.

- **Lùi đồng hồ hệ thống.** Grace tính từ `issuedAt` đã ký vẫn bị lùi clock máy.
  Chặn được bằng `Date` header của một HTTPS response, nhưng offline thì không có.
  ValorantTweaks cũng có đúng giới hạn này.
- **Patch JS trong archive caxa.** Xoá dòng verify là xong. Đây là trần của mọi app
  Node plaintext; code signing chỉ làm nó ồn ào hơn, không chặn được.
- **Installer artifact — XONG 2026-09-04.** Không còn là việc dở. `build.js` phát cả
  `...-win-x64.zip` và `...-win-x64-installer.zip` + `SHA256SUMS.txt`; bộ cài
  (`tools/installer/`) đã chạy thật trên máy này qua harness 24 mục, 24/24 OK: cài,
  nâng cấp, 4 trường hợp từ chối, gỡ cài giữ `%APPDATA%\ValorantAlert`. Giữ bullet này
  để không ai đọc bản cũ rồi tưởng vẫn thiếu.

Nói gọn: signing đưa bypass từ *"sửa file text, 0 công cụ"* lên *"phải patch code
trong archive"*. Đúng bằng mức ValorantTweaks đang có, và đó là toàn bộ mục tiêu.
