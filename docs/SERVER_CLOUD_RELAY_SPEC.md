# SPECIFICATION: CLOUD RELAY REALTIME MATCH SCORE
## Central KLD Server (Keylicensedashboard) Implementation Guide

Tài liệu đặc tả kỹ thuật chi tiết dành cho phía Server (`Keylicensedashboard` Cloudflare Worker & D1 Database) để tiếp nhận và phân phối luồng tỉ số trực tiếp từ máy PC Gaming ra ứng dụng Web trên điện thoại di động (4G/5G).

---

### 1. Kiến trúc tổng quan (Architecture Overview)

```text
┌─────────────────────────┐           HTTPS POST (JWT)          ┌───────────────────────────────────┐
│     PC GAMING HOST      │ ──────────────────────────────────► │    CLOUDFLARE WORKER (KLD)        │
│ (Valorant-Alert-Source) │     /api/relay/score (1.5s/ev)      │ • requireActiveUser(JWT)          │
└─────────────────────────┘                                     │ • D1: live_match_relays           │
                                                                │ • Edge Cache (TTL 5s)             │
                                                                └─────────────────┬─────────────────┘
                                                                                  │
                                                                                  │ HTTPS GET / SSE
                                                                                  │ /api/relay/score
                                                                                  ▼
                                                                ┌───────────────────────────────────┐
                                                                │       MOBILE WEB CLIENT (4G)      │
                                                                │      (Cloudflare Pages PWA)       │
                                                                └───────────────────────────────────┘
```

---

### 2. D1 Database Schema Migration

Tạo file migration: `migrations/0042_create_live_match_relays.sql`

```sql
-- Migration 0042: Live Match Relay snapshots for Valorant Alert
CREATE TABLE IF NOT EXISTS live_match_relays (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  match_id TEXT,
  in_game INTEGER NOT NULL DEFAULT 0,
  score_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_match_relays_updated_at 
  ON live_match_relays(updated_at);
```

---

### 3. API Contract Details

#### 3.1. Publisher Endpoint (Dành cho PC Gaming Host gửi tỉ số lên)

* **Route**: `POST /api/relay/score`
* **Headers**:
  * `Authorization: Bearer <user_session_jwt>`
  * `Content-Type: application/json`
* **Request Body JSON**:
  ```json
  {
    "inGame": true,
    "matchId": "ASCENT",
    "mapName": "ASCENT",
    "gameMode": "COMPETITIVE",
    "alliedScore": 12,
    "enemyScore": 11,
    "status": "MATCH_POINT_ALLIED",
    "timestamp": 1790072000000
  }
  ```
* **Server Logic**:
  1. Xác thực JWT bằng hàm hiện có: `const user = await requireActiveUser(request, env);` (Nếu lỗi trả về 401 Unauthorized).
  2. Kiểm tra quyền sở hữu ứng dụng `valorant-alert` (hoặc trial còn hạn).
  3. Upsert vào bảng `live_match_relays`:
     ```sql
     INSERT INTO live_match_relays (user_id, match_id, in_game, score_payload, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_id) DO UPDATE SET
       match_id = excluded.match_id,
       in_game = excluded.in_game,
       score_payload = excluded.score_payload,
       updated_at = excluded.updated_at;
     ```
* **Response (200 OK)**:
  ```json
  {
    "ok": true,
    "updatedAt": 1790072000000
  }
  ```

---

#### 3.2. Subscriber Endpoint (Dành cho Điện thoại lấy tỉ số qua 4G)

* **Route**: `GET /api/relay/score`
* **Query Parameters**:
  * `userId`: ID của tài khoản Google (ví dụ: `4f36ebd4-ca4a-49c7-b490-e8822f96e972`)
  * `token`: (Tùy chọn) Bearer JWT hoặc Read-only Sync PIN sinh từ PC
* **Server Logic**:
  1. Truy vấn D1:
     ```sql
     SELECT score_payload, in_game, updated_at 
     FROM live_match_relays 
     WHERE user_id = ?1;
     ```
  2. Nếu không tìm thấy hoặc `updated_at` đã quá 10 phút (trận đấu đã kết thúc/app PC đã tắt):
     Trả về:
     ```json
     {
       "ok": true,
       "inGame": false,
       "message": "no_active_match",
       "score": null
     }
     ```
  3. Nếu có dữ liệu hợp lệ và còn mới:
     Parse `score_payload` và trả về:
     ```json
     {
       "ok": true,
       "inGame": true,
       "updatedAt": 1790072000000,
       "score": {
         "matchId": "ASCENT",
         "mapName": "ASCENT",
         "gameMode": "COMPETITIVE",
         "alliedScore": 12,
         "enemyScore": 11,
         "status": "MATCH_POINT_ALLIED",
         "timestamp": 1790072000000
       }
     }
     ```
* **CORS Headers**: Bắt buộc cho phép `Origin: *` hoặc domain Cloudflare Pages của bạn.

---

#### 3.3. Streaming Endpoint (Server-Sent Events — SSE)

* **Route**: `GET /api/relay/stream?userId=<userId>`
* **Headers Response**:
  * `Content-Type: text/event-stream`
  * `Cache-Control: no-cache, no-transform`
  * `Connection: keep-alive`
* **Body Stream**:
  Định kỳ mỗi 1.5 giây hoặc khi D1 cập nhật, gửi chunk dạng:
  ```text
  data: {"inGame":true,"alliedScore":12,"enemyScore":11,"status":"SAFE"}\n\n
  ```

---

### 4. Rate Limiting & Bảo mật (Security Guidelines)

1. **Rate Limiting cho Publisher**: Tối đa 60 requests/phút cho mỗi `user_id` (trung bình 1s/request). Đủ lớn cho game Valorant nhưng ngăn chặn việc spam request vô tận.
2. **Edge Cache (Tùy chọn)**: `GET /api/relay/score?userId=...` có thể gắn header `Cache-Control: public, max-age=1, stale-while-revalidate=1` trên Cloudflare CDN để giảm tải trực tiếp vào D1 Database.
