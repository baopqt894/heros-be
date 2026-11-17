# HEROS Mobile: chat SOS, phản hồi hỗ trợ và pin thiết bị

API: `https://heros.nextteam.site/v1`. Các request dưới đây dùng JWT của tài khoản mobile trong header `Authorization: Bearer ACCESS_TOKEN`. Đọc dữ liệu từ `data`, đọc mã lỗi từ `data.errorCode`.

Chat và dữ liệu pin dùng API hiện có. Nút **Không thể hỗ trợ** cần backend có route `decline` được triển khai trước khi bật trên mobile. Tài liệu mô tả contract trong checkout backend, chưa xác nhận phiên bản production hoặc code app mobile.

## 1. Hai lựa chọn phản hồi SOS

Khi mở thông báo, dùng `GET /v1/sos/{sosId}` lấy trạng thái. Có thể dùng thêm `GET /v1/sos/incoming/active` để đồng bộ danh sách. Chỉ hiện hai nút cho **người nhận** khi SOS có `status` là `active` hoặc `acknowledged` và cả `viewerAcknowledged` lẫn `viewerDeclined` đều là false. `status: acknowledged` có thể do người khác đã nhận hỗ trợ, vì vậy vẫn phải dựa vào hai field của người đang đăng nhập.

| Nút | Request | Mobile sau khi thành công |
| --- | --- | --- |
| **Hỗ trợ** | `POST /v1/sos/{sosId}/acknowledge`, JSON `{"supportMode":"in_person"}` | Hiện đã nhận hỗ trợ. Dùng `data.chatId` để mở nhóm nếu có. Chế độ `in_person` được tính là có người xác nhận đến ứng cứu cho firmware. |
| **Không thể hỗ trợ** | `POST /v1/sos/{sosId}/decline`, body trống | HTTP 201, `data = { sosId, declinedAt }`. Hiện “Không thể hỗ trợ” và ẩn hai nút. Người này không vào chat, không tăng số người ứng cứu. SOS vẫn tiếp tục cho những người khác. |

- Bản mobile mới bỏ nút **Hỗ trợ từ xa**. Backend vẫn nhận `remote` hoặc request acknowledge thiếu `supportMode` từ app cũ. Khi đọc nhóm, vẫn chấp nhận thành viên có `supportMode: "remote"` hoặc thiếu field. Không gắn nhãn “đang trên đường” cho họ.
- Disable cả hai nút khi đang gửi. Chỉ cập nhật UI khi server xác nhận. Nếu timeout hoặc gặp `409 SOS_ALREADY_ACKNOWLEDGED` / `SOS_ALREADY_DECLINED`, tải lại chi tiết SOS trước khi cho thao tác tiếp. Mỗi người chỉ chọn một trong hai cho cùng SOS. Gửi lại decline trả lại `declinedAt` cũ.
- Lần mở lại màn dùng `viewerAcknowledged` / `viewerDeclined` từ server. Với build backend cũ, field `viewerDeclined` có thể thiếu, nhưng chỉ bật nút decline sau khi xác nhận route mới đã deploy.
- Có thể nghe `sos.declined` để đồng bộ giữa các màn. Payload gồm `sosId`, `userId`, `declinedAt`, gửi cho chủ SOS và người vừa từ chối. Chỉ cập nhật trạng thái của đúng người theo `userId`.
- `403` / `404`: tải lại trạng thái. Nếu SOS đóng hoặc tài khoản mất quyền, ẩn nút và đóng màn chat của người hỗ trợ.

## 2. Chat cần sửa gì trên mobile?

Tối ưu query phía backend không đổi contract chat. Nếu app đã gọi đúng endpoint và đồng bộ socket theo hướng dẫn dưới đây, phần cần sửa chủ yếu là **điều kiện mở chat sau khi phản hồi SOS**. Nếu màn chat còn chờ nhiều request, hiển thị tin nhắn ngay khi trang mới nhất trả về.

1. Chủ SOS mở nhóm bằng `chatId` của SOS. Người nhận chỉ mở sau acknowledge thành công hoặc khi server trả `chatId` hợp lệ. Mỗi SOS có một nhóm, `chatId = sosId`. Decline không tạo hoặc mở nhóm.
2. Mở khung chat ngay và gọi song song `GET /v1/sos-chats/{chatId}` và `GET /v1/sos-chats/{chatId}/messages?limit=30`. Render tin nhắn khi request lịch sử xong. Chi tiết nhóm trả `members`, `canSend`, `currentLocation`, `currentAddress`, `recordings`. Map, avatar và audio tải riêng để tin nhắn hiện trước. Đọc `canSend` trước khi bật ô nhập.
3. Khi cuộn lên, tải tin cũ bằng `beforeSequence=nextBeforeSequence`. Server trả `items` theo `sequence` tăng dần. Gửi text qua `POST /v1/sos-chats/{chatId}/messages` với `{ clientMessageId, text }`. Sinh UUID cho mỗi tin mới, giữ nguyên UUID và text khi retry cùng tin. Ghép tin từ POST/socket theo `message.id`; tin đang gửi có thể đối soát theo `sender.userId` và `clientMessageId`.
4. Dùng một kết nối Socket.IO theo phiên đăng nhập, origin `https://heros.nextteam.site`, namespace `/sos`, path mặc định `/socket.io/`, auth `{ token: accessToken }`. Gắn listener trước khi connect. Backend tự định tuyến theo người dùng nên app không cần gọi join room. Gỡ listener khi rời màn nếu listener được gắn ở màn chat.
5. Nhận `sos.chat.message` để thêm tin, `sos.chat.member_joined` để tải lại thành viên, `sos.location` để cập nhật map và `sos.recording` để thêm clip. Lọc đúng `sosId`. GPS theo thứ tự `[longitude, latitude]`; chỉ áp dụng tọa độ có `recordedAt` mới hơn.
6. Sau `sos.ready` khi reconnect hoặc khi app về foreground, tải lại chi tiết nhóm và bù tin qua `afterSequence=lastSyncedSequence`. Đi tiếp bằng `nextAfterSequence` khi `hasMore=true`. Chỉ tiến mốc đồng bộ theo `lastSequence` sau trang bù cuối; một event socket đến trước không chứng minh các tin trước đó đã về đủ. Không dùng `beforeSequence` và `afterSequence` trong cùng request.
7. Với push `SOS_CHAT_MESSAGE`, dùng `chatId` để tải chi tiết nhóm trước khi mở. Khi nhận `sos.chat.closed`, `sos.resolved`, `sos.cancelled`, hoặc API chat trả lỗi đóng nhóm/mất quyền, khóa ô nhập. Người hỗ trợ thoát nhóm, dừng phát và xóa dữ liệu chat/GPS/audio đã lưu trên máy. Chủ SOS có thể xem lịch sử còn hạn ở chế độ chỉ đọc.

Ghi âm là từng clip. Phát từ `recordings[].playbackPath` bằng JWT, chỉ lấy file khi bấm nghe. Nếu client dùng base URL đã có `/v1`, ghép các path backend trả sẵn như `chatPath`, `messagesPath`, `playbackPath` với **origin** để tránh `/v1/v1/…`.

Xem đầy đủ response và mã lỗi tại [Contract nhóm chat SOS](SOS_GROUP_CHAT_MOBILE_VI.md).

## 3. Hiển thị pin thiết bị HEROS

Sau đăng nhập, gọi `GET /v1/me` và đọc `data.device`. Nếu `device == null`, ẩn phần Thiết bị và pin. Nếu có device, hiển thị phần pin trên màn Thiết bị.

| Field trong `data.device` | Cách hiển thị |
| --- | --- |
| `batteryPercent` | Số nguyên 0–100 hoặc null. Ví dụ `82%`. Giá trị `0` hiện `0%`; null hiện “Chưa cập nhật”. |
| `isCharging` | `true` hiện “Đang sạc”, `false` có thể hiện “Không sạc”, null ẩn trạng thái sạc. |
| `estimatedMinutesRemaining` | Hiện mức ước tính nếu có, đơn vị phút. Ví dụ `2880` phút là “Còn khoảng 2 ngày”. Null thì ẩn. |
| `batteryReportedAt` | Mốc ISO 8601 của lần báo pin gần nhất. Dùng để hiện “Cập nhật … trước”. |
| `lastSeenAt` | Lần backend ghi nhận thiết bị gần nhất. Không dùng thay `batteryReportedAt` hoặc để kết luận thiết bị đang online. |

- Lấy lại profile khi mở màn Thiết bị, app về foreground hoặc kéo để làm mới. Nếu cần tự cập nhật trong màn, có thể poll khoảng 60 giây/lần, chỉ một request tại một thời điểm và dừng khi rời màn hoặc xuống nền. Chưa có socket event riêng cho pin.
- Khi mất mạng, giữ số liệu gần nhất và hiển thị thời điểm cập nhật. Xóa cache khi logout/đổi account. Pin lấy từ firmware qua `PUT /v1/device/status`; mobile chỉ đọc profile và không cần BLE hay hardware token.

Xem response đầy đủ tại [Hướng dẫn hiển thị pin](MOBILE_DEVICE_BATTERY_UPDATE_VI.md).

## Checklist bàn giao mobile

- Dùng một chủ SOS và hai người nhận. Người A bấm **Hỗ trợ** vào cùng nhóm với chủ SOS, thấy tin/GPS và nghe được clip. Người B bấm **Không thể hỗ trợ**, không vào nhóm. Thoát mở lại vẫn thấy đúng lựa chọn của mỗi người.
- Thử app cũ gửi acknowledge với `remote` và thiếu `supportMode`. Kiểm tra bản mới vẫn hiển thị đúng người hỗ trợ cũ.
- Mở chat trên mạng chậm và kiểm tra tin nhắn hiện khi bản đồ/audio còn tải. Thử gửi lại sau timeout và mất socket rồi kết nối lại: không lặp tin, không bỏ sót tin.
- Chủ SOS bấm **Đã an toàn** hoặc thu hồi liên kết: xác nhận người hỗ trợ mất quyền chat/audio, kể cả khi mở lại từ push cũ.
- Firmware báo `82%` rồi `0%`, đổi trạng thái sạc, refresh profile và đối chiếu UI. Kiểm tra thêm thiết bị chưa báo pin và tài khoản có `device: null`.
