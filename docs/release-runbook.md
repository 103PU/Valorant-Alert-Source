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

Bốn lớp, mỗi lớp bắt một loại lỗi khác nhau — không phải một lớp lặp bốn lần:

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

## 3. Cắt một release

```bash
npm test                     # 87/87 phải xanh; naming contract nằm trong đây
npm run build                # → dist/ValorantScoreAlert-v<ver>-win-x64.zip + SHA256SUMS.txt
node scripts/verify-release-artifacts.js
```

Chạy thử toàn bộ pipeline **không** publish: Actions → *Release Portable Build* →
`workflow_dispatch`. Nó build, verify, rồi attach zip vào workflow run để test tay.

Publish thật cần **tag**, và tag/push/publish là việc **phải xin phép trước**, không
tự làm:

```bash
# CHƯA CHẠY - cần approval, và version trong package.json phải bump trước
git tag v1.0.0 && git push origin v1.0.0
```

Tag `v*` kích hoạt workflow: test → assert tag khớp `package.json` → build → verify →
`gh release create --verify-tag --latest` (không draft, không prerelease) → assert lại
release vừa publish có resolvable thật không.

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

## 5. Còn lại ở phía KLD

Repo này chỉ chịu trách nhiệm *đẩy asset đúng tên lên một release đúng trạng thái*.
Để nút download thật sự chạy, phía KLD vẫn phải trỏ application record về đúng
owner/repo (`103PU/Valorant-Alert-Source`). Không kiểm chứng được từ repo này.
