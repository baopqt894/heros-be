# Tích hợp nhóm chat ứng cứu SOS trên mobile

Cập nhật: 05/10/2026. Tài liệu này mô tả code backend trong bản bổ sung nhóm chat; cần deploy bản tương ứng trước khi gọi trên production.

## 1. Quy tắc nhóm

- Mỗi SOS có đúng một nhóm logic, `chatId = sosId`. Không cần gọi API tạo nhóm hay gửi lời mời chat riêng.
- Chủ SOS là thành viên từ khi tạo SOS. Nhóm ban đầu chỉ có chủ SOS.
- Người thân phải có liên kết `accepted`, nằm trong danh sách nhận SOS đó, rồi gọi `POST /sos/{sosId}/acknowledge`. Chỉ lúc này mới được thêm vào nhóm. Cả hỗ trợ `in_person` và `remote` đều vào cùng nhóm.
- Tất cả người đã xác nhận hỗ trợ cùng chat với chủ SOS, nghe clip của chủ SOS và xem vị trí của chủ SOS. Không chia thành các cuộc chat riêng.
- Người nhận thông báo nhưng chưa acknowledge không được đọc lịch sử nhóm, gửi tin hoặc nghe ghi âm. Người ngoài không được vào nhóm bằng cách biết chatId.
- Khi unlink/xóa người thân: quyền nhóm và các lần phát realtime tiếp theo bị thu hồi. Thêm contact mới không khôi phục quyền trên SOS cũ đã gắn contactId cũ. Nội dung đã nhận trước khi thu hồi không thể bị backend lấy lại; mobile phải dọn cache.
- Khi chủ SOS xác nhận an toàn hoặc hủy SOS: nhóm chuyển `closed`, không ai gửi thêm tin. Người hỗ trợ mất quyền xem nhóm/lịch sử/audio/GPS trong nhóm. Chủ SOS vẫn xem được lịch sử tin chưa hết hạn, chỉ đọc.
- Tin nhắn text giữ tối đa 30 ngày từ lúc gửi. Audio vẫn theo chính sách 30 ngày hiện có. API ẩn dữ liệu hết hạn ngay; cleanup vật lý chạy mỗi 6 giờ và retry nếu lỗi. Chính sách backup cần vận hành quản lý riêng.
- MVP chỉ nhắn text. Chưa có gửi ảnh/file trong chat, typing indicator, read receipt, sửa/xóa từng tin, gọi thoại, hoặc lời mời người ngoài Emergency Network.

## 2. Kết nối và xác thực

API base sau deploy: `https://heros.nextteam.site/v1`.

Mọi API chat cần:

```http
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

Không dùng `X-Heros-Device-Token` để chat. Hardware tiếp tục gửi SOS/GPS/audio bằng API device cũ; mobile dùng JWT account.

Envelope JSON giữ nguyên:

```json
{
  "success": true,
  "code": 200,
  "data": {}
}
```

POST gửi tin trả 201, kể cả retry trả lại tin đã lưu. Lỗi có `success: false`, `code` là HTTP status, `data.errorCode` và `data.message`.

## 3. Flow mobile

1. Login, lưu token an toàn; đăng ký lại FCM bằng `POST /me/devices` với `deviceId` trùng login.
2. Kết nối Socket.IO namespace `/sos`, đăng ký listeners trước khi connect. Đợi `sos.ready` rồi tải danh sách nhóm và dữ liệu nhóm đang mở.
3. Chủ SOS tạo SOS trên app/device như trước. Response SOS thêm `chatId` và `chatPath`, dùng để mở màn nhóm.
4. Người nhận mở thông báo SOS: chưa hiển thị chat trước acknowledge. Bấm “Tôi sẵn sàng ứng cứu” gọi API acknowledge; thành công lấy `data.chatId` để mở nhóm.
5. Gọi chi tiết nhóm để lấy thành viên, GPS, recordings, `canSend`; gọi lịch sử tin nhắn riêng.
6. Gửi text bằng REST, nhận tin mới qua Socket.IO. Thêm tin optimistic với UUID và reconcile theo response/event để tránh lặp.
7. Khi nhận vị trí/recording mới, cập nhật phần bản đồ/audio trong nhóm theo `sosId`; không nhúng file âm thanh vào tin text.
8. Reconnect hoặc trở về foreground: refetch nhóm và lấy tin sau sequence đã đồng bộ. REST là nguồn dữ liệu chuẩn vì socket/push có thể mất sự kiện.
9. Khi nhận `sos.chat.closed`, `sos.resolved`, `sos.cancelled`, hoặc HTTP 403/404 vì mất quyền: khóa composer. Với người hỗ trợ, đóng nhóm, dừng playback và xóa cache tin/audio/vị trí. Chủ SOS có thể mở lại nhóm read-only.

Không có API/socket event để client tự `join` một room tùy ý. Backend tự định tuyến qua room cá nhân đã xác thực. Không gửi `senderId`, `ownerId` hoặc `memberIds` trong request gửi tin.

## 4. API thêm người vào nhóm

Giữ nguyên API:

```http
POST /v1/sos/SOS_ID/acknowledge
```

```json
{ "supportMode": "in_person" }
```

`supportMode` optional, nhận `in_person` hoặc `remote`. Response SOS có thêm:

```json
{
  "chatId": "SOS_ID",
  "chatPath": "/v1/sos-chats/SOS_ID",
  "viewerAcknowledged": true
}
```

Hai field chat cũng có trong response create/get SOS đối với người có quyền. Trước acknowledge, người hỗ trợ nhận `chatId: null`, `chatPath: null`. Gọi acknowledge lại không thêm thành viên trùng.

## 5. Danh sách nhóm

```http
GET /v1/sos-chats?status=active&limit=20
GET /v1/sos-chats?status=active&limit=20&before=CURSOR
GET /v1/sos-chats?status=closed&limit=20
```

- `status`: `active` mặc định, hoặc `closed`. Nhóm closed chỉ trả cho chủ SOS.
- `limit`: 1..50, mặc định 20.
- `before`: ObjectId từ `nextCursor`. Danh sách sắp nhóm mới trước theo ID, không phải thứ tự tin nhắn mới nhất.
- `data = { items: [...], nextCursor: "..." | null }`.
- Mỗi item có `id`, `sosId`, `sosCode`, `title`, `ownerId`, `ownerName`, `ownerAvatarUrl?`, `status`, `sosStatus`, `memberCount`, `createdAt`, `closedAt`, `lastMessageSequence`.
- `memberCount` gồm cả owner; khác `responderCount` của SOS, vốn chỉ đếm người hỗ trợ.
- Backend lọc lại các liên kết đã bị thu hồi sau khi lấy candidates. Vì vậy trang có thể ít hơn limit, thậm chí rỗng nhưng vẫn có `nextCursor`; tiếp tục theo cursor tới khi null.

## 6. Chi tiết nhóm

```http
GET /v1/sos-chats/SOS_ID
```

`data` gồm các field summary ở trên và:

```json
{
  "id": "SOS_ID",
  "sosId": "SOS_ID",
  "status": "active",
  "sosStatus": "acknowledged",
  "canSend": true,
  "memberCount": 2,
  "members": [
    { "userId": "OWNER_ID", "role": "owner", "name": "Người cần cứu", "joinedAt": "2026-10-05T08:00:00.000Z" },
    { "userId": "CONTACT_ID", "role": "responder", "name": "Người hỗ trợ", "joinedAt": "2026-10-05T08:01:00.000Z", "supportMode": "in_person" }
  ],
  "currentLocation": {
    "type": "Point",
    "coordinates": [106.660172, 10.762622],
    "accuracy": 5,
    "recordedAt": "2026-10-05T08:01:15.000Z",
    "address": "Địa chỉ hiện tại"
  },
  "currentAddress": "Địa chỉ hiện tại",
  "recordings": [],
  "messagesPath": "/v1/sos-chats/SOS_ID/messages"
}
```

Thành viên có `avatarUrl` khi đã có ảnh; field optional có thể bị omit. API không trả email/SĐT contact cho cả nhóm. `coordinates` theo GeoJSON: **longitude trước, latitude sau**. `currentAddress`/`address` có thể thiếu; hiển thị tọa độ hoặc reverse-geocode phía mobile.

`recordings` dùng metadata hiện có: `id`, `mimeType`, `sizeBytes`, `durationSeconds`, `createdAt`, `expiresAt`, `playbackPath`.

## 7. Gửi tin text

```http
POST /v1/sos-chats/SOS_ID/messages
```

```json
{
  "clientMessageId": "9f332971-b271-49d4-846c-47ef4a2e6208",
  "text": "Tôi đang đến. Bạn đứng ở gần cổng nào?"
}
```

- UUID mới cho mỗi tin mới; retry cùng một tin phải giữ nguyên UUID và nội dung đã trim.
- Text trim đầu/cuối, dài 1..2000 ký tự; không nhận tin chỉ chứa khoảng trắng. Render plain text, không chạy HTML/Markdown từ message.
- Server tự lấy sender từ JWT, tự sinh ID/thời gian/sequence; không chấp nhận field sender tự khai.
- Tối đa 30 tin mới/phút/người/nhóm, 1000 tin còn lưu trong mỗi nhóm. Rate limit và append là atomic trên MongoDB, áp dụng cả khi backend chạy nhiều instance. Tin đã hết hạn vẫn chiếm quota lưu trữ tới khi cleanup.
- Cùng UUID + cùng sender + cùng nhóm trả lại tin cũ, không phát socket/push lần hai. UUID cũ nhưng nội dung khác trả 409.

Response `data` và payload message realtime có cùng shape:

```json
{
  "id": "MESSAGE_OBJECT_ID",
  "chatId": "SOS_ID",
  "sosId": "SOS_ID",
  "clientMessageId": "9f332971-b271-49d4-846c-47ef4a2e6208",
  "sequence": 1,
  "sender": { "userId": "CONTACT_ID", "name": "Người hỗ trợ", "avatarUrl": "https://storages.limgrow.com/uploads/..." },
  "type": "text",
  "text": "Tôi đang đến. Bạn đứng ở gần cổng nào?",
  "createdAt": "2026-10-05T08:02:00.000Z",
  "expiresAt": "2026-11-04T08:02:00.000Z"
}
```

Sender name/avatar được lấy từ profile khi đọc, không phải snapshot bất biến tại thời điểm gửi. Khi account bị xóa, backend dọn các tin do account đó gửi trong những nhóm khác; sequence có thể có khoảng trống, không tự sửa hoặc đánh lại số trên app.

## 8. Lịch sử và lấy tin bị lỡ

```http
GET /v1/sos-chats/SOS_ID/messages?limit=50
GET /v1/sos-chats/SOS_ID/messages?beforeSequence=101&limit=50
GET /v1/sos-chats/SOS_ID/messages?afterSequence=100&limit=50
```

- Mặc định lấy 50 tin mới nhất; limit 1..100. Mọi trang trả `items` theo sequence tăng dần, thuận tiện render từ cũ đến mới.
- `beforeSequence` exclusive, dùng tải lịch sử cũ; `afterSequence` exclusive, dùng catch-up sau mất mạng. Không dùng cả hai trong cùng request.
- `afterSequence=0` dùng đọc từ đầu lịch sử còn lưu.

```json
{
  "items": [],
  "hasMore": false,
  "nextBeforeSequence": null,
  "nextAfterSequence": null,
  "lastSequence": 100
}
```

Trang cũ dùng `nextBeforeSequence`; catch-up dùng `nextAfterSequence`. Khi `hasMore=true`, tiếp tục đúng cursor đó. `lastSequence` là số thứ tự cao nhất đã được cấp trên nhóm tại lúc đọc, có thể lớn hơn sequence trong trang đang xem do phân trang, hết hạn hoặc xóa account.

Quy tắc đồng bộ:

1. Duy trì `lastSyncedSequence` riêng từng nhóm và từng account. Không cập nhật watermark chỉ vì nhận được một event socket có sequence lớn, vì event trước đó có thể bị mất hoặc tới trễ.
2. Khi reconnect, đăng ký listener và buffer event mới, đợi `sos.ready`, gọi `afterSequence=lastSyncedSequence` rồi đọc hết các trang.
3. Chỉ sau khi đọc hết catch-up mới nâng watermark theo `lastSequence` của trang cuối. Merge các event đang buffer bằng message ID; nếu event lớn hơn watermark, thực hiện thêm catch-up khi cần.
4. Dedupe theo `message.id`; reconcile tin optimistic theo cặp `sender.userId + clientMessageId`. Event có thể tới trước response POST.
5. Nếu chỉ tải trang latest để vào màn hình, những tin cũ ngoài trang vẫn lấy bằng `beforeSequence`; không đánh đồng với tin bị mất do reconnect.

Sequence và message được ghi cùng một thao tác atomic; không có trường hợp message sequence thấp được commit sau khi server đã cấp và commit sequence cao hơn. Các số bị xóa/expire là khoảng trống hợp lệ.

## 9. Socket.IO và push

Origin: `https://heros.nextteam.site`; namespace: `/sos`; transport path mặc định `/socket.io/`. Không nối `/v1` vào origin socket. Đây là Socket.IO, không phải raw WebSocket.

Handshake authentication payload:

```json
{ "token": "ACCESS_TOKEN" }
```

Với client Socket.IO hỗ trợ `auth`, cấu hình `auth: { token: accessToken }`. Client mobile cần gửi object này trong namespace CONNECT payload, không chỉ thêm query parameter hoặc HTTP Authorization. Refresh JWT xong hãy disconnect và reconnect với token mới.

| Event | Payload | Mobile xử lý |
| --- | --- | --- |
| `sos.ready` | `{userId}` | Socket đã vào room cá nhân; bắt đầu refetch/catch-up |
| `sos.chat.member_joined` | `{chatId,sosId,userId,joinedAt}` | Chủ SOS/người đã vào nhóm refetch chi tiết để cập nhật member list |
| `sos.chat.message` | `{chatId,sosId,message}` | Merge tin theo id/sequence, bỏ event của nhóm đã đóng/mất quyền |
| `sos.chat.closed` | `{chatId,sosId,status:"closed",reason:"resolved" hoặc "cancelled",closedAt}` | Khóa composer, đóng/dọn nhóm với người hỗ trợ |
| `sos.location` | `{sosId,location}` | Cập nhật bản đồ chủ SOS; chỉ nhận fix có recordedAt mới hơn |
| `sos.recording` | `{sosId,recording}` | Thêm metadata clip, hiển thị nút nghe |

Giữ listeners `sos.created`, `sos.acknowledged`, `sos.resolved`, `sos.cancelled` cho luồng SOS hiện tại. `sos.location`/`sos.recording` nay gửi cả cho owner để owner thấy telemetry từ device.

Mỗi lần phát chat message, backend kiểm tra lại SOS còn active, thành viên còn quyền và socket còn session hợp lệ. Không có broadcast vào room công khai theo SOS ID. HTTP/socket/push dùng cùng active login; session cũ bị chặn. Nếu nhiều backend instance, Socket.IO cần shared adapter hoặc sticky/single-instance realtime; REST catch-up vẫn dùng MongoDB chung. Bản này không thêm Redis adapter.

Push tin mới gửi cho thành viên khác sender, nội dung màn hình khóa chỉ là “Có tin nhắn mới trong nhóm hỗ trợ SOS”, không chứa text/GPS/audio. Data:

```json
{
  "type": "SOS_CHAT_MESSAGE",
  "chatId": "SOS_ID",
  "sosId": "SOS_ID",
  "messageId": "MESSAGE_ID",
  "message": "Có tin nhắn mới trong nhóm hỗ trợ SOS"
}
```

Khi bấm push, kiểm tra quyền qua GET nhóm rồi mới mở. Push có thể tới trễ sau khi nhóm đã đóng; không tin push là bằng chứng còn quyền.
Socket/push là best-effort, không có delivery/read acknowledgement. Khi app foreground, refetch định kỳ khoảng 10-15 giây nếu cần phát hiện unlink/đổi thành viên trong lúc không có event; không có event `member_removed` riêng trong bản này. Khi account bị xóa cũng có thể chỉ nhận 403/404 ở lần fetch kế tiếp.

## 10. Audio và GPS trong màn nhóm

- Giữ map nhỏ hoặc sheet vị trí chủ SOS, cập nhật từ `currentLocation` và `sos.location`. Các thành viên không chia sẻ vị trí của mình qua nhóm này.
- Phát audio bằng GET `playbackPath`, gửi bearer. Không dùng Limgrow/public URL cho recording. Avatar có thể là URL Limgrow công khai, còn audio SOS vẫn được bảo vệ.
- Người hỗ trợ chỉ nghe khi SOS active, đã acknowledge và còn liên kết accepted. Safe/cancel/unlink sẽ chặn các request playback tiếp theo.
- Device/audio upload vẫn là từng clip hoàn chỉnh; `sos.recording` báo có clip mới, không phải livestream WebRTC.
- Không thêm nút tải/lưu vào máy cho người hỗ trợ. Không cache âm thanh lâu dài; dừng player và xóa buffer khi mất quyền. Backend không thể bảo đảm tuyệt đối ngăn ghi âm lại hoặc screen recording trên client; mobile phải xử lý theo khả năng OS và không hứa bảo vệ tuyệt đối.

## 11. Lỗi cần xử lý

| HTTP / errorCode | Hành động |
| --- | --- |
| 401 / `SESSION_REVOKED` hoặc token hết hạn | Thử refresh hợp lệ hoặc login lại; đóng socket/token cũ |
| 403 / `SOS_CHAT_ACKNOWLEDGEMENT_REQUIRED` | Hiện hành động xác nhận hỗ trợ trước khi vào nhóm |
| 403 / `SOS_ACCESS_REVOKED`, `SOS_CHAT_ACCESS_REVOKED` | Đóng/dọn dữ liệu nhóm, không retry gửi |
| 403 hoặc 409 / `SOS_CHAT_CLOSED` | Nhóm đã kết thúc; chủ SOS chỉ đọc, người hỗ trợ thoát nhóm |
| 404 | Nhóm không tồn tại, không có quyền, hoặc dữ liệu đã xóa; refetch danh sách |
| 400 / validation hoặc `CHAT_CURSOR_CONFLICT` | Sửa payload/query; không gửi field ngoài contract |
| 409 / `CHAT_CLIENT_MESSAGE_ID_REUSED` | UUID đã dùng với text khác; tin mới phải dùng UUID mới |
| 409 / `CHAT_MESSAGE_EXPIRED` | Không retry tin đã hết retention |
| 409 / `SOS_CHAT_MESSAGE_LIMIT_REACHED` | Nhóm đã đạt 1000 tin còn lưu, khóa gửi và thông báo phù hợp |
| 429 / `SOS_CHAT_RATE_LIMITED` | Chờ theo `retryAfterSeconds`, tối đa gợi ý 60 giây |
| Network / 5xx | Backoff; retry giữ clientMessageId và text cũ, rồi đối soát REST |

## 12. cURL

```bash
# Sau acknowledge, dùng cùng SOS_ID cho mọi thành viên.
curl 'https://heros.nextteam.site/v1/sos-chats/SOS_ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'

curl --request POST 'https://heros.nextteam.site/v1/sos-chats/SOS_ID/messages' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"clientMessageId":"9f332971-b271-49d4-846c-47ef4a2e6208","text":"Tôi đang đến hỗ trợ."}'

curl 'https://heros.nextteam.site/v1/sos-chats/SOS_ID/messages?afterSequence=0&limit=50' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

## 13. Checklist tích hợp và triển khai

- Hai hoặc nhiều người thân cùng acknowledge: cùng chatId, cùng danh sách thành viên; `remote` không bị ghi nhãn “đang trên đường”.
- Chủ SOS và người hỗ trợ đều gửi/nhận được tin; người chưa acknowledge/người ngoài bị chặn.
- Test retry, gửi đồng thời, tin optimistic, text tiếng Việt/emoji, text bắt đầu `$`, text rỗng/quá dài, mất mạng/kill app/reconnect.
- Test audio từ phần cứng và GPS vào màn nhóm của cả owner lẫn người hỗ trợ.
- Test unlink khi đang mở nhóm, đổi điện thoại đăng nhập, JWT hết hạn, safe/cancel, push tới trễ, xóa account; không còn dữ liệu nhạy cảm trên màn/cache sau mất quyền.
- Không cần biến `.env` mới cho chat. MongoDB lưu tin, cấu hình JWT/FCM/socket hiện có tiếp tục dùng. `sos_events` thêm `chatSequence`, `chatMessages` và indexes; dữ liệu cũ không cần backfill nhóm.
- Tin được nhúng có giới hạn trong SOS để append/sequence/status là atomic, không cần replica-set transaction cho chat. Trường chatMessages bị loại khỏi các query SOS thông thường; không trả kèm text trong response GPS/SOS chung.
- Backend test tích hợp chạy trên MongoDB tạm + Socket.IO localhost, không gọi FCM thật. Cần test mobile/background/push và cấu hình proxy ở staging sau deploy; test local không chứng minh production đã chạy bản này.

Tài liệu liên quan: [Tích hợp app và phát hành iOS](IOS_APP_INTEGRATION_AND_RELEASE_VI.md), [Các API account/device/storage](BACKEND_API_COMPLETION_VI.md).
