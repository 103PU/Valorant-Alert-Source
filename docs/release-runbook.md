# Release runbook — download funnel (lane A)

Vì sao có file này: nút Download trên dashboard KLD từng **dead end** — không phải vì
release sai, mà vì build chỉ sinh ra `ValorantScoreAlert.exe`, một cái tên mà resolver
của KLD không nhận. Resolver trả `null`, nút bấm không đi đâu cả, và không có log nào
ở phía app để thấy. Tài liệu này ghi hợp đồng đó và chỗ nào trong repo đang giữ nó.

## 1. Hợp đồng resolver (đọc từ KLD, chỉ đọc)

`Keylicensedashboard/worker/domains/applications/download-resolver.ts:88-101` quét asset
của GitHub release, lowercase từng tên rồi test:

| Điều kiện | Ai giữ nó ở repo này |
|---|---|
| `name.endsWith('.zip')` | `scripts/release-naming.js` |
| `name.includes('win-x64')` | `scripts/release-naming.js` (`PLATFORM_TAG`) |
| **không** `includes('installer')` → portable | `portableZipName()` vs `installerZipName()` |
| `name === 'sha256sums.txt'` (case-insensitive) | `checksumFileName()` |
| release **không** `draft` | `.github/workflows/release.yml` — step cuối |
| release **không** `prerelease` | `.github/workflows/release.yml` — step cuối |
| mỗi asset `state === 'uploaded'` | `.github/workflows/release.yml` — step cuối |

Ba điều kiện đầu là *tên file* nên test được offline: `test/release-artifacts.test.js`.
Bốn điều kiện sau là *trạng thái release* nên chỉ assert được sau khi publish.

## 2. Chuỗi phòng thủ

Bốn lớp cho **tên artifact**, mỗi lớp bắt một loại lỗi khác nhau — không phải một lớp
lặp bốn lần:

1. `test/release-artifacts.test.js` — tên do `release-naming.js` sinh ra có khớp
   predicate không, và `build.js` có còn hardcode tên không (drift giữa hai bản copy
   chỉ hiện ra dưới dạng nút download chết trên production).
2. `scripts/build.js` — guard `resolver.matchesPortable(zipName)` trước khi zip;
   `process.exit(1)` nếu không khớp.
3. `scripts/verify-release-artifacts.js` — chạy **sau** build: hai file có thật trên
   đĩa, digest trong `SHA256SUMS.txt` tính lại từ bytes của zip có khớp, zip lớn hơn
   5 MB. Bắt được `dist/` cũ còn sót và checksum lệch sau khi rebuild — hai thứ
   `build.js` không thể tự thấy từ trong lần chạy của nó.
4. `.github/workflows/release.yml` — assert tag khớp `package.json`, rồi assert
   trạng thái release sau khi publish.

Tên đúng nhưng **chạy không được** là một lớp lỗi khác, nên có lớp riêng: cũng trong
`test/release-artifacts.test.js`, các test encoding (mọi `.ps1` shipped có non-ASCII
phải có BOM; `.cmd` phải ASCII thuần không BOM; `README-FIRST.txt` phải có BOM), test
`-LiteralPath` + wildcard, test "verify bản stage trước khi xoá bản cũ", test shortcut
trỏ `launcher.vbs` chứ không phải .exe, và test uninstaller giữ `%APPDATA%`. Xem §6.

## 3. Cắt một release

```bash
npm test                     # 166/166 phải xanh; naming contract nằm trong đây
npm run build                # → dist/ValorantScoreAlert-v<ver>-win-x64.zip
                             #   + ...-win-x64-installer.zip + SHA256SUMS.txt
node scripts/verify-release-artifacts.js
```

**Build không byte-reproducible.** Hai lần `node scripts/build.js` với payload y
nguyên cho ra hai digest portable khác nhau (`746c4036…` rồi `e1e236f5…`) — caxa nhét
tar.gz kèm timestamp, zip entry cũng có timestamp. Hệ quả bắt buộc: release phải ship
**bytes của CI** và `SHA256SUMS.txt` của CI. `dist/` local không bao giờ khớp, nên
đừng upload nó rồi lấy checksum từ máy khác.

Chạy thử toàn bộ pipeline **không** publish: Actions → *Official Tag Release* →
`workflow_dispatch`. Nó build, verify, rồi attach zip vào workflow run để test tay.

Publish thật cần **tag**, và tag/push/publish là việc **phải xin phép trước**, không
tự làm:

```bash
# CHƯA CHẠY - cần approval, và version trong package.json phải bump trước
git tag v1.0.0 && git push origin v1.0.0
```

Tag `v*` kích hoạt workflow: test → assert tag khớp `package.json` → build → verify →
`gh release create --verify-tag --latest` (không draft, không prerelease) → assert lại
release vừa publish có resolvable thật không → **thông báo Discord**.

Step Discord nằm **cuối cùng, có chủ ý**: nó chỉ chạy sau khi step trước đã chứng minh
release resolvable, nên không thể gửi đi một thông báo mà nút bấm trong đó 404. Và vì
nó ở cuối, Discord chết cũng không làm đỏ một release đã publish đúng. Thiếu
`CLOUDFLARE_WORKER_URL` thì step tự bỏ qua (`::notice`, exit 0) — đường release chạy
được **trước** khi Discord được nối. Gửi lại tay: Actions → *Notify Discord* →
`workflow_dispatch` với tag. Payload có **một** định nghĩa duy nhất
(`scripts/discord-release-notice.js`, pin bởi `test/discord-notice.test.js`); tên asset
trong 2 nút download lấy từ `release-naming.js` chứ không gõ lại.

Webhook Discord **không** nằm trong repo này. CI gọi một Cloudflare Worker riêng
(`tools/discord-relay/`, 8 bước deploy trong README của nó), Worker giữ webhook làm
secret và post vào channel `#valorant-alert`. Lý do tách: một webhook URL trong
workflow là một secret ai fork cũng đọc được — `ValorantTweaks.App` đang để plaintext
đúng như vậy tại `notify-discord-manual.yml:14`. Hai secret còn lại phải do chủ repo
thêm sau khi deploy Worker: `pending-and-blocked.md` §1.5.

## 4. Version chỉ có MỘT chỗ

`package.json:version` là nguồn duy nhất. Tag git phải khớp nó, và workflow assert
điều đó (step *Assert the tag matches package.json version*) — lệch thì tag `v1.0.1`
đẩy lên asset tên `...-v1.0.0-win-x64.zip` và không có gì báo cho tới lúc user tải về.

`config.json` **không** còn field version. Trước đây nó có `build.version`, nhưng
không có gì đọc: `resolveAppVersion` (`server/licensing/config.js:41-48`) đọc
`package.json`, không route nào serve version, không frontend nào hiển thị. Bản copy
thứ hai của một con số chỉ là thứ thứ hai để quên lúc release, nên xoá hẳn thay vì
đồng bộ. `test/release-artifacts.test.js` assert nó không quay lại.

Bump version = sửa **một** dòng trong `package.json`, rồi tag đúng con số đó.

## 5. Release phải đi vào repo `-release`, không phải repo này

KLD đọc release của **`103PU/Valorant-Alert-Release`**, không phải của repo source.
Đó là convention chung: `valorant-tweaks` cũng resolve về
`103PU/ValorantTweaks.App-release`. Verify ngày 2026-09-04 bằng
`GET /api/app-config/applications/valorant-alert/download` — repo `-release` có 0
GitHub Release nên resolver trả `error: "github_http_404"`, `portable: null`, và nút
Download dead end dù `v1.0.0` ở repo source đã đúng tên 100%.

`.github/workflows/release.yml:113` gọi `gh release create` không có `--repo`, và
`GH_TOKEN` là `secrets.GITHUB_TOKEN`, nên **CI chỉ publish được vào repo này**. Đẩy
sang repo `-release` hiện phải làm tay bằng `gh` local, dùng đúng bytes CI đã build
(tải asset từ release của repo source, không dùng `dist/` local — digest khác).

Tự động hoá bước đó cần một PAT có quyền ghi repo `-release` làm secret mới. Thêm
secret là thay đổi phải xin phép riêng — xem `pending-and-blocked.md` §1.2.

Trong lúc chờ, `vars.RELEASE_REPO` là **một** công tắc: nút trong thông báo Discord
đọc nó (`release.yml` env `RELEASE_REPO`), nên khi release chuyển sang repo `-release`
thì đặt biến đó là xong, không phải sửa code.

## 6. Cài và cập nhật — cái người dùng thật sự thấy

Không có `setup.exe` biên dịch, và ValorantTweaks cũng không có: bộ cài của cả hai app
là **script PowerShell nằm trong một file zip**. Ở đây là `tools/installer/` gồm 4 file
(`Install-ValorantAlert.ps1`, `.cmd` bọc ngoài, `Uninstall-ValorantAlert.ps1`,
`README-FIRST.txt`), `build.js` đóng vào `...-win-x64-installer.zip` cùng `app/`.

| Thuộc tính | Giá trị |
|---|---|
| Cài vào | `%LOCALAPPDATA%\Programs\ValorantAlert` — per-user, **không UAC** |
| Shortcut | `wscript.exe //nologo <dir>\scripts\launcher.vbs`, **không** trỏ vào .exe |
| Dữ liệu user | `%APPDATA%\ValorantAlert` — gỡ cài **giữ nguyên**, xoá phải `-PurgeUserData` |
| Nâng cấp | chạy lại bộ cài: nó tự dừng bản đang chạy, thay cả thư mục |

Hai lỗi chỉ hiện ra khi chạy thật, đã sửa và đã có test giữ:

1. **BOM.** PowerShell 5.1 đọc `.ps1` không BOM theo ANSI code page; tiếng Việt thành
   mojibake, và mojibake của bộ cài chứa ký tự quote nên script **không parse được**
   (`Install-ValorantAlert.ps1:103 Unexpected token 'i'`) — 100% người double-click
   .cmd đều gãy. Ngược lại `.cmd` phải **ASCII thuần, không BOM**: cmd.exe đọc theo OEM
   code page và sẽ *thực thi* BOM như phần của dòng 1.
2. **`Copy-Item -LiteralPath "$src\*"` copy 0 file và không raise gì** (`*` thành tên
   file literal). Bộ cài từng chạy dòng đó *sau* khi đã xoá bản cũ → thư mục rỗng +
   shortcut + báo "Cài đặt xong". Đổi sang `-Path` cũng không cứu: thư mục kiểu
   `Valorant-Alert [1]` làm `[1]` thành character class. Cách đúng: liệt kê con bằng
   `Get-ChildItem -LiteralPath` rồi copy từng cái. Và thứ tự đã đổi — verify cây đã
   stage **trước** khi xoá bản cũ, nên trường hợp xấu nhất là "cài bị từ chối, bản cũ
   vẫn chạy".

Phát hiện cập nhật: `GET /api/license/app-version` hỏi KLD trước, không được thì đọc
GitHub release mới nhất, rồi trả về
`forceUpdateRequired` / `softUpdateAvailable` đã tính sẵn. Dashboard render banner từ
đó (`renderUpdate()` trong `public/dashboard.html`). Bất đối xứng có chủ ý: chỉ KLD
được phép **khoá**, GitHub chỉ được **nhắc** — suy ra force-update từ một cái tag nghĩa
là mỗi lần publish sẽ hard-lock toàn bộ install ngoài field. Check này **fail open**:
không hỏi được thì `source:'none'` và banner ẩn, vì một lần check hỏng không được phép
trông giống "bắt buộc cập nhật".

Chỗ khác ValorantTweaks: bên đó có `UpdateDownloadService` tự tải zip → giải nén → tìm
`Updater.exe` → chạy → app tự restart. Bên này **đã có** phần tự tải, ở
`server/updater/index.js`, nhưng **không** có `Updater.exe` — vì không cần: bộ cài đã
chính là chương trình đó (`Install-ValorantAlert.ps1:80-104` dừng bản đang chạy,
`:264-270` `-Launch` khởi động lại bản mới làm việc cuối cùng). Nên module này chỉ làm 4
việc: tải → verify → giải nén → spawn bộ cài.

| Bước | Ràng buộc, và lý do nó là ràng buộc |
|---|---|
| Version | Lấy từ `checkAppVersion()` của **server**, route không đọc body. Một version do client gửi (chưa nói tới URL) biến route LAN này thành primitive "tải và chạy thứ tuỳ ý" |
| Version, lần 2 | Regex `^v?\d{1,4}\.\d{1,4}\.\d{1,4}$` áp lên giá trị **thô**, trước `normalizeVersion` — hàm đó chỉ bỏ chữ `v` và mặc định `''` thành `0.0.0`, nên `../..` đi xuyên qua nó |
| sha256 | Verify với `SHA256SUMS.txt` **trước** khi chạy bất cứ thứ gì; lệch thì xoá zip luôn. ValorantTweaks không ship checksum. Giới hạn thật thà: chặn hỏng file và MITM, **không** chặn repo bị chiếm — ai thay được zip thì thay được cả file sums |
| Đường dẫn | Work dir `%APPDATA%\ValorantAlert\update`, install `%LOCALAPPDATA%\Programs` — hai cây khác nhau, nên giải nén lỗi không thể để lại app thay nửa vời |
| PowerShell | Path đi bằng env var (`$env:VA_UPDATE_ZIP`), không nội suy vào `-Command` — đúng luật đã có, vì `Valorant-Alert [1]` là dạng path từng làm gãy `Copy-Item` |
| Spawn | `cmd.exe /c <path> -Launch`, `detached`, `stdio:'ignore'` — `spawn()` trực tiếp vào `.cmd` bị Node ≥18.20 từ chối (CVE-2024-27980), và bộ cài sắp giết chính process này nên con không được nằm cùng process group |
| Route | `POST /api/license/update/start` yêu cầu **loopback**: một cái điện thoại trong LAN có share pin không được phép chạy bộ cài trên máy chủ. `GET update/state` thì pin-only, vì nó chỉ đọc stage + byte count |

Test giữ 2 lớp đó riêng: `test/update-download.test.js` (16) chứng minh engine an toàn —
inject cả `fetch` và `spawn` nên suite không hề chạm mạng hay chạy bộ cài thật;
`test/update-routes.test.js` (13) chứng minh không ai tới được engine từ chỗ sai, kể cả
`update/start` bằng GET (405), từ LAN (403), và body có `version: '9.9.9'` — test đó
assert route **không đăng ký cả listener `data`**.

Chưa verify được ở đây: chưa ai chạy `.exe` v1.0.0 đã publish trên máy sạch, và bộ cài
thật cố tình chưa bao giờ được updater khởi động trên máy này.

## 7. Webhook đồng bộ version lên KLD Server (POST /api/admin/app-version/publish-release)

Sau khi GitHub Release được tạo và verify asset thành công trên GitHub, `.github/workflows/release.yml`
tự động gửi webhook sang Server KLD:

- **Module thực thi:** `scripts/publish-kld-release.js` (được test bởi `test/kld-release.test.js`).
- **Endpoint:** `POST https://keylicensedashboard.dungbd2005.workers.dev/api/admin/app-version/publish-release`
- **Xác thực:** Header `X-Admin-Token` so khớp với secret `KLD_ADMIN_TOKEN` trên GitHub Actions.
- **Payload:**
  - `version`: số version chuẩn hoá x.y.z từ Git tag.
  - `minimumVersion`: mặc định bằng version hiện tại.
  - `forceUpdate`: `false` (mặc định không ép buộc).
  - `releaseNotes`: toàn bộ markdown release notes trích xuất từ GitHub API.
- **Tính an toàn:**
  - Khi chưa cấu hình secret `KLD_ADMIN_TOKEN`: workflow ghi `::notice::` và bỏ qua, không làm gián đoạn release GitHub.
  - Xử lý lỗi `non-blocking`: nếu KLD tạm thời gián đoạn mạng, GitHub Actions ghi cảnh báo `Write-Warning` mà không đánh fail toàn bộ build.
