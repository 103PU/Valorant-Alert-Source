# Discord relay — Worker riêng cho `#valorant-alert`

Worker này nhận thông báo release từ GitHub Actions rồi đăng vào Discord **bằng bot**.

Vì sao phải có nó: thông báo có **hàng button link** dưới embed (`components`), và
Discord **webhook âm thầm bỏ** phần đó — chỉ bot render được. Bot token thì không được
để trong một step của Actions.

Vì sao là Worker **riêng**, không dùng lại URL của ValorantTweaks: payload **không**
mang channel id, nên channel đích do Worker quyết định. Trỏ CI vào relay của
ValorantTweaks thì thông báo của Valorant Alert sẽ vào channel của ValorantTweaks.

Hệ quả bảo mật của việc channel nằm trong Worker chứ không nằm trong request:

- `RELAY_AUTH_TOKEN` bị lộ chỉ spam được **đúng một** channel, không biến bot thành
  công cụ đăng vào mọi channel bot nhìn thấy.
- `allowed_mentions` bị **ghi đè** trong Worker, không tin từ body — nên không payload
  nào (kể cả CI bị chiếm) @everyone được.

## Cài từ đầu — 8 bước

### 1. Tạo channel trong Discord

Server → **Create Channel** → Text → tên `valorant-alert`.

### 2. Lấy channel id

**User Settings → Advanced → Developer Mode: ON**, rồi chuột phải channel
`#valorant-alert` → **Copy Channel ID**. Là một dãy số ~19 chữ số.

### 3. Bot

Dùng lại bot đang có hoặc tạo mới ở <https://discord.com/developers/applications>:
**New Application → Bot → Reset Token** để lấy token.

Mời bot vào server bằng **OAuth2 → URL Generator**, scope `bot`, quyền **đúng ba** cái:

| Quyền | Vì sao cần |
|---|---|
| View Channel | không thấy channel thì không đăng được |
| Send Messages | gửi thông báo |
| Embed Links | không có thì embed bị chặn, chỉ còn text |

Không cần `Manage Messages`, không cần admin. Button link **không** cần quyền thêm và
**không** cần bot online — chúng chỉ là URL.

### 4. Điền channel id

Sửa `DISCORD_CHANNEL_ID` trong `wrangler.jsonc`. Để trống thì Worker trả 503
`relay_not_configured` — cố ý, vì im lặng đăng sai channel tệ hơn là lỗi rõ ràng.

### 5. Hai secret của Worker

```bash
cd tools/discord-relay
npx wrangler secret put DISCORD_BOT_TOKEN    # dán token bot, wrangler KHÔNG echo lại
npx wrangler secret put RELAY_AUTH_TOKEN     # token tự sinh, xem bên dưới
```

`RELAY_AUTH_TOKEN` là token **mới**, không lấy lại từ đâu cả. Sinh bằng:

```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
```

Copy trực tiếp vào prompt của wrangler. Đừng lưu nó vào file trong repo, đừng echo nó
ra terminal có log.

### 6. Deploy

```bash
npx wrangler deploy
```

wrangler in ra URL dạng `https://valorant-alert-discord-relay.<subdomain>.workers.dev`.

### 7. Smoke test — không đăng gì vào channel

```bash
curl https://valorant-alert-discord-relay.<subdomain>.workers.dev/health
```

`{"ok":true,"configured":true,"missing":[]}` là xong. `/health` chỉ nói **thiếu binding
nào**, không bao giờ nói giá trị, nên gọi thoải mái.

### 8. Hai secret bên GitHub

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Giá trị |
|---|---|
| `CLOUDFLARE_WORKER_URL` | URL wrangler vừa in ra (không có `/health`) |
| `CLOUDFLARE_AUTH_TOKEN` | **đúng** giá trị `RELAY_AUTH_TOKEN` ở bước 5 |

Hai tên secret này là do `release.yml` và `notify-discord.yml` đặt — giữ nguyên chính
tả. Thiếu `CLOUDFLARE_WORKER_URL` thì `release.yml` **bỏ qua** step (`::notice`, exit 0)
và release vẫn xanh; `notify-discord.yml` thì **fail** vì dispatch tay là "gửi ngay".

## Thử end-to-end

Actions → **Notify Discord** → *Run workflow* → nhập tag đã có release (`v1.0.0`).
Nó đọc release, dựng payload bằng `scripts/discord-release-notice.js` rồi POST vào
Worker. Thông báo phải hiện trong `#valorant-alert` **kèm 3 button**.

## Mã lỗi

| Trả về | Nghĩa | Sửa |
|---|---|---|
| 503 `relay_not_configured` | thiếu binding, `missing` liệt kê tên | bước 4 hoặc 5 |
| 401 `invalid_auth_token` | `CLOUDFLARE_AUTH_TOKEN` ≠ `RELAY_AUTH_TOKEN` | đặt lại một trong hai |
| 400 `embeds_required` | payload không có embed | lỗi ở phía script, không phải Worker |
| 429 | Discord rate limit, `retry_after` giữ nguyên | chờ rồi dispatch lại |
| 502 `discord_rejected` | Discord từ chối; `discord` là body của nó | thường là bot thiếu quyền ở bước 3 |

## Đổi channel về sau

Sửa `DISCORD_CHANNEL_ID` rồi `npx wrangler deploy`. Không cần chạm vào secret GitHub,
không cần sửa code app. Nếu release chuyển sang repo khác thì đó là biến **`RELEASE_REPO`**
bên Actions, không liên quan đến Worker này.
