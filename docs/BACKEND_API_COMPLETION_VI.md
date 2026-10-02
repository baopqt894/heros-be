# Bổ sung backend HEROS: mobile, thiết bị và vận hành

Ngày: 02/10/2026. Base URL sau khi deploy: `https://heros.nextteam.site/v1`.
Các route bên dưới là code trong bản cập nhật này; không đồng nghĩa server đã được deploy.
JSON thành công: `{ "success": true, "code": 200, "data": ... }` (POST thường 201, xóa tài khoản 202).
Lỗi: `data.errorCode` và `data.message`. File avatar/audio trả binary, không bọc JSON.

## 1. Trạng thái triển khai

| Hạng mục | Đã làm | Giới hạn còn lại |
| --- | --- | --- |
| Xóa tài khoản | OTP email riêng, thu hồi session, hàng đợi xóa trong MongoDB, dọn dữ liệu và file, retry mỗi phút | Chưa revoke authorization phía Apple; backup phải có quy trình xóa/restore riêng |
| Apple | Login và link Apple ID, lưu subject/email/tên; xác minh JWT ký bởi Apple, issuer/audience/expiry/nonce, chặn replay | Cần Bundle ID thật, capability iOS và test bằng Apple thật; chưa exchange authorization code/revoke Apple grant |
| Điện thoại | Theo yêu cầu tạm thời: OTP ngẫu nhiên gửi email, cho phép cập nhật SĐT | KHÔNG phải SMS OTP, không chứng minh sở hữu SĐT |
| Một điện thoại | Một login session đang hoạt động/account; kiểm tra DB mỗi HTTP request và mỗi lần socket emit; push gắn với session | Không chống được sao chép cùng token sang thiết bị khác; cần App Attest/device-bound keys nếu yêu cầu chặt hơn |
| Hủy người thân | Mỗi lần đọc/emit kiểm tra lại liên kết accepted hiện tại; snapshot mới lưu contactId | Không thể thu hồi dữ liệu đã tải/nghe hoặc response đang truyền trước thời điểm hủy |
| Avatar | Upload/xóa/đọc có auth; PNG/JPEG/WebP, tối đa 2 MiB; lưu trong MongoDB | Kiểm tra MIME/signature, không phải dịch vụ biên tập ảnh |
| Audio phần cứng | Upload từng clip, chống trùng bằng clientRecordingId, thông báo realtime khi clip hoàn tất | Không phải WebRTC/livestream âm thanh liên tục |
| GPS phần cứng | PUT vị trí định kỳ, bỏ qua fix cũ, chặn thời gian tương lai >60s | Firmware phải thực sự gửi vị trí; backend không tự đọc GPS |
| Contract phần cứng | HTTP/QR contract v1 có endpoint đọc | BLE UUID, thời lượng nhấn nút, màu LED chưa có thông số xác nhận từ firmware |
| Storage | Bắt buộc đường dẫn persistent ngoài repo ở production, flush file, cleanup retry, orphan sweep, health, script backup | Cần vận hành mount volume, backup MongoDB + audio, retention backup và thử restore thật |

## 2. OTP qua email để cập nhật điện thoại

Mọi route trong mục này cần `Authorization: Bearer ACCESS_TOKEN`.

1. `POST /me/phone/request-otp`, body `{"phone":"+84901234567"}`.
2. Backend tự sinh OTP 6 chữ số bằng random bảo mật, gửi tới email đã xác minh của account. Không trả OTP trong response; không dùng mã cố định 123456 cho flow này.
3. Response có `challengeId`, `deliveryChannel: "email"`, `expiresAt`, `resendAfterSeconds: 60`.
4. `POST /me/phone/verify-otp`, body `{"challengeId":"...","otp":"..."}`.
5. Response: `phone`, `phoneOwnershipVerified: false`, `authorizationMethod: "email_otp"`, `authorizedAt`.

OTP hết hạn sau 5 phút, tối đa 5 lần thử, dùng một lần. OTP bị ràng buộc với account, mục đích và số điện thoại đã yêu cầu; không được gửi phone khác ở bước confirm.
`PATCH /me` không còn cho sửa `phone` trực tiếp (`PHONE_VERIFICATION_REQUIRED`).
Trường `phoneVerifiedAt` không được đặt bởi email OTP; `phoneUpdateAuthorizedAt` chỉ chứng minh đã xác nhận thao tác qua email.
SĐT trong đăng ký hiện vẫn là tự khai. Không dùng nhãn UI “SĐT đã xác minh”.

Không cần cấu hình nhà cung cấp SMS. Dùng SMTP hiện có (`SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`). Debug local có thể để SMTP trống và bật `EMAIL_DEV_LOG_OTP=true` để xem mã trong log; tuyệt đối tắt trên production. Thiếu SMTP khi không bật dev log trả 503.

## 3. Xóa tài khoản

1. `POST /me/deletion/request-otp`, không cần body, nhận challenge gửi email.
2. `DELETE /me`, JSON `{"challengeId":"...","otp":"...","confirmation":"DELETE"}`.
3. HTTP 202: `{"status":"deletion_pending","accessRevoked":true}`. App xóa local session/cache/audio nhạy cảm và quay về login.
4. Backend đánh dấu account `deleting`, vô hiệu HTTP/refresh/socket delivery/hardware auth; worker mỗi 60 giây dọn SOS/audio, contacts, hardware, push devices, refresh sessions, OTP, avatar/profile.
5. Nếu xóa file/DB lỗi: account vẫn `deleting`, không được đăng nhập; worker retry. Log `ACCOUNT_DELETION_RETRY` hoặc `ACCOUNT_DELETION_WORKER_FAILED`; thành công `ACCOUNT_DELETION_COMPLETED`.

202 nghĩa là đã tiếp nhận, không khẳng định file đã xóa xong. Khi backup/restore phải giữ danh sách yêu cầu xóa ngoài bản backup để không phục hồi tài khoản đã xóa. Trước submit Apple còn cần luồng revoke Sign in with Apple authorization theo hướng dẫn Apple; không coi local delete là đã revoke Apple grant.

## 4. Sign in with Apple

Giữ cách đặt field của card-invitation (`appleId`, `email`, `name`), nhưng không cấp token HEROS chỉ từ các field tự khai.

`POST /auth/apple`:

```json
{
  "identityToken": "JWT_FROM_APPLE",
  "rawNonce": "RANDOM_NONCE_AT_LEAST_32_CHARACTERS",
  "deviceId": "stable-ios-installation-id",
  "appleId": "APPLE_USER_IDENTIFIER",
  "email": "optional-email-from-apple@example.com",
  "name": "Tên người dùng",
  "userType": "device_owner"
}
```

- iOS sinh rawNonce mỗi lần login, gửi SHA256(rawNonce) trong Apple authorization request; gửi rawNonce và identityToken về backend qua HTTPS.
- `appleId/email/name` optional; `userType` bắt buộc khi tạo account mới, chỉ `device_owner` hoặc `emergency_contact`.
- Backend lấy danh tính từ token đã xác minh; token chỉ dùng một lần. Nếu retry/login lại cần lấy token mới từ Apple.
- Email trùng tài khoản hiện có nhưng chưa link Apple: `APPLE_ACCOUNT_LINK_REQUIRED`. Đăng nhập tài khoản đó trước, gọi `POST /auth/apple/link` với bearer và payload Apple mới để liên kết; không tự merge theo email.
- Tên chỉ lưu lúc tạo; Apple có thể chỉ trả tên trong lần cấp quyền đầu tiên. Không lưu identityToken hay rawNonce trong user.
- `.env`: `APPLE_CLIENT_IDS=vn.yourcompany.heros` (Bundle ID/audience). Đây KHÁC `APPLE_APP_IDS=TEAMID.vn.yourcompany.heros` dùng cho Universal Links/AASA.
- Chưa có Bundle ID thật: để `APPLE_CLIENT_IDS=`; route Apple trả 503 `APPLE_LOGIN_NOT_CONFIGURED`, email/password vẫn dùng bình thường. Không tự tạo application identifier giả.
- Chưa có authorization-code exchange, lưu/revoke Apple refresh token hoặc server notifications. Cần hoàn tất và test trước public release dùng Apple login.

Nguồn đối chiếu: [Apple: Authenticating users with Sign in with Apple](https://developer.apple.com/documentation/signinwithapple/authenticating-users-with-sign-in-with-apple), [Apple: Verifying a user](https://developer.apple.com/documentation/signinwithapple/verifying-a-user).

## 5. Session và push

Login mới thay `activeSessionKey`, kể cả login lại trên cùng máy. Refresh xoay refresh token nhưng giữ sessionKey; consume refresh là atomic.
Token cũ/legacy thiếu sessionKey bị 401. Socket kiểm tra account/session/expiry trước mỗi lần emit; socket đã bị revoke không được nhận payload mới.
Sau mỗi login, gọi lại `POST /me/devices` với `deviceId` trùng deviceId login, FCM token mới nhất. Push chỉ gửi tới registration gắn session hiện tại.
Refresh không được dùng để chuyển sang deviceId khác. DeviceId do app cung cấp là installation identifier, không phải chứng cứ vật lý không thể giả mạo.

## 6. Avatar

- `POST /me/avatar`: multipart field `avatar`, tối đa 2 MiB, PNG/JPEG/WebP. Response `{avatarUrl: "/v1/profiles/USER_ID/avatar"}`.
- `GET /profiles/:id/avatar`: bearer bắt buộc; chỉ bản thân hoặc người có liên kết accepted với nhau. Mobile ghép origin với đường dẫn, gửi Authorization khi load ảnh.
- `DELETE /me/avatar`: xóa avatar.
- Avatar nằm trong MongoDB (không public static), đi theo backup/delete account. Không cache public. Snapshot avatar SOS cũ có thể không có URL mới; lấy profile mới khi cần.

## 7. Contract thiết bị v1

`GET /me/heros-devices/contract` (bearer mobile) trả QR, HTTP routes, limits, retry và trạng thái chưa cấu hình firmware.
QR đề xuất: `{"v":1,"hardwareId":"HEROS-DEV-0001"}`. Không nhúng deviceToken vào QR công khai. Đây là serial discovery, không phải chứng cứ quyền sở hữu; cần registry/claim secret sản xuất trước khi bán rộng rãi.
Mobile pair bằng `POST /me/heros-devices`; token trả một lần. Cấp token cho firmware qua kênh provisioning an toàn. BLE service/characteristic UUID và encryption phải do firmware/mobile thống nhất, chưa có trong backend.

Mọi request hardware dùng 2 header, KHÔNG dùng access token của app:

```text
X-Heros-Hardware-Id: HEROS-DEV-0001
X-Heros-Device-Token: DEVICE_TOKEN_RETURNED_WHEN_PAIRED
```

- `POST /device/sos`: giữ nguyên payload create SOS (`clientRequestId` UUID, message, location).
- `GET /device/sos/active`: khôi phục eventId sau reboot. `data: null` khi không có SOS.
- `PUT /device/sos/:id/location`: `{latitude,longitude,accuracy,recordedAt,address?}`. Gợi ý gửi mỗi 5 giây khi active, giữ UTC recordedAt gốc khi retry; fix cũ/bằng thời điểm hiện tại bị bỏ qua và trả vị trí hiện tại.
- `POST /device/sos/:id/recordings`: multipart `audio`, `durationSeconds`, `clientRecordingId` UUID bắt buộc. Mỗi clip gợi ý 10 giây; mỗi clip <=120 giây/10 MiB; mỗi SOS <=600 clips/100 MiB. Retry dùng đúng ID cũ, trả cùng recording thay vì cộng thêm file.
- Audio AAC/M4A/MP4/MP3/OGG/WAV đã đóng gói hoàn chỉnh; không gửi PCM thô hoặc byte stream chưa kết thúc. Client nhận `sos.recording` sau khi lưu clip.
- Chỉ device của owner được cập nhật SOS owner đó. Audio chỉ upload khi SOS active; owner được đọc lại tới hết retention. Người thân phải accept SOS và còn liên kết accepted.
- Retry mạng/408/429/5xx theo backoff 1/2/4/8/16/30 giây + jitter; 401 dừng và yêu cầu provision lại; không tạo UUID khác khi retry cùng dữ liệu. Giới hạn hàng đợi offline trên firmware; không giữ âm thanh plaintext vô hạn.
- Nút SOS -> create SOS; nút recording -> ghi/chia clip/upload là ánh xạ chức năng đề xuất. Chưa chốt short/long/double press, debounce, LED colors. Không hiển thị hướng dẫn thao tác giả định cho khách hàng.

### cURL import Postman

Thay DEVICE_TOKEN và SOS_ID bằng giá trị thật; không dùng placeholder để gửi tới người thật.

```bash
curl --request PUT 'https://heros.nextteam.site/v1/device/sos/SOS_ID/location' \
  --header 'X-Heros-Hardware-Id: HEROS-DEV-0001' \
  --header 'X-Heros-Device-Token: DEVICE_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{"latitude":10.762622,"longitude":106.660172,"accuracy":5,"recordedAt":"2026-10-02T10:00:00.000Z","address":"Vị trí thử nghiệm"}'

curl --request POST 'https://heros.nextteam.site/v1/device/sos/SOS_ID/recordings' \
  --header 'X-Heros-Hardware-Id: HEROS-DEV-0001' \
  --header 'X-Heros-Device-Token: DEVICE_TOKEN' \
  --form 'audio=@/absolute/path/clip.m4a;type=audio/mp4' \
  --form 'durationSeconds=10' \
  --form 'clientRecordingId=36c77012-8bbf-4b4b-932f-32c6b738b169'
```

Đổi recordedAt thành thời gian GPS thật; không copy thời gian ví dụ cho các lần cập nhật mới. Mỗi clip mới cần UUID mới.

## 8. Storage, retry và backup

Production bắt buộc `SOS_RECORDINGS_DIR` tuyệt đối, ngoài thư mục repo/deploy, ví dụ `/var/lib/heros/sos-recordings`. Backend từ chối boot nếu cấu hình production vẫn là relative hoặc nằm trong repo. Trước deploy phải migrate file cũ sang volume mới, giữ nguyên storageKey, quyền thư mục 700/file 600, service user có quyền đọc/ghi; không expose bằng nginx/static.

File ghi với flush; metadata chỉ lưu sau write. Cleanup mỗi 6 giờ: IO lỗi giữ metadata để retry, không im lặng mất dấu. Xóa thủ công đánh dấu hết hạn trước khi xóa vật lý; nếu lỗi sẽ được cleanup retry. Pull recording/cập nhật dung lượng là atomic, không ghi đè clip mới upload song song. File mồ côi không có metadata quá 24 giờ được dọn (grace period bảo vệ upload đang chạy).
Playback và list ẩn recording hết 30 ngày ngay; xóa file vật lý có thể trễ đến kỳ cleanup tiếp theo, lâu hơn nếu volume lỗi. Không hứa xóa vật lý chính xác từng giây.

`OPS_HEALTH_TOKEN` là secret vận hành riêng; không đưa vào app. `GET /health/storage` với `X-Heros-Ops-Token` trả status, availableBytes, cleanup.lastSuccessAt/failures. Monitor HTTP lỗi, status != ok, lần cleanup thành công quá 7 giờ, log `RECORDING_*_RETRY` và `ACCOUNT_DELETION_*`. Endpoint vẫn có thể trả 200 khi degraded: monitor phải đọc data.status.

`bash scripts/backup-recordings.sh` dùng restic đã cài sẵn, yêu cầu `SOS_RECORDINGS_DIR`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE` trong environment. Script backup mã hóa ra repository ngoài máy và chạy restic check; không tự cài cron, không tự prune/xóa snapshot. Cấu hình cron/job vận hành và alert theo exit code. Secret backup không commit vào git.

Backup MongoDB bằng Atlas backup/PITR hoặc mongodump do vận hành thiết lập; metadata và file phải có recovery point tương thích. Multi-instance cần shared persistent filesystem hoặc storage adapter object store; không chạy từng instance với local disk riêng.

**Retention backup cần chốt riêng:** snapshot cũ vẫn có thể chứa recording/account đã xóa trên live. Không mặc định giữ backup thêm 30 ngày rồi tuyên bố âm thanh bị xóa hoàn toàn sau 30 ngày. Nếu yêu cầu xóa tuyệt đối bao gồm backup, cần cơ chế purge/crypto-erasure theo từng recording và quy trình restore áp lại deletion ledger trước mở traffic. Script hiện tại chưa giải quyết yêu cầu đó.

Chưa provision volume, repository, scheduler hay kiểm thử restore trên server trong bản sửa code này.

## 9. Checklist deploy và test

1. Điền persistent path production, migrate recording cũ và kiểm tra backup trước đổi path; không xóa thư mục cũ trước đối soát.
2. Giữ JWT_ACCESS_SECRET/OTP_HASH_SECRET mạnh. SMTP thật, EMAIL_DEV_LOG_OTP=false, DEMO_AUTH_ENABLED=false khi phát hành public.
3. APPLE_CLIENT_IDS có thể trống lúc debug chưa dùng Apple. Các URL Store/TestFlight và APPLE_APP_IDS vẫn có thể trống nếu chưa test Universal Links.
4. Build/test; deploy backend. Bản này vô hiệu token legacy: mobile cần login lại và đăng ký lại FCM.
5. Test owner/contact trên hai điện thoại: SOS device, GPS mới/cũ, clip retry, accept, unlink, mất quyền nghe, resolve, upload avatar, OTP email, xóa account test.
6. Test Apple thật khi có cấu hình. Chốt firmware và kiểm thử vật lý, background app/push, mount/backup/restore trước phát hành. Không lấy unit/integration pass làm bằng chứng SMS/push/Apple/hardware ngoài đời đã hoạt động.

`npm test -- --runInBand` có integration suite dùng mongodb-memory-server và cổng localhost, không dùng DB thật. Lần đầu cần tải MongoDB test binary. Email và FCM được mock; filesystem chỉ dùng temp directory riêng.
