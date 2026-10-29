# Ghi âm nhanh và thông báo đã an toàn

Cập nhật 23/10/2026. Backend đã sửa ở local; cần deploy trước khi kiểm thử bản mới trên production. Không cần thay request upload hoặc thêm biến môi trường.

## 1. Backend thay đổi gì

- Upload không đọc lại toàn bộ lịch sử ghi âm khi dò UUID trùng hoặc lưu clip. MongoDB chỉ trả metadata clip cần tìm và owner/recipients/status cần để phân phối.
- Sau khi lưu file và metadata, backend lọc quyền người nhận một lần, bắt đầu push ngay rồi gửi socket cho owner/người nhận đồng thời. Socket lỗi không làm upload đã lưu trả 500.
- Khi resolve/cancel, push bắt đầu trước socket và độc lập với socket. Socket lỗi không chặn thông báo push hay làm thao tác kết thúc đã lưu trả 500.
- `sos.resolved`/`sos.cancelled` giữ tên event, thêm title/message/ownerName/closedAt và resolvedAt/cancelledAt. Owner cũng nhận event kết thúc, ngoài `sos.chat.closed`.
- Playback có auth hỗ trợ HTTP byte range, giúp trình phát tải phần cần phát/seek thay vì tải lại toàn bộ clip.
- FCM dùng notification hiển thị và data, Android high priority/sound, APNs alert priority 10/sound. Tag/collapse của ghi âm khác thông báo an toàn để không ghi đè nhau. Nhiều thông báo ghi âm cùng SOS có thể được gom còn thông báo mới nhất khi ở nền; REST vẫn là nguồn danh sách clip đầy đủ.
- FCM timeout mỗi lần gửi 10 giây; tối đa hai lần khi lỗi mạng hoặc 5xx với backoff ngắn. Lỗi 429 hoặc provider yêu cầu chờ lâu được ghi nhận để theo dõi, không rút ngắn Retry-After rồi retry dồn dập. Lỗi credential/APNs/token không hợp lệ không retry. Retry mạng không có bảo đảm exactly-once; app cần chống hiển thị trùng.
- Log có số token/sent/failed/disabled và mã lỗi FCM đã lọc; không log token, raw audio, GPS hoặc body lỗi upstream. `sent` nghĩa là FCM chấp nhận, không phải điện thoại đã hiển thị.

## 2. App gửi ghi âm

Route giữ nguyên:

```text
POST /v1/sos/:sosId/recordings                Authorization: Bearer accessToken
POST /v1/device/sos/:sosId/recordings         Hardware ID + device token
```

Multipart: `audio` file, `durationSeconds` thời lượng, `clientRecordingId` UUID ổn định cho mỗi clip. Field UUID bắt buộc với hardware, nên gửi cả ở app để retry không trùng.

Phân biệt các trạng thái UI: đang ghi → file đã lưu trên máy → đang upload → server đã nhận (201). Lưu nhanh trên máy không đồng nghĩa người thân đã nhận file. Không đợi người dùng dừng một bản ghi dài 60-120 giây mới bắt đầu upload nếu muốn cập nhật gần realtime.

Khuyến nghị app gửi từng clip hoàn chỉnh khoảng 3-5 giây; dùng AAC/M4A có bitrate phù hợp giọng nói để giảm upload/download. WAV vẫn hỗ trợ nếu phần cứng cần; không đổi đuôi WAV thành M4A. Giới hạn hiện tại: 120 giây/clip, 10 MiB/clip, 600 clip và tổng 100 MiB/SOS. Ghi dài cần chọn chu kỳ clip phù hợp giới hạn 600 clip; ví dụ 5 giây/clip là khoảng 50 phút trước giới hạn số clip. Backend chưa chuyển mã và chưa stream bytes đang ghi/WebRTC.

Tránh chờ file upload xong mới tiếp tục ghi clip tiếp theo. Dùng queue upload có giới hạn, giữ UUID khi retry và dừng queue cũ khi SOS đóng. Không tăng số upload đồng thời quá nhiều trên mạng di động yếu.

## 3. App người thân nhận ghi âm

Kết nối Socket.IO `/sos` bằng `auth: {token: accessToken}`. Chờ `sos.ready`, lấy SOS detail/chat detail để đồng bộ; sau reconnect phải tải lại vì socket không replay toàn bộ sự kiện.

```text
sos.recording
{
  sosId,
  recording: {id, mimeType, sizeBytes, durationSeconds, createdAt, expiresAt, playbackPath}
}
```

Nhận event thì thêm clip vào danh sách ngay theo `recording.id`, không chờ polling hoặc download toàn bộ mới hiện. Dùng `createdAt` để sắp xếp, chống trùng theo ID. Không gửi thêm request GET toàn bộ SOS trước mỗi lần hiển thị nếu metadata đã có trong event. Khi event thiếu sau mất mạng, dùng REST lấy lại danh sách.

Push `SOS_RECORDING_AVAILABLE` có `sosId`, `recordingId`, `createdAt`, `message`. Khi mở app/tap push, tải detail để kiểm tra lại quyền/trạng thái rồi cập nhật clip; không coi push là quyền nghe. Chỉ người đã acknowledge và còn liên kết được nghe, không mở rộng quyền trước acknowledge để làm UI nhanh hơn.

Playback giữ `Authorization: Bearer accessToken` trên mọi request, kể cả Range/seek:

```http
GET /v1/sos/SOS_ID/recordings/RECORDING_ID
Authorization: Bearer ACCESS_TOKEN
Range: bytes=0-65535
```

HTTP 206 có `Accept-Ranges: bytes`, `Content-Range` và `Content-Length` đúng phần trả về. Không gửi Range thì HTTP 200 trả file đầy đủ. Range ngoài file trả 416 với `Content-Range: bytes */TOTAL_BYTES`. Range lỗi định dạng/khác đơn vị hoặc nhiều phần rời nhau được bỏ qua và trả file đầy đủ. Mỗi lần đọc vẫn kiểm tra account, liên kết, acknowledge, SOS active và retention. Người đã bị thu hồi quyền không được đọc từng phần còn lại.

## 4. Thông báo "đã an toàn" khi app đang mở

Xử lý cả hai event kết thúc:

```text
sos.resolved → status=resolved, title, message, ownerName, closedAt, resolvedAt
sos.cancelled → status=cancelled, title, message, ownerName, closedAt, cancelledAt
```

Khi nhận `sos.resolved`, app cần hiển thị banner/hộp thông báo rõ "[Tên] đã xác nhận an toàn", sau đó đóng marker/cảnh báo và khóa truy cập nhóm/audio. Chỉ xóa marker sẽ gây tình huống như ảnh phản hồi: người thân thấy SOS mất đi nhưng không biết người kia đã an toàn.

`sos.chat.closed` chỉ là sự kiện nhóm đóng, không thay thế thông báo an toàn. Chống hiển thị trùng giữa socket/push bằng khóa `sosId + status` (hoặc type tương ứng). Không dùng một cờ đã-thông-báo chung cho mọi loại event của cùng SOS vì như vậy thông báo ghi âm có thể làm mất thông báo an toàn.

Push an toàn có:

```json
{
  "type": "SOS_RESOLVED",
  "sosId": "SOS_ID",
  "status": "resolved",
  "ownerName": "Tên người dùng",
  "message": "Tên người dùng đã xác nhận an toàn.",
  "closedAt": "ISO_8601_UTC"
}
```

## 5. Push khi khóa màn hình hoặc app chạy nền

- Sau mỗi login mobile thành công và mỗi lần FCM token đổi, app gọi `POST /v1/me/devices` với `deviceId`, `platform`, `pushToken`. Đăng ký cũ gắn session trước sẽ không nhận push sau login lại. Đăng ký chỉ một lần khi cài app là chưa đủ.
- iOS phải xin quyền notification và cấu hình APNs trong Firebase; production build cần entitlement/capability đúng. App foreground cần triển khai `UNUserNotificationCenterDelegate.willPresent` và chọn cách hiển thị, hoặc dùng banner trong app theo socket. Backend không ép hệ điều hành hiện banner khi app chưa có handler/quyền.
- Android cần quyền notification phù hợp phiên bản OS, channel có âm thanh/mức quan trọng phù hợp. Payload high priority không tự thay đổi channel mà người dùng đã tắt.
- Khi đã kill app/socket mất, notification hiển thị qua FCM/APNs chứ không dựa vào socket. Khi mở lại, luôn sync REST. Focus/DND, quyền bị tắt, pin/mạng và chính sách OS vẫn ảnh hưởng.
- Không thử đăng nhập bằng API vào account đang test push trên mobile nếu không định đăng nhập lại trên máy: một login mobile mới sẽ thu hồi session cũ. Việc kiểm tra đăng ký push chỉ cần đọc DB, không cần login.

Tham khảo chính thức: [FCM notification/data messages](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type), [FCM APNs configuration](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#ApnsConfig).

## 6. Đo lỗi sau deploy

Log `SOS_RECORDING_READY` có `persistedMs`, `authorizedMs`, `totalMs`, số byte và số người nhận. Thời gian này bắt đầu sau khi Multer đã nhận toàn bộ file; không bao gồm thời gian đang ghi hoặc upload từ điện thoại. App cần đo thêm thời điểm dừng clip, bắt đầu upload, nhận 201, nhận socket và bắt đầu playback để xác định phần chậm.

Log push:

```text
PUSH_DISPATCH type=SOS_RESOLVED users=1 tokens=1 sent=1 failed=0 disabled=false
PUSH_DISPATCH type=SOS_RESOLVED users=1 tokens=0 sent=0 failed=0 disabled=false
FCM_DELIVERY_FAILED type=SOS_RESOLVED FCM_HTTP_404_UNREGISTERED
```

- `tokens=0`: chưa đăng ký push, đã disable, user không active hoặc session của device cũ; đăng nhập app và đăng ký lại.
- `disabled=true`: server thiếu Firebase config.
- `UNREGISTERED`: FCM token hết hiệu lực; app gửi token mới.
- `THIRD_PARTY_AUTH_ERROR`: kiểm tra APNs credential/config trong Firebase.
- `sent=1` nhưng không hiện: kiểm tra permission/foreground delegate/Focus/channel và APNs build thật. Không kết luận mobile nhận chỉ từ API resolve 201.

Kiểm thử tự động đã thêm: Range 206/416 và quyền truy cập, push chạy trước socket chậm, socket lỗi không làm mất push upload/resolve, payload alert iOS/Android và retry FCM. Không phát push thật đến người dùng trong các test này. Cần test hai điện thoại thật sau deploy: app đang mở, chạy nền, khóa màn hình, mất/reconnect mạng, owner resolve và contact bị gỡ.
