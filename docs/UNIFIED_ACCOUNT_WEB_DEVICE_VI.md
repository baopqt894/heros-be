# Tài khoản chung web, app và thiết bị HEROS

Flow firmware đầy đủ và API kết thúc SOS bằng device token (cập nhật 14/10/2026, cần deploy code mới): [DEVICE_FIRMWARE_CONTRACT_VI.md](DEVICE_FIRMWARE_CONTRACT_VI.md).

Cập nhật 06/10/2026. Tài liệu mô tả code mới; cần deploy cả backend `heros` và website `heros-web` để dùng trên tên miền thật.

## 1. Dữ liệu và đăng nhập

- Tài khoản mua hàng trên web nằm trong collection `users` của MongoDB backend HEROS. Dùng cùng email/mật khẩu để đăng nhập app, không tạo tài khoản thứ hai.
- Đơn hàng chuyển sang `commerce_orders`, tham chiếu `_id` của chính user. App và web đều có thể đọc lịch sử bằng cùng tài khoản.
- Tài khoản mới trên web cần email OTP và được tạo với `userType=device_owner`. Web không yêu cầu ngày sinh/SĐT lúc tạo tài khoản; app có thể bổ sung hồ sơ sau. Thông tin người nhận đơn hàng độc lập với hồ sơ tài khoản.
- Một phiên web và một phiên mobile có thể tồn tại cùng lúc. Login web mới thu hồi phiên web cũ; login mobile mới thu hồi phiên mobile cũ. Logout chỉ thu hồi phiên hiện tại. Đổi mật khẩu/xóa tài khoản chặn cả hai.
- JWT access mới không có `exp`, response có `accessExpiresAt: null`. `JWT_ACCESS_TTL` cũ không còn tác dụng. JWT đã cấp trước deploy vẫn giữ hạn cũ: login lại để nhận token mới.
- Token vẫn được kiểm tra session và trạng thái user trong MongoDB trên HTTP và mỗi lần socket gửi dữ liệu. Không hết hạn không đồng nghĩa không thể thu hồi.
- Refresh token vẫn có hạn `JWT_REFRESH_TTL_DAYS` và quay vòng như trước. Không cần refresh định kỳ khi access token mới không hết hạn. Khi nhận `SESSION_REVOKED`, đăng nhập lại.
- Mobile chuyển logout sang `POST /v1/auth/logout-current` với Bearer access token, rồi xóa Keychain/cache. Route này hoạt động cả khi refresh token đã hết hạn hoặc được TTL dọn. Route logout bằng refresh cũ được giữ tương thích cho phiên còn refresh token.
- Web giữ JWT trong cookie HttpOnly/Secure/SameSite, không trả JWT về JavaScript trình duyệt. Cookie có max-age 400 ngày và có thể bị trình duyệt giới hạn/xóa; đây không phải hạn JWT.
- Form liên hệ hiện vẫn lưu SQLite tại web. Chưa chuyển nội dung lời nhắn cá nhân sang backend do bước đó bị bộ duyệt tự động chặn. Không có route web mới gửi payload form liên hệ sang MongoDB.

## 2. App đăng nhập và ghép thiết bị

```bash
curl -X POST 'https://heros.nextteam.site/v1/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"buyer@example.com","password":"YOUR_PASSWORD","deviceId":"ios-installation-uuid","clientType":"mobile"}'
```

`clientType` có thể bỏ qua ở app, mặc định là `mobile`. Web gửi `web`. `deviceId` là installation ID của app/browser, không phải serial thiết bị vật lý.

App dùng access token đăng nhập chung để ghép thiết bị:

```bash
curl -X POST 'https://heros.nextteam.site/v1/me/heros-devices' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"hardwareId":"HEROS-SERIAL-001","label":"HEROS của tôi"}'
```

Response trả `deviceToken` một lần. App/firmware lưu token này; phần cứng gọi SOS/GPS/audio bằng `X-Heros-Hardware-Id` và `X-Heros-Device-Token`. Phần cứng không cần giữ email/mật khẩu hoặc JWT tài khoản.

Unique indexes trên `hardwareId` và `ownerId` bảo đảm một hardware thuộc một user và mỗi user có tối đa một hardware. Ghép serial của người khác trả `HARDWARE_DEVICE_ALREADY_PAIRED`; ghép hardware thứ hai trả `OWNER_ALREADY_HAS_HARDWARE_DEVICE`. Ghép lại đúng hardware của cùng owner xoay device token. Việc thu hồi thiết bị không tự xóa liên kết sở hữu để chuyển tài khoản. Đây chưa phải cơ chế xác minh serial do nhà sản xuất phát hành; cần quy trình cấp serial thật trước mở ghép thiết bị công khai.

## 3. API chung

Base `/v1`; response giữ `{success, code, data}`; mã lỗi ở `data.errorCode`.

| API | Auth | Payload/kết quả |
| --- | --- | --- |
| `POST /auth/email/request-otp` | Public | `email`, `purpose=register` hoặc `login` |
| `POST /auth/web/register` | Public | `email`, `otp`, `fullName`, `password` (8-128 ký tự), `deviceId`; trả session web |
| `POST /auth/login` | Public | `email`, `password`, `deviceId`, `clientType=mobile/web` |
| `POST /auth/password/reset` | Public | `email`, `otp` login, `newPassword`, `deviceId`, `clientType` |
| `POST /auth/logout-current` | Bearer | Thu hồi đúng session của access token |
| `GET /commerce/orders?before=ORDER_CODE` | Bearer | `orders`, `nextCursor`; tối đa 20 đơn của user |
| `POST /commerce/orders` | Bearer | `name`, `email`, `phone`, `address`, `quantity`, `method=cod/payos`, `requestId` UUID v4 |
| `GET /commerce/orders/:code` | Bearer | Chi tiết đơn của user và `syncPending` khi đối soát chưa xong |
| `GET /commerce/guest-orders/:code` | Header `X-Heros-Order-Token` | Chỉ dành cho đơn cũ chưa gắn account, không thể mở đơn đã gắn bằng guest token |
| `POST /commerce/orders/claim` | Bearer | `orderCode`, `guestToken`; cần matching email và capability thật |
| `POST /commerce/payos/webhook` | Chữ ký payOS | Xác minh SDK và đối soát payment từ payOS trước cập nhật |

Backend tự tính giá 590.000đ/thiết bị, giao hàng 0đ, số lượng 1-10. Không nhận giá từ client. `requestId` chống tạo trùng và không được tái sử dụng với payload/account khác. Response tạo đơn có `order`, `created`, `syncPending`, `guestToken`. Không đưa `guestToken` vào log hoặc JavaScript; web lưu HttpOnly cookie.

payOS timeout không tạo đơn/link thứ hai: lần retry đối soát lại cùng order code. Đơn `PAID` không bị hạ trạng thái; COD không bao giờ được đánh dấu đã trả tiền bởi payOS. Xóa tài khoản dọn các đơn gắn account theo cơ chế worker hiện tại; cần chốt chính sách lưu chứng từ/backup trước triển khai vận hành thương mại.

## 4. Cấu hình deploy

Backend `.env` dùng MongoDB đang có và thêm cấu hình thương mại từ server web cũ:

```ini
HEROS_CHECKOUT_ENABLED=true
HEROS_SITE_URL=https://YOUR_WEB_DOMAIN
PAYOS_CLIENT_ID=YOUR_EXISTING_HEROS_CLIENT_ID
PAYOS_API_KEY=YOUR_EXISTING_HEROS_API_KEY
PAYOS_CHECKSUM_KEY=YOUR_EXISTING_HEROS_CHECKSUM_KEY
```

Không thay `JWT_ACCESS_SECRET`, `OTP_HASH_SECRET`, `MONGODB_URI` khi chỉ deploy chức năng này. Không cần thêm Redis cho một backend instance. Email OTP dùng SMTP backend hiện có; production cần SMTP gửi thật.

Web `.env.local` hoặc biến môi trường deployment:

```ini
HEROS_API_URL=https://heros.nextteam.site/v1/
HEROS_SITE_URL=https://YOUR_WEB_DOMAIN
HEROS_CHECKOUT_ENABLED=true
HEROS_DB_PATH=/persistent/path/heros.sqlite
```

`HEROS_API_URL` là server-only, không dùng `NEXT_PUBLIC_`. Không đưa `MONGODB_URI`/key payOS lên web client. Web không còn dùng các key payOS; sau chuyển hoàn tất có thể gỡ key khỏi môi trường web. Giữ SQLite cũ làm backup và lưu form liên hệ đang hoạt động.

Webhook có thể đổi trong payOS thành `https://heros.nextteam.site/v1/commerce/payos/webhook`. URL web cũ `/api/payos/webhook` vẫn được proxy về backend để tránh mất webhook khi chuyển. Callback `returnUrl`/`cancelUrl` vẫn về `/thanh-toan` của web. Cần triển khai backend trước khi chuyển web.

## 5. Chuyển tài khoản/đơn hàng SQLite cũ

Script không chạy khi khởi động app. Mặc định chỉ đọc và báo số lượng/conflict, không tạo collection/index. Không import session cũ hay lời nhắn liên hệ. Source SQLite được mở read-only.

1. Backup SQLite nhất quán và MongoDB. Xác định file `HEROS_DB_PATH` thật của server web, không dùng nhầm SQLite local.
2. Tạm ngừng web cũ nhận đăng ký/đơn mới trong thời gian lấy snapshot và import. Giữ webhook có retry để đối soát sau chuyển; đơn chưa PAID sẽ được kiểm tra lại khi đọc.
3. Đặt snapshot trên host backend, chạy dry-run:

```bash
npm run migrate:web -- --sqlite=/absolute/path/heros.sqlite
```

4. Nếu có conflict email với user mobile hiện hữu, script dừng toàn bộ trước import. Không tự gộp hoặc thay mật khẩu dựa trên email của web cũ. Cần xác minh chủ tài khoản và ánh xạ có kiểm soát trước khi tiếp tục. Script hiện không có chức năng tự giải quyết conflict.
5. Khi dry-run báo `conflicts=0`, import:

```bash
npm run migrate:web -- --sqlite=/absolute/path/heros.sqlite --apply
```

Script giữ hash scrypt web cũ để user đăng nhập bằng mật khẩu cũ; backend hiểu cả hai định dạng hash. `_id` MongoDB mới được dùng để ánh xạ đơn; `legacyWebAccountId` giữ liên kết và giúp chạy lại không tạo trùng. Đơn/paymentLinkId/trạng thái/guest access hash được giữ. Các tài khoản web cũ chưa được xác minh email không được đánh dấu email đã xác minh: dùng email OTP login để xác minh trước những thao tác yêu cầu verified email.

Import không phải transaction cho toàn bộ file: nếu lỗi giữa chừng, dừng web cũ ghi dữ liệu và chạy lại script. Những record đã import không bị overwrite. Không đồng thời chạy hai migration hoặc cho web/backend thay đổi cùng tài khoản trong lúc import.

6. Deploy web mới, cấu hình API URL. Session SQLite cũ không dùng lại: user đăng nhập lại bằng mật khẩu cũ. Kiểm tra account, lịch sử đơn, guest cookie và payment reconciliation rồi mở lại checkout. Giữ backup đến khi kiểm tra xong; không xóa SQLite vì form liên hệ vẫn dùng.

## 6. Socket và kiểm tra vận hành

- Namespace `/sos`, path `/socket.io/`, handshake `auth: {token: ACCESS_TOKEN}`. Chờ `sos.ready` trước sync REST.
- Trên mobile ưu tiên WebSocket trực tiếp; trình duyệt có thể dùng `transports: ['websocket', 'polling']` nếu môi trường có proxy hạn chế. Khi reconnect, tải lại SOS active/detail và tin nhắn theo sequence như hướng dẫn chat.
- Backend dùng truy vấn theo lô để lọc recipient/contact/user đang active, thay cho nhiều truy vấn tuần tự. Fanout đến recipients chạy đồng thời. Nhiều socket cùng user/session chỉ kiểm tra MongoDB session một lần cho mỗi fanout.
- JWT mới thiếu `exp` được chấp nhận; JWT legacy có `exp` vẫn bị chặn khi hết hạn. Không cache quyền nên contact bị xóa vẫn bị loại ở lần gửi tiếp theo.
- Tắt compression cho payload SOS nhỏ, heartbeat 20 giây/timeout 20 giây. Đây là cải thiện đường gửi trong code, chưa phải số đo độ trễ production.
- Chạy một backend instance nếu chưa cấu hình shared Socket.IO adapter. Nhiều PM2 workers/replicas vẫn cần adapter chia sẻ room và routing phù hợp; thay đổi này không tự thêm Redis adapter.
- Reverse proxy phải chuyển tiếp WebSocket Upgrade và có read timeout lớn hơn heartbeat. Ví dụ phần location Nginx:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:2155;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 75s;
    proxy_send_timeout 75s;
    proxy_buffering off;
}
```

Checklist sau deploy: tạo account web qua OTP, login cùng account trên app, ghép device, tạo COD, xem cùng đơn trên app/web, gửi SOS/GPS/audio/chat đến nhiều người thân, logout web vẫn giữ app, login phone mới thu hồi phone cũ, bỏ contact ngừng nhận dữ liệu, kiểm tra reconnect và webhook bằng cấu hình thật. Bộ test local dùng MongoDB tạm và mock nhà cung cấp, không tạo giao dịch tiền thật.
