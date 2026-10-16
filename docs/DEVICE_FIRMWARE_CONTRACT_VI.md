# Contract firmware HEROS

Cập nhật 14/10/2026. Bản contract dành cho firmware và Postman; điền credential đã được cấp cho hardware của bạn.

Ping không tạo SOS.

**Trạng thái triển khai:** API đọc SOS theo ID và kết thúc bằng device token được bổ sung trong lần thay đổi này. Cần deploy backend mới trước khi dùng các route đó trên domain thật. Tài liệu mô tả contract của code; không khẳng định toàn bộ flow đã test trên phần cứng thật.

## 1. Thiết bị đã gắn sẵn với tài khoản

Mỗi thiết bị đã được gắn với một account owner từ lúc cấu hình ban đầu. Firmware không cần đăng nhập, tạo account hay ghép lại; dùng hardware credential đã cấp để backend xác định owner.

Mỗi hardware credential được cấp cho owner tương ứng:

| Giá trị | Dùng để làm gì |
| --- | --- |
| `hardwareId` | ID cố định của phần cứng đã gắn owner |
| `deviceToken` | Token đã cấp; gửi trong header cho mọi request device |
| `clientRequestId` | UUID mới cho mỗi lần SOS; giữ nguyên khi retry |
| `sosId` | `data.id` của sự cố do backend trả về; lấy tự động qua Postman ở mục 2 |
| `clientRecordingId` | UUID mới cho mỗi clip; giữ nguyên khi retry clip đó |

Không cần JWT/access token cho flow device dưới đây. Không gọi API ghép lại để test: thao tác đó xoay token và làm token hiện tại mất hiệu lực. Firmware lưu credential trong vùng lưu trữ được bảo vệ, không log.

## 2. Header và cách test

Base URL: `https://heros.nextteam.site/v1`.

Tất cả route `/device/...` dưới đây dùng hai header, không cần JWT:

```text
X-Heros-Hardware-Id: YOUR_HARDWARE_ID
X-Heros-Device-Token: YOUR_DEVICE_TOKEN
```

Thay YOUR_HARDWARE_ID và YOUR_DEVICE_TOKEN bằng credential đã cấp. SOS ID và file WAV thay đổi theo mỗi lần test.

Trong Postman, tạo environment:

```text
baseUrl = https://heros.nextteam.site/v1
hardwareId = YOUR_HARDWARE_ID
deviceToken = YOUR_DEVICE_TOKEN
sosId = để trống, Postman tự lưu data.id sau khi tạo/lấy active
```

Điền hardware credential trong header. URL chứa `{{sosId}}` được Postman tự thay bằng environment; không phải một ID mẫu cố định.

Sau khi import request **tạo SOS** hoặc **GET active**, thêm đoạn này vào **Scripts → Post-response** (Postman cũ: tab Tests):

```javascript
const result = pm.response.json();
if (result.success && result.data && result.data.id) {
  pm.environment.set("sosId", result.data.id);
  pm.environment.set("sosStatus", result.data.status);
}
```

Chọn đúng environment ở góc phải Postman. Sau khi Send tạo SOS thành công, request GPS/upload/resolve/cancel tự dùng ID vừa nhận, không cần chép thủ công.

Để dùng UUID và thời gian mới trong request tạo SOS, thêm **Scripts → Pre-request**:

```javascript
if (!pm.environment.get("sosRequestId")) {
  pm.environment.set("sosRequestId", pm.variables.replaceIn("{{$guid}}"));
}
pm.environment.set("gpsRecordedAt", new Date().toISOString());
```

Trong JSON request tạo SOS dùng `"clientRequestId": "{{sosRequestId}}"` và `"recordedAt": "{{gpsRecordedAt}}"`. Retry giữ nguyên `sosRequestId`; khi bắt đầu SOS mới sau khi kết thúc sự cố cũ, xóa biến `sosRequestId` để sinh UUID mới. GPS request dùng `gpsRecordedAt` cập nhật theo fix thật.

File WAV là dữ liệu trên máy bạn: trong Postman vào Body → form-data, chọn file cho field `audio`. Không có đường dẫn WAV cố định dùng được trên mọi máy.

Response giữ ba field `{success, code, data}`. Khi lỗi, đọc `data.errorCode`, `data.message`, `data.details`.

## 3. Khởi động, ping và báo pin

Sau khi có mạng/HTTPS, kiểm tra credential; ping không tạo SOS:

```bash
curl 'https://heros.nextteam.site/v1/device/sos/ping' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN'
```

Thành công: HTTP 200, `data.connected: true`, `data.hardwareId`, `data.serverTime` UTC. Dùng thời gian modem/GPS được đồng bộ cho các request GPS. Không tắt kiểm tra chứng chỉ TLS.

Báo pin khi khởi động và khi pin/trạng thái sạc thay đổi đáng kể:

```bash
curl -X PUT 'https://heros.nextteam.site/v1/device/status' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"batteryPercent":82,"isCharging":false,"estimatedMinutesRemaining":2880}'
```

HTTP 200. Pin là số nguyên 0-100; `isCharging` là boolean. `estimatedMinutesRemaining` là số nguyên không âm tùy chọn, do firmware ước tính; không có số đo đáng tin thì bỏ field này.

## 4. Khôi phục SOS khi bật lại hoặc reconnect

Đọc SOS còn hoạt động của owner:

```bash
curl 'https://heros.nextteam.site/v1/device/sos/active' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN'
```

HTTP 200 với `data: null` nghĩa là chưa có SOS active. Nếu `data` là object, lưu `data.id`; khi `status` là `active` hoặc `acknowledged`, khôi phục Emergency Mode và tiếp tục GPS/clip. `acknowledged` nghĩa là đã có người nhận hỗ trợ, chưa phải đã an toàn. `responderCount` dùng để biết số người đã đồng ý.

Nếu có SOS ID lưu từ trước, đọc trạng thái cuối cùng bằng **route mới**:

```bash
curl 'https://heros.nextteam.site/v1/device/sos/{{sosId}}' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN'
```

HTTP 200 với `data.status` là `active`, `acknowledged`, `resolved` hoặc `cancelled`. Chỉ đọc được SOS của owner thiết bị; kể cả owner có được mời ứng cứu SOS người khác, credential phần cứng cũng không đọc được SOS đó.

Nếu trả `resolved`/`cancelled`, dừng GPS/upload cho sự cố đó và dọn hàng đợi của nó. Không tự tạo SOS mới chỉ vì thiết bị reboot. Nếu 404, kiểm tra active trước khi kết luận SOS đã bị xóa hoặc ID local sai.

## 5. Bấm SOS và lưu ID

Firmware tạo UUID cho một sự cố và lưu xuống persistent storage **trước khi gửi**:

```bash
curl -X POST 'https://heros.nextteam.site/v1/device/sos' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "clientRequestId":"8df6f4a4-3780-4c48-a806-1b718a2e25b7",
    "message":"SOS from HEROS device",
    "location":{
      "latitude":10.762622,
      "longitude":106.660172,
      "accuracy":12,
      "recordedAt":"2026-10-14T08:00:00.000Z"
    }
  }'
```

Cập nhật tọa độ/thời gian thật trước khi gửi; thời gian ví dụ không phải dữ liệu test hiện tại. `message` bắt buộc là chuỗi tối đa 500 ký tự; không gửi `null`. GPS cần số lat/lon/accuracy và ISO 8601 UTC; không gửi field thời gian dạng Unix integer. Không có GPS fix thì firmware giữ trạng thái chờ/retry lấy fix, không tự dựng tọa độ 0,0 hoặc địa chỉ giả; contract hiện chưa có SOS không kèm vị trí.

Thành công HTTP 201: lấy `data.id`, lưu làm SOS ID, chuyển Emergency Mode. Backend lưu SOS và phát thông báo theo danh sách người thân đã thiết lập; firmware không tự tạo danh sách người ứng cứu. Người nhận xác nhận trên app để vào nhóm và nghe audio/xem GPS.

Nếu timeout, gửi lại cùng `clientRequestId`. Request lặp có thể trả SOS đã kết thúc: luôn kiểm tra `data.status`, không chỉ kiểm tra HTTP 201. UUID đã dùng không tái sử dụng cho lần bấm mới.

409 `SOS_ALREADY_ACTIVE`: lấy `/device/sos/active` rồi tiếp tục sự cố hiện tại. Backend giới hạn 5 SOS mới/10 phút/owner, nên không bấm test liên tục bằng UUID mới để retry.

## 6. Gửi vị trí liên tục trong Emergency Mode

```bash
curl -X PUT 'https://heros.nextteam.site/v1/device/sos/{{sosId}}/location' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"latitude":10.763000,"longitude":106.661000,"accuracy":8,"recordedAt":"2026-10-14T08:00:10.000Z"}'
```

HTTP 200. Payload là location trực tiếp, không bọc thêm `location`. `address` là chuỗi tùy chọn nếu firmware có địa chỉ đã xác định; backend không tự reverse-geocode.

Có thể chọn chu kỳ 5-10 giây khi Emergency Mode tùy pin/mạng; đây là đề xuất firmware, không phải tần suất backend bắt buộc. Không gửi request GPS chồng nhau; khi nghẽn giữ fix mới nhất thay vì xếp hàng toàn bộ fix cũ.

Backend chỉ cập nhật fix mới hơn `currentLocation.recordedAt`, bỏ qua GPS cũ/trùng thời gian. Thời gian tương lai hơn server 60 giây bị từ chối. HTTP 200 có thể trả vị trí cũ nếu fix vừa gửi không mới hơn; so sánh `data.currentLocation.recordedAt`.

Backend phát `sos.location` đến owner và người đã acknowledge còn quyền. Firmware hiện dùng HTTP; Socket.IO là kênh realtime cho app, không bắt buộc phần cứng kết nối socket.

## 7. Ghi âm và gửi từng clip WAV

Khi người dùng kích hoạt ghi âm, firmware tạo WAV hoàn chỉnh rồi upload:

```bash
curl -X POST 'https://heros.nextteam.site/v1/device/sos/{{sosId}}/recordings' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN' \
  -F 'audio=@/Users/macmini/Downloads/test.wav;type=audio/wav' \
  -F 'durationSeconds=8.4' \
  -F 'clientRecordingId=3fc65b5c-7f0a-42ec-bd61-70d4a3c8ab53'
```

- `audio`: bytes file WAV thật, MIME `audio/wav`; không gửi đường dẫn file như text hoặc base64 trong JSON.
- `durationSeconds`: thời lượng thực tế, 0,1-120 giây.
- `clientRecordingId`: UUID riêng cho clip, bắt buộc; lưu cùng file để retry sau reboot.
- Tối đa 10 MiB/clip, 600 clip/SOS và tổng 100 MiB/SOS.
- Ví dụ có thể chia clip 5-15 giây để gửi nhanh, tùy khả năng firmware; không phải streaming audio/WebRTC.

HTTP 201 trả metadata recording, gồm `data.id`. Retry cùng clip giữ UUID/file/thời lượng; không dùng UUID của clip khác. Chỉ xóa file trong hàng đợi local sau khi xác nhận upload hoặc khi SOS đã kết thúc theo chính sách lưu local của firmware.

Postman: Body → form-data; `audio` chọn **File**, hai field còn lại chọn **Text**. Không tự đặt `Content-Type` vì client phải tự sinh boundary.

Backend lưu clip và phát `sos.recording`; người thân đã xác nhận ứng cứu nghe qua route playback có JWT/quyền. Device token không phải public download URL. Clip owner được lưu theo retention 30 ngày, quyền người ứng cứu bị đóng khi SOS kết thúc.

## 8. Xác nhận đã an toàn từ thiết bị

**Route mới, cần deploy backend mới.** Khi người dùng chủ động xác nhận đã an toàn:

```bash
curl -X POST 'https://heros.nextteam.site/v1/device/sos/{{sosId}}/resolve' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN'
```

Không cần body/JWT. HTTP 201, `data.status: "resolved"`, có `data.resolvedAt`.

Backend kết thúc SOS, phát `sos.resolved`, đóng nhóm qua `sos.chat.closed` (`reason=resolved`) và gửi push `SOS_RESOLVED`, tiêu đề "Người dùng đã an toàn" đến người nhận còn quyền. FCM phải được cấu hình và điện thoại phải có push token hợp lệ; HTTP thành công không phải bằng chứng điện thoại đã nhận thông báo.

Firmware dừng GPS/ghi âm/upload của SOS này, xóa SOS ID đang active và trở về trạng thái bình thường **sau khi backend xác nhận trạng thái cuối**. Không tự xác nhận an toàn khi hết pin, mất mạng hoặc thấy có người acknowledge.

Nếu response bị mất: đọc `GET /device/sos/{{sosId}}`. Nếu đã `resolved`, coi thao tác thành công; nếu còn active, retry resolve. Route kết thúc hiện không idempotent: lần gọi lại sau khi đã kết thúc trả 404, nên đọc trạng thái để đối soát. Nếu đã `cancelled`, giữ nguyên trạng thái đó, không chuyển lại thành resolved.

App vẫn có `POST /v1/sos/{{sosId}}/resolve` bằng JWT owner; app và firmware cùng kết thúc một SOS. Mỗi sự cố chỉ chấp nhận lần kết thúc đầu tiên.

## 9. Hủy cảnh báo khi bấm nhầm hoặc kết thúc test

**Route mới, cần deploy backend mới.** Dùng hủy thay cho resolve khi bấm nhầm/test:

```bash
curl -X POST 'https://heros.nextteam.site/v1/device/sos/{{sosId}}/cancel' \
  -H 'X-Heros-Hardware-Id: YOUR_HARDWARE_ID' \
  -H 'X-Heros-Device-Token: YOUR_DEVICE_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Ket thuc test thiet bi"}'
```

`reason` tùy chọn, tối đa 200 ký tự. HTTP 201, `data.status: "cancelled"`, có `data.cancelledAt`. Backend phát `sos.cancelled`, đóng nhóm và gửi push `SOS_CANCELLED`.

**Chọn resolve hoặc cancel, không gọi cả hai cho cùng SOS.** Không nhận thêm GPS hoặc clip mới sau khi kết thúc. Retry clip đã lưu với UUID cũ có thể vẫn trả metadata cũ; không coi đó là SOS còn hoạt động. Hủy/resolve không xóa ngay file ghi âm owner.

## 10. State machine, retry và modem AT

| Trạng thái firmware | Hành động |
| --- | --- |
| Boot/connecting | Kết nối mạng/HTTPS, ping, báo pin, đối soát SOS đã lưu và active |
| Idle | Chờ thao tác người dùng; không tự tạo SOS |
| SOS pending | Lưu UUID; lấy GPS fix; gửi SOS; retry cùng UUID khi timeout |
| Emergency | Giữ SOS ID; gửi GPS, clip theo yêu cầu; có thể đọc detail để biết responder/status |
| Finish pending | Lưu ý định resolve/cancel cùng SOS ID; gửi kết thúc; mất response thì đọc detail |
| Closed | Dừng hàng đợi của SOS cũ; không tự phát cảnh báo mới |
| Credential invalid | Ngừng retry dồn dập; báo lỗi kết nối/ghép qua cơ chế firmware đã thống nhất |

Khi mất mạng, giữ SOS ID, UUID request/clip và ý định kết thúc trong persistent storage. Retry với backoff, ví dụ 1/2/4/8/16/30 giây và jitter; không tạo UUID mới chỉ vì timeout. Giới hạn dung lượng queue local. Sau reconnect, đọc trạng thái trước khi đẩy queue cũ. Nếu GPS gặp 404, dừng gửi cho ID đó và đối soát; đừng chỉ tăng tốc retry.

Backend chưa quy định bấm ngắn/bấm giữ/bấm đôi hay màu LED. Firmware/app phải thống nhất thao tác riêng; tài liệu này không gán thao tác nút hoặc màu đèn giả định. Người dùng phải chủ động xác nhận hành động kết thúc để tránh vô tình tắt SOS.

JSON qua modem: cấu hình `Content-Type: application/json`; `AT+HTTPDATA` dùng đúng số byte UTF-8 body. WAV upload cần `multipart/form-data; boundary=...`; byte body gồm cả header các part, CRLF, bytes WAV và boundary cuối. Không gửi nguyên câu lệnh cURL lên modem. `+HTTPACTION: 1,400,...` là HTTP 400 từ API, không phải tự động lỗi modem; đọc toàn bộ response theo chiều dài thực tế.

## 11. Xử lý lỗi và checklist test

| HTTP/lỗi | Xử lý |
| --- | --- |
| 401 `DEVICE_CREDENTIAL_INVALID` | Kiểm tra hai header, token hiện tại, revoke và trạng thái owner; không thay bằng JWT |
| 400 `VALIDATION_ERROR` | Đọc `data.details`; kiểm tra UUID, message, kiểu GPS, thời gian, duration |
| 400 `LOCATION_TIME_INVALID` | Đồng bộ UTC modem/GPS; không gửi fix tương lai |
| 409 `SOS_ALREADY_ACTIVE` | GET active, lấy ID thật và tiếp tục |
| 404 khi đọc SOS | ID sai/không thuộc owner/đã xóa; không dùng mã SOS thay ID |
| 404 khi resolve/cancel/GPS/clip mới | Đọc detail để biết đã closed chưa; không tái tạo SOS tự động |
| 413 khi upload | File quá lớn; chia clip nhỏ hơn |
| 429 `SOS_RATE_LIMITED` | Giới hạn tạo mới; giữ UUID khi retry, chờ theo chính sách server |
| 5xx/timeout | Backoff; create/upload giữ UUID, finish đối soát detail |

Test riêng từng tình huống:

1. Ping không tạo SOS; báo pin cập nhật được trên app owner.
2. Tạo SOS → GET active trả đúng ID; retry UUID không phát sinh SOS thứ hai.
3. Gửi GPS mới/cũ: app nhận vị trí mới, fix cũ không ghi đè.
4. WAV upload → retry cùng clip không nhân đôi; người chưa acknowledge không nghe được.
5. Device resolve → app đóng cảnh báo/nhóm, người thân nhận thông báo an toàn; detail trả resolved.
6. Tạo SOS khác rồi device cancel → detail trả cancelled; không đổi lại thành resolved.
7. Mất mạng/reboot trước/sau mỗi bước: khôi phục ID/UUID và đúng trạng thái, không tự tạo SOS mới.
8. Token sai/revoke hoặc SOS owner khác: bị chặn; kết thúc rồi không nhận GPS/clip mới.

Test backend tự động dùng MongoDB tạm, Socket.IO local và mock FCM; test firmware/HTTPS/modem và độ trễ thông báo trên điện thoại thật cần thực hiện sau deploy. Không cần `.env` mới cho các route device vừa bổ sung.
