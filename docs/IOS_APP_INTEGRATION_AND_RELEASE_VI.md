# HEROS: tích hợp iOS, lời mời người thân và phát hành App Store

Cập nhật: 01/10/2026. Tài liệu bàn giao cho đội iOS, backend và người quản lý App Store Connect. Contract dưới đây được đối chiếu với source của repository này. Có code trong Git không có nghĩa production đã deploy; luôn kiểm tra Swagger và smoke test sau deploy.

## 1. Phạm vi sản phẩm và màn hình

MVP có hai loại tài khoản: `device_owner` và `emergency_contact`. Không cho chọn cộng đồng, không tìm người gần, không mở rộng bán kính.

| Màn hình       | Owner                                                | Người thân                            |
| -------------- | ---------------------------------------------------- | ------------------------------------- |
| Bản đồ         | SOS của mình, trạng thái hỗ trợ                      | Các SOS được mời hỗ trợ               |
| Thiết bị       | Serial/QR, trạng thái, pin, ghép/thu hồi             | Không hiển thị                        |
| Người thân     | Thêm/sửa/xóa, gửi lời mời                            | Nhận/chấp nhận/từ chối lời mời        |
| Ghi âm của tôi | Danh sách, nghe, xóa; lưu bản riêng trên máy nếu cần | Không có thư viện recording của owner |
| Hồ sơ          | Xem/sửa thông tin, đăng xuất                         | Tương tự                              |

Home là bản đồ. Marker SOS mở sheet gồm tên, avatar (có thể thiếu), địa chỉ hoặc tọa độ, thời điểm phát tín hiệu, số người hỗ trợ, danh sách recording khi được phép. `responderCount` là tổng người đã accept, có thể bao gồm hỗ trợ từ xa; không gắn nhãn tất cả là “đang trên đường”.

## 2. Trạng thái thật và các việc còn thiếu trước phát hành

Đã có: đăng ký/email OTP/password/Google, quản lý contact, SOS từ app hoặc device, GPS, FCM, Socket.IO, upload/play/delete recording, giữ recording 30 ngày, telemetry pin, lời mời tài khoản có sẵn. Bản thay đổi cùng tài liệu này thêm mời người chưa có tài khoản bằng mã/link, trang cài đặt, config và AASA.

Các giới hạn hiện tại phải xử lý/kiểm thử trước public release, không coi là đã hoàn thành:

- Chưa có API xóa tài khoản. UI “xóa” phải thực sự kích hoạt quy trình xóa dữ liệu; không dùng logout thay thế.
- Có Google login nhưng chưa có Sign in with Apple. Chọn email/password cho bản đầu hoặc bổ sung lựa chọn login đáp ứng guideline 4.8 trước khi đưa Google login vào app phát hành.
- SĐT unique và bắt buộc khi đăng ký email nhưng chưa có SMS OTP; đây chưa phải xác minh quyền sở hữu SĐT. Ngày sinh/tên là tự khai, không phải KYC.
- Một owner có unique hardware index, nhưng đăng ký owner chưa bắt buộc serial, chưa xác minh serial thuộc hàng đã sản xuất. Pair API là cấp credential, không phải bằng chứng sở hữu vật lý.
- Đăng nhập owner trên máy khác chỉ revoke refresh session cũ. Access JWT cũ và socket cũ có thể tiếp tục hoạt động tới khi hết hạn/ngắt kết nối. Chưa bảo đảm “chỉ một điện thoại hoạt động” tuyệt đối.
- Contact limit hiện là count trước insert, cần chống race khi thêm đồng thời. Dữ liệu contact cũ thiếu `invitationStatus` cần migration có kiểm soát; default Mongoose có thể khiến liên hệ cũ thành `unlinked`.
- Hủy contact chưa thu hồi ngay recipient snapshot trong SOS đang diễn ra. Cần backend xử lý trước khi cam kết hủy quan hệ là mất toàn bộ quyền SOS lập tức.
- Recording dọn mỗi 6 giờ: playback chặn ngay hết hạn, file có thể còn tới lần dọn kế tiếp. Job hiện chưa có retry/quan sát lỗi đầy đủ; API list có thể còn metadata expired trước cleanup. Storage là local disk, cần persistent volume, backup policy và quản lý nhiều instance.
- Chưa có API avatar upload, SOS decline riêng, hardware upload audio hay hardware cập nhật GPS liên tục. Device hiện chỉ tạo SOS/ping/báo pin; GPS/recording tiếp theo do app owner gửi.
- Chưa có quy ước nút/LED từ firmware. Không viết hướng dẫn bấm/đèn giả định.

## 3. Cấu hình môi trường

API base: `https://heros.nextteam.site/v1`. Socket origin: `https://heros.nextteam.site`, namespace `/sos`. Swagger: `https://heros.nextteam.site/api-docs`.

Backend `.env` (đã có tên biến trong `.env.example`):

```dotenv
APP_INVITE_BASE_URL=https://heros.nextteam.site/invite
INVITE_TTL_DAYS=7
APP_DISTRIBUTION_CHANNEL=testflight
IOS_TESTFLIGHT_URL=
IOS_APP_STORE_URL=
ANDROID_DOWNLOAD_URL=
APPLE_APP_IDS=
```

Điền `IOS_TESTFLIGHT_URL` bằng public link thật từ App Store Connect. Để trống thì trang lời mời ẩn nút cài đặt và báo chưa công bố. `APPLE_APP_IDS` là danh sách application identifier `App-ID-prefix.Bundle-ID`, phân cách bằng dấu phẩy; prefix thường là Team ID nhưng phải kiểm tra entitlement của bản signed. Không tự tạo Team ID/Bundle ID giả. Dev và production khác bundle thì cần khai báo cả hai ID khi cùng dùng domain.

`GET /v1/app-config` công khai trả `distributionChannel`, `iosDownloadUrl`, `androidDownloadUrl`, `inviteBaseUrl`, `invitationRequiresVerifiedEmail`. URL tải chỉ nhận HTTPS. App không được lấy cấu hình xác thực/secrets từ endpoint này.

Giữ `JWT_ACCESS_SECRET`, `OTP_HASH_SECRET`, Mongo URI, SMTP và Firebase private key ở server. Firebase iOS plist phải khớp Bundle ID; service account private key tuyệt đối không đưa vào app.

Trong Xcode dùng Build Configuration riêng Development/Staging/Release. Release trỏ backend production; staging cần DB/storage/FCM riêng để test không báo động người thật. Không tắt ATS toàn cục.

## 4. HTTP, token và lỗi

```json
{ "success": true, "code": 200, "data": {} }
```

POST có thể trả 201; client chấp nhận mọi HTTP 2xx phù hợp. Lỗi:

```json
{
  "success": false,
  "code": 400,
  "data": { "errorCode": "INVITE_INVALID_OR_EXPIRED", "message": "Bad request" }
}
```

`data.details` có thể là mảng validation hoặc object như `retryAfterSeconds`. Gửi JSON đúng tên field vì backend từ chối field thừa. Ngày giờ UTC ISO8601; ID dùng String. Mongo model có `_id`, SOS mobile response có `id`; đừng dùng một model chung mặc định cho mọi API.

Gửi `Authorization: Bearer <accessToken>` cho route được bảo vệ. Lưu token trong Keychain, không log token/OTP/mã lời mời/GPS/audio. Refresh token quay vòng: serialize refresh bằng actor/single-flight; thay cả hai token sau refresh. Gặp 401 thử refresh một lần; thất bại thì đăng nhập lại. Mã HTTP 429 phải backoff theo thời gian trả về.

## 5. Đăng ký, đăng nhập và hồ sơ

1. `POST /auth/email/request-otp` body `{"email":"relative@example.com","purpose":"register"}`.
2. Người dùng nhận email và nhập OTP.
3. `POST /users`:

```json
{
  "email": "relative@example.com",
  "otp": "MA_OTP_THAT",
  "deviceId": "UUID-CUA-BAN-CAI-APP",
  "password": "MatKhauTu8KyTu",
  "fullName": "Nguyễn Văn B",
  "dateOfBirth": "1995-08-20",
  "phone": "+84901234567",
  "userType": "emergency_contact"
}
```

Password tùy chọn nhưng nếu gửi phải dài 8–128 ký tự; `gender` tùy chọn. Owner dùng `device_owner`. Mời người thân chưa có tài khoản không cần đăng ký thay họ. Không ép owner biết mật khẩu người thân.

| API                            | Body / hành vi                                                             |
| ------------------------------ | -------------------------------------------------------------------------- |
| `POST /auth/login`             | `email`, `password`, `deviceId`                                            |
| `POST /auth/email/request-otp` | `email`, `purpose: login` cho user đã tồn tại                              |
| `POST /auth/email/verify-otp`  | `email`, `otp`, `deviceId`                                                 |
| `POST /auth/refresh`           | `refreshToken`, `deviceId`                                                 |
| `POST /auth/logout`            | `refreshToken`; xóa token/cache local sau đó                               |
| `POST /auth/password/reset`    | `email`, login `otp`, `newPassword` từ 8 ký tự, `deviceId`                 |
| `POST /auth/google`            | `idToken`, `deviceId`, `userType` khi tạo tài khoản mới                    |
| `GET /me`                      | Hồ sơ hiện tại                                                             |
| `PATCH /me`                    | `fullName`, `dateOfBirth`, `gender`, `phone`; không gửi userType/avatarUrl |

Response login/register chứa `accessToken`, `refreshToken`, `refreshExpiresAt`, `user`. Tạo installation UUID một lần cho app, giữ ổn định giữa các lần gọi; không dùng serial hardware thay `deviceId`.

Hai account test đã seed ở database cấu hình trong phiên trước: `owner@heros.vn`, `contact@heros.vn`, password `123456`; mock OTP `123456` chỉ áp dụng hai email này. Không dùng mock cho đăng ký user thật. Seed có thể chạy lại bằng `npm run seed:demo` nhưng sẽ reset thông tin demo; chỉ chạy trên môi trường xác định. Code hiện bật mock trừ khi `DEMO_AUTH_ENABLED=false`: public production nên tắt và đổi mật khẩu demo, tách reviewer account khỏi dữ liệu thật.

## 6. Contact và lời mời trước khi lên Store

### Luồng mới cho người chưa có app/tài khoản

1. Owner `POST /emergency-contacts` với `name`, `relationship`, `email` và/hoặc `phone`; không gửi `linkedUserEmail` khi người nhận chưa đăng ký.
2. Lấy `_id`, gọi `POST /contact-invites/{contactId}` với `{"email":"relative@example.com"}`. Đây là email tài khoản sẽ dùng để nhận lời mời, không mặc định là Apple ID tải TestFlight.
3. Response có `contactId`, `inviteCode`, `inviteUrl`, `expiresAt`. Owner dùng iOS Share Sheet chia sẻ link qua Zalo/Messages. Backend không tự gửi email/SMS lời mời.
4. Người thân mở `https://heros.nextteam.site/invite#code=...`. Trang không công khai tên/email/GPS; mã ở fragment để tránh access log và Referer. Nút tải lấy config server.
5. Sau khi cài, mở lại link hoặc paste mã. Người nhận đăng ký/đăng nhập đúng email, role `emergency_contact`.
6. App hiển thị xác nhận người dùng trước khi gọi `POST /contact-invites/accept`, body `{"code":"32_KY_TU_HEX_TRONG_RESPONSE"}`.
7. Accept nguyên tử: phải đúng email đã xác minh, trạng thái pending, chưa quá hạn; sau đó xóa hash token. Dùng lại sẽ thất bại. App refresh dữ liệu sau lỗi mạng vì request trước có thể đã thành công.

Mã hiện có 32 ký tự hex (128-bit), nên ưu tiên copy/paste/Share Sheet. Không phải OTP 6 số. Server chỉ giữ SHA-256; không thể lấy lại mã cũ. Gọi issue lại sẽ thay mã và gia hạn, mã trước mất hiệu lực. TTL mặc định 7 ngày, cho cấu hình 1–30 ngày. Contact đã accepted không được issue lại; muốn đổi người thì xóa/tạo contact mới.

`DELETE /contact-invites/{contactId}` thu hồi lời mời pending. Xóa contact cũng làm token không còn redeem được. Endpoint accept rate limit theo user (in-memory từng instance); triển khai nhiều replica nên thêm shared limiter/gateway. Không có public API tra email/lookup token.

### Luồng cũ cho người đã có tài khoản

`POST/PATCH /emergency-contacts` với `linkedUserEmail` tạo invitation pending. Người thân gọi `GET /emergency-contacts/invitations`, sau đó `POST /emergency-contacts/invitations/{id}/accept` hoặc `/decline`. Đây là lời mời theo account, không phải token/deep link; không trộn hai luồng trên một contact cùng lúc.

Owner quản lý `GET/POST /emergency-contacts`, `PATCH/DELETE /emergency-contacts/{id}`. Người nhận hủy liên kết qua `DELETE /emergency-contacts/invitations/{id}/link`. Hiện chưa có danh sách riêng tất cả quan hệ đã accepted cho người nhận; UI cần thêm API trước khi làm màn hình quản lý quan hệ hoàn chỉnh.

### cURL dùng với Postman

Thay `OWNER_ACCESS_TOKEN`, `CONTACT_ACCESS_TOKEN`, `CONTACT_ID` bằng dữ liệu trả từ API. Không đưa các giá trị này vào Git.

```bash
curl --request POST 'https://heros.nextteam.site/v1/contact-invites/CONTACT_ID' \
  --header 'Authorization: Bearer OWNER_ACCESS_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{"email":"relative@example.com"}'
```

```bash
curl --request POST 'https://heros.nextteam.site/v1/contact-invites/accept' \
  --header 'Authorization: Bearer CONTACT_ACCESS_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{"code":"PASTE_32_HEX_CHARACTERS_FROM_ISSUE_RESPONSE"}'
```

## 7. Deep link trên iOS

Thêm URL Type scheme `heros` và capability Associated Domains `applinks:heros.nextteam.site`. Backend phục vụ AASA không redirect tại `/.well-known/apple-app-site-association`, path `/invite`; điền application identifier thật vào `APPLE_APP_IDS`, restart backend rồi cài lại app để kiểm tra.

Swift parser mẫu cho cả Universal Link và fallback scheme:

```swift
import Foundation

func invitationCode(from url: URL) -> String? {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let items: [URLQueryItem]
    if parts.scheme == "https", parts.host == "heros.nextteam.site", parts.path == "/invite" {
        items = URLComponents(string: "?" + (parts.fragment ?? ""))?.queryItems ?? []
    } else if parts.scheme == "heros", parts.host == "invite" {
        items = parts.queryItems ?? []
    } else {
        return nil
    }
    guard let code = items.first(where: { $0.name == "code" })?.value,
          code.range(of: "^[A-Fa-f0-9]{32}$", options: .regularExpression) != nil else { return nil }
    return code.uppercased()
}
```

Gắn handler vào `.onOpenURL` và `.onContinueUserActivity(NSUserActivityTypeBrowsingWeb)` để đọc `activity.webpageURL`. Cất mã tạm trong Keychain khi cần đi qua login; xóa sau accept/revoke/hết hạn hoặc khi đổi người dùng. Không log URL nguyên vẹn. Không tự động accept chỉ vì app mở link.

Universal Link cần entitlement và AASA khớp, không cần app đã public trên Store. Test link từ Messages/Mail và app đóng/mở; Safari cùng domain có thể ở lại web. Trang có nút `heros://invite?code=...` làm fallback. Custom scheme không xác minh quyền sở hữu domain, vì vậy vẫn bắt buộc server kiểm email/token.

Việc cài app qua TestFlight/Store không tự chuyển mã từ Safari sang app. Cho người dùng mở lại link hoặc nhập mã đã sao chép; chưa triển khai deferred deep linking. Hướng dẫn Apple: [Universal Links](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content), [chẩn đoán AASA](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links).

## 8. Ghép thiết bị và pin

`GET /me/heros-devices` đọc thiết bị. `POST /me/heros-devices` body `{"hardwareId":"SERIAL_THAT","label":"Thiết bị của tôi"}` trả `deviceToken` một lần. QR chỉ là cách nhập serial; BLE provisioning và định dạng QR thực phải chốt với firmware. Đừng gửi JWT app vào firmware thay device credential.

Device dùng `X-Heros-Hardware-Id`, `X-Heros-Device-Token` cho `GET /device/sos/ping`, `POST /device/sos`, `PUT /device/status`. Token hardware không có trong tài liệu hay app source. Pair lại cùng serial xoay token; `DELETE /me/heros-devices/{hardwareId}` vô hiệu token, chưa xóa document để chuyển sang serial mới. Flow thay thiết bị cần được thiết kế thêm.

```json
{ "batteryPercent": 82, "isCharging": false, "estimatedMinutesRemaining": 2880 }
```

Body trên dùng cho `PUT /device/status`. Estimate do firmware tính; backend không suy ra số ngày chỉ từ phần trăm. App đọc `batteryReportedAt` để hiện stale/offline, và chia phút thành ngày/giờ/phút. Dữ liệu cũ có thể còn estimate trước nếu firmware bỏ field; không coi đó là dự báo mới.

## 9. SOS, GPS và bản đồ

`POST /sos` bằng JWT owner hoặc `POST /device/sos` bằng hardware credential:

```json
{
  "clientRequestId": "125fe329-0bfd-428f-a69f-a9cefe22449e",
  "message": "Tôi cần người thân hỗ trợ",
  "location": {
    "latitude": 10.762622,
    "longitude": 106.660172,
    "accuracy": 12,
    "recordedAt": "2026-10-01T02:00:00.000Z",
    "address": "Địa chỉ hiện tại"
  }
}
```

Thay timestamp bằng thời gian đo thật. UUID mới cho lần bấm mới, giữ nguyên khi retry. Một owner chỉ có một sự cố active/acknowledged; xử lý `SOS_ALREADY_ACTIVE` bằng `GET /sos/active`. Rate limit hiện 5 SOS/10 phút; app cần xử lý lỗi này, không tạo UUID liên tục để retry.

Owner khôi phục `GET /sos/active`; người thân khôi phục `GET /sos/incoming/active`. Chi tiết `GET /sos/{id}`. Người thân thấy GPS trước acknowledge để đặt marker, recordings chỉ hiện sau acknowledge khi sự cố còn active. Địa chỉ do mobile reverse geocode và gửi `location.address`; backend chưa có geocoder. Không có địa chỉ thì hiển thị tọa độ, không tự bịa địa chỉ.

`POST /sos/{id}/acknowledge` body `{"supportMode":"in_person"}` hoặc `{"supportMode":"remote"}`; body `{}` vẫn hợp lệ. Response có `viewerAcknowledged`, `responderCount`. Accept idempotent nhưng hiện không đổi mode sau accept. Owner `PUT /sos/{id}/location` với latitude/longitude/accuracy/recordedAt/address; chỉ gửi khi cần và lúc sự cố hoạt động. iOS background không bảo đảm chu kỳ 10–15 giây chính xác.

`POST /sos/{id}/resolve` cho “Tôi đã an toàn”; `POST /sos/{id}/cancel` body `{"reason":"Bấm nhầm"}`. Dừng GPS/recording trên app, đóng player phía người thân, xóa cache tạm. API playback chặn recipient ngay sau kết thúc nhưng stream đang tải và bytes đã nhận không tự bị thu hồi. Owner vẫn được nghe đến hết retention.

## 10. Push và Socket.IO

Thêm Firebase Messaging đúng project, APNs key trong Firebase, Push Notifications capability. Xin permission thông báo theo ngữ cảnh. `POST /me/devices` body `{"deviceId":"INSTALLATION_UUID","platform":"ios","pushToken":"FCM_REGISTRATION_TOKEN"}`; đây là FCM registration token, không phải APNs token thô. Đăng ký lại khi token đổi, xóa bằng `DELETE /me/devices/{deviceId}` khi logout nếu có thể.

Payload push có `type` và `sosId`: `SOS_CREATED`, `SOS_RECORDING_AVAILABLE`, `SOS_RESOLVED`, `SOS_CANCELLED`. Tap notification gọi API chi tiết, không tin payload cũ là trạng thái mới nhất. Push bị tắt/Focus/mất mạng có thể không tới; đừng hiển thị “đã giao” chỉ vì create SOS thành công. Critical Alerts cần entitlement riêng, backend hiện dùng âm mặc định.

Socket.IO namespace `/sos`, transport path mặc định `/socket.io`, handshake `auth: {token: accessToken}`. Đây không phải raw WebSocket. Đổi JWT thì reconnect. Các event:

| Event                            | Payload chính                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `sos.created`                    | `id`, `code`, `ownerName`, `ownerAvatarUrl`, `currentLocation`, `startedAt`, `message` |
| `sos.location`                   | `sosId`, `location` (gửi người đã acknowledge)                                         |
| `sos.acknowledged`               | `sosId`, `userId`, `responderCount`, `supportMode`                                     |
| `sos.recording`                  | `sosId`, `recording`                                                                   |
| `sos.resolved` / `sos.cancelled` | `sosId`, `status`                                                                      |

GPS GeoJSON `coordinates` có thứ tự `[longitude, latitude]`. Reconnect phải fetch active/detail vì socket không replay sự kiện đã bỏ lỡ. Nếu chưa acknowledge, app refresh detail để cập nhật marker. Socket hiện không tự thu hồi JWT cũ; xem giới hạn session phía trên.

## 11. Recording, SMS và cuộc gọi

`POST /sos/{id}/recordings`: multipart gồm `audio` binary và `durationSeconds`. AAC/M4A/MP4 audio/MP3/OGG/WAV; mỗi clip tối đa 10 MiB và 120 giây, mỗi SOS tối đa 20 clips và 100 MiB. Đây là upload các clip, không phải truyền audio realtime vô hạn. Khi vượt limit phải xử lý `SOS_RECORDING_LIMIT_REACHED`.

`GET /sos/{id}/recordings/{recordingId}` trả audio binary, không bọc JSON. Dùng Authorization header; không nối JWT vào query. iOS dùng URLSession có auth với cache policy phù hợp rồi phát dữ liệu tạm; đừng dùng đường dẫn playback làm URL public. Player có thể nhận 403 sau resolve và 404 khi file bị xóa/hết hạn.

Owner `GET /sos/recordings` và `DELETE /sos/{id}/recordings/{recordingId}`. Nếu muốn giữ bằng chứng lâu hơn server retention thì app owner phải chủ động tải/lưu bản local với file protection và consent; backend không tự sao chép xuống điện thoại. Xóa server không tự xóa bản export của owner.

Recipient không có nút tải/chia sẻ; không cache vào thư mục public/backup. Dừng phát khi phát hiện screen capture theo API phù hợp iOS deployment target. Không thể cam kết tuyệt đối mọi video quay màn hình đều không tiếng hay người nghe không thu lại được. Cần QA trên máy thật, không dùng thủ thuật private API che view để né capture.

SMS: backend trả `smsPayload.recipients/message`; app dùng composer, người dùng xác nhận gửi. `PUT /sos/{id}/sms-status` nhận `composer_opened` hoặc `user_reported_sent`, không phải delivery receipt. Gọi người thân bằng `tel:` theo thao tác người dùng. Device gọi server không làm iPhone tự gửi SMS/gọi; trường hợp đó dùng FCM/email, hoặc cần SMS/voice provider server riêng.

## 12. Quyền iOS và dữ liệu riêng tư

Chuẩn bị purpose strings rõ mục đích: `NSLocationWhenInUseUsageDescription`; chỉ xin Always và bật location background nếu flow thực sự cần; `NSMicrophoneUsageDescription` khi bắt đầu ghi âm; `NSCameraUsageDescription` khi quét QR; `NSBluetoothAlwaysUsageDescription` nếu có BLE thật. Không xin Contacts nếu người dùng chỉ nhập số/email thủ công.

Test khi từ chối quyền, approximate location, mất mạng, app bị kill, điện thoại khóa, background task bị dừng. Background mode phải khớp hoạt động thật, không dùng silent audio để giữ app sống. Apple yêu cầu minh bạch khi thu dữ liệu và policy phù hợp: [Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Khai App Privacy theo dữ liệu thực gửi server: tên/email/SĐT, ngày sinh khi có, vị trí chính xác, audio, ID tài khoản/thiết bị, diagnostics nếu SDK thu. Đánh dấu liên kết với danh tính và mục đích đúng. Rà SDK/PrivacyInfo.xcprivacy/required-reason APIs theo dependency thực, không mặc định “không thu thập dữ liệu”. [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy).

## 13. Chạy TestFlight khi chưa lên Store

1. Có Apple Developer Program, tạo explicit Bundle ID và app record trong App Store Connect. Chọn Bundle ID thật, Team/signing đúng; tạo Firebase iOS app tương ứng.
2. Đội iOS gửi cho backend application identifier từ signed entitlement, public TestFlight URL sau khi có; backend điền `APPLE_APP_IDS`, `IOS_TESTFLIGHT_URL` và giữ `APP_DISTRIBUTION_CHANNEL=testflight`.
3. Build bằng Xcode/SDK thỏa yêu cầu Apple hiện hành; Archive → Organizer → Validate/Distribute App → App Store Connect. Tăng build number mỗi lần upload.
4. Chờ processing, khai encryption compliance theo thư viện/thực tế; không trả lời máy móc. Thêm internal testers để QA ban đầu.
5. Tạo external testing group, Test Information/What to Test, reviewer access; build đầu external cần beta review. Khi được phép, bật public link và đặt vào backend.
6. Người thân cài TestFlight, mở public link cài HEROS, rồi mở lại invite hoặc paste mã. TestFlight Apple ID và email HEROS không bắt buộc giống nhau.
7. Theo dõi build hết hạn; một build TestFlight dùng tối đa 90 ngày. Upload build tiếp và kiểm tra link vẫn hoạt động. [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

Theo trang Apple kiểm tra ngày 01/10/2026: upload yêu cầu Xcode 26+ với iOS 26 SDK từ 28/04/2026; deployment target iOS 13+ từ 09/09/2026. SDK build khác minimum OS app hỗ trợ. Xem lại [Upcoming Requirements](https://developer.apple.com/news/upcoming-requirements/) ngay trước upload vì chính sách có thể đổi.

## 14. Chuẩn bị submit App Store

Hoàn tất các blocker ở mục 2, đặc biệt account deletion. App tạo tài khoản phải cho khởi tạo xóa từ trong app; backend phải thực hiện thật, bao gồm dữ liệu liên quan theo chính sách lưu giữ. [Account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/).

HEROS dùng định vị trong tình huống nguy hiểm nên cần xem xét kỹ guideline 5.1.5 về Location Services/emergency services; làm rõ chức năng thực với App Review. Không cam kết được duyệt chỉ nhờ đổi tên hoặc thêm disclaimer. Không mô tả là thay thế cơ quan cứu hộ hay bảo đảm hỗ trợ tức thời nếu hệ thống không thực hiện điều đó. [Review Guidelines 5.1.5](https://developer.apple.com/app-store/review/guidelines/#location-services).

Chuẩn bị metadata: tên/subtitle/mô tả, icon, screenshots đúng các thiết bị hỗ trợ, category, age rating questionnaire, support URL, privacy policy URL có nội dung thật, copyright, vùng phát hành và giá. Chỉ chụp tính năng có thật; ẩn cộng đồng chưa triển khai. Khai SDK/privacy/encryption và EU trader status nếu thuộc phạm vi áp dụng.

App Review Information phải có người liên hệ được, account reviewer hoạt động, mô tả từng bước, tài nguyên/hardware cần để kiểm tra. Account demo có quyền trên dữ liệu giả, không liên kết người thật. Không hardcode mock chung hoặc dùng bypass ẩn dành riêng reviewer. Nếu cần phần cứng, thống nhất với Apple cách cung cấp hardware hoặc demo đầy đủ được chấp thuận; video chỉ bổ trợ, không thay quyền truy cập app.

Mẫu review notes cần điền đúng thực tế trước submit, không gửi nguyên placeholder:

```text
HEROS connects a device owner with invited personal contacts.
Review account (owner): [dedicated reviewer email and password]
Review account (contact): [dedicated reviewer email and password]
Backend: [live environment used by this build]

Steps: sign in as owner, open the map/device screen, follow the supplied
hardware setup instructions, create a test SOS, and sign in as the linked
contact on a second device to acknowledge it. Open the audio clip and map.
Resolve the SOS as owner; recipient audio access ends.

Hardware/access resources: [actual device arrangements, serial/QR and guide]
Account deletion: [exact screen path, only after implemented]
Location/recording behavior: [actual permissions, start/stop rules]
No real emergency or third-party notification is triggered by these test accounts.
Support contact: [reachable person/email/phone]
```

Dòng cuối về test không báo động phải được kiểm chứng trong môi trường reviewer; không hứa nếu tài khoản vẫn gửi tới người thật.

Trong App Store Connect chọn version/build đã QA, điền metadata/review information, chọn manual release cho lần đầu, Add for Review rồi Submit for Review. “Add for Review” chưa đồng nghĩa đã gửi. Theo dõi Resolution Center, tái hiện lỗi Apple báo, sửa/upload build mới khi cần. [Submit an app](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app/).

## 15. Khi được duyệt và chuyển link sang Store

Sau khi app thật sự đã available ở vùng mục tiêu, đặt:

```dotenv
APP_DISTRIBUTION_CHANNEL=store
IOS_APP_STORE_URL=https://apps.apple.com/app/idAPP_ID_THAT
```

Restart backend theo quy trình deploy. Không đổi `APP_INVITE_BASE_URL`, Bundle ID hay AASA khi không cần. Link lời mời cũ còn hạn tiếp tục dùng cùng contract; trang sẽ đưa người chưa cài sang Store. TestFlight URL có thể giữ cho tester nhưng public page dùng Store URL. Không đổi sang Store khi chỉ mới “Pending Developer Release” và chưa tải được.

Kiểm tra mở link với app đã cài, chưa cài, user chưa login, user sai email, code đã dùng, code hết hạn, owner đã xóa contact. Khi App Store chưa hoạt động, giữ channel testflight; tuyệt đối không điền một App ID giả.

## 16. Backend deploy và kiểm thử bàn giao

Kiểm tra route public độc lập (không MongoDB, không chạy recording cleanup): chạy `npm run build`, sau đó `node scripts/smoke-app-links.cjs`. Script boot Nest controller thật, kiểm config/AASA/HTML/static assets rồi tự đóng. Thêm `--serve` chỉ khi cần mở trang local để QA; dừng bằng Ctrl+C sau đó.

Deploy phải copy cả `public/` cùng `dist/` và chạy tại project root (sendFile/static dùng cwd). Proxy chuyển `/v1`, `/socket.io`, `/invite`, `/invite-assets/*`, `/.well-known/apple-app-site-association` tới backend. AASA phải là JSON HTTP 200 qua HTTPS, không chuyển hướng/login. Không cache invite page, không ghi body redeem hoặc fragment bằng analytics.

Thực hiện build/test trên môi trường riêng trước deploy. Không boot bản mới với production DB chỉ để smoke test: onModuleInit hiện có migration/index/recording cleanup tác động dữ liệu. Soát duplicate phone/hardware và migration contact cũ, backup, rồi mới deploy có kiểm soát. `SOS_RECORDINGS_DIR` phải trỏ persistent storage riêng.

Read-only checks sau deploy:

```bash
curl -i 'https://heros.nextteam.site/v1/health'
curl -i 'https://heros.nextteam.site/v1/app-config'
curl -i 'https://heros.nextteam.site/.well-known/apple-app-site-association'
curl -I 'https://heros.nextteam.site/invite'
```

QA trong staging với hai người dùng và dữ liệu giả:

- Register/OTP/password/refresh/logout; từ chối role sai và email sai khi redeem.
- Mời trước khi recipient đăng ký; mở link → cài → đăng ký → paste code → accept.
- Redeem hai lần/đồng thời, reissue rồi thử mã cũ, revoke/xóa contact, expired code.
- Map recovery sau kill/reconnect, tọa độ đảo lon/lat, GPS thiếu địa chỉ, nhiều người accept.
- Audio trước accept, sau accept, sau resolve, owner xóa, file expired/mất file, clip quá giới hạn.
- Pin stale, mất mạng, rotate/revoke hardware token; không gọi SOS thật chỉ để test health.
- Push trên máy thật đã khóa, FCM token refresh, từ chối permission/Focus; đo nhận thực chứ không chỉ HTTP 2xx.
- TestFlight và Store universal link trên thiết bị thật; kiểm tra signed application identifier khớp AASA.

Đội iOS cần cung cấp cuối cùng: Bundle ID + App-ID-prefix thật, public TestFlight URL, App Store numeric ID/URL khi có, Firebase/APNs cấu hình đúng app, screenshot/metadata/support/privacy URLs và tài nguyên hardware review. Các giá trị này chưa được tạo trong tài khoản Apple bởi thay đổi backend này.
