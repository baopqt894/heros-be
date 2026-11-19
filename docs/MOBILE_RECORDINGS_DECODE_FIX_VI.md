# Mobile: sửa lỗi decode danh sách bản ghi HEROS

## Triệu chứng và phạm vi xác nhận

Màn “Bản ghi của tôi” báo “API decode failed: The data couldn’t be read because it isn’t in the correct format.”

Model `AudioRecord` đã được đối chiếu với response. App yêu cầu thêm các field bắt buộc và dùng Int cho thời lượng, trong khi API cũ trả thời lượng thập phân. Decoder ngày `APICoding.makeDecoder()` đọc được ISO-8601 có và không có mili giây. Trong lần kiểm tra production ngày 19/11/2026, API danh sách của reviewer owner trả HTTP 200 và `data` là mảng 40 bản ghi. Ba file WAV mới nhất tải và giải mã được, nhưng tín hiệu âm thanh gần như im lặng. Việc sửa decode danh sách và việc sửa dữ liệu thu âm cần kiểm tra riêng theo các bước bên dưới.

## Bản sửa tương thích với AudioRecord đã nhận

Bản sửa bổ sung contract tương thích cho riêng `GET /v1/sos/recordings`:

- Bổ sung `title`, `recordedAt`, `fileURL`, `isEvidence: false` và `isOwnerOnly: true` theo model thư viện bản ghi của chủ tài khoản. Hai cờ boolean là giá trị khởi tạo để app decode, chưa có API lưu thay đổi đánh dấu bằng chứng hoặc cấu hình chia sẻ.
- `durationSeconds` trả số nguyên làm tròn lên để decode vào Int. Giá trị gốc được giữ ở `durationSecondsExact`. Các API upload, chi tiết SOS và chat vẫn trả metadata thời lượng số thập phân.
- `fileURL` là URL tuyệt đối của endpoint playback, vẫn cần Authorization Bearer. Origin lấy từ APP_INVITE_BASE_URL hiện có (mặc định https://heros.nextteam.site) để tránh URL HTTP khi reverse proxy chuyển tiếp nội bộ bằng HTTP. Giữ `playbackPath` và các field metadata cũ.
- `recordedAt` lấy từ `createdAt`; `recordedAt/expiresAt` trả chuỗi ISO-8601 có mili giây. Đã đối chiếu với custom date decoder `APICoding.makeDecoder()` do đội mobile cung cấp.
- Đã chạy build, lint, 8 unit test và chương trình Swift dùng đúng model AudioRecord cùng date decoder APICoding đã nhận để decode JSON tạo từ code backend mới. Tất cả thành công. Cần deploy commit chứa bản sửa này trước khi mobile kiểm tra production.

Mẫu response production dưới đây là bản đã kiểm tra trước thay đổi tương thích AudioRecord.

## 1. API danh sách trả JSON

`GET https://heros.nextteam.site/v1/sos/recordings` dùng `Authorization: Bearer ACCESS_TOKEN`.

Response ví dụ gồm một item thực tế, đã rút gọn số item:

```json
{
  "success": true,
  "code": 200,
  "data": [
    {
      "sosId": "6afe43efbf81a750337de6fb",
      "sosCode": "SOS-4190D2F1",
      "sosStatus": "resolved",
      "startedAt": "2026-11-19T00:33:51.565Z",
      "id": "6afe4443bf81a750337de757",
      "mimeType": "audio/wav",
      "sizeBytes": 178220,
      "durationSeconds": 10.3,
      "createdAt": "2026-11-19T00:35:15.095Z",
      "expiresAt": "2026-12-19T00:35:15.095Z",
      "playbackPath": "/v1/sos/6afe43efbf81a750337de6fb/recordings/6afe4443bf81a750337de757"
    }
  ]
}
```

Kiểm tra các điểm có thể gây decode lỗi:

- `data` là mảng trực tiếp. Decode generic response thành `APIEnvelope<[OwnerRecording]>`.
- `durationSeconds` là `Double`. Các giá trị như `10.3` không decode được vào `Int`.
- ID dùng key `id`. Bản ghi trả `playbackPath` là đường dẫn tương đối. Model yêu cầu `_id`, `url`, `audioUrl` hoặc `fileName` bắt buộc sẽ thiếu key.
- Timestamp ISO 8601 có phần mili giây. Nếu decode trực tiếp thành `Date`, formatter phải đọc được cả dạng có và không có phần thập phân.
- MIME hiện thấy gồm `audio/wav` và `audio/mp4`. Dùng `String` hoặc enum có fallback cho MIME được backend hỗ trợ.
- Danh sách owner có cả `sosStatus: "resolved"` và có thể có `cancelled`, `active`, `acknowledged`. Enum status cần nhận các giá trị này.
- Kiểm tra HTTP status trước khi decode model thành công. Với 401/403/404/5xx, decode error envelope hoặc hiển thị lỗi theo status.

## 2. Model Swift tham khảo

Ví dụ giữ ngày dưới dạng String ở tầng DTO để decoder danh sách không phụ thuộc date strategy. App parse các field này sang Date ở tầng hiển thị và xử lý ngày không đọc được.

```swift
struct APIEnvelope<Payload: Decodable>: Decodable {
    let success: Bool
    let code: Int
    let data: Payload
}

struct RecordingMetadata: Decodable {
    let id: String
    let mimeType: String
    let sizeBytes: Int
    let durationSeconds: Double
    let createdAt: String
    let expiresAt: String
    let playbackPath: String
}

struct OwnerRecording: Decodable {
    let sosId: String
    let sosCode: String
    let sosStatus: String
    let startedAt: String
    let id: String
    let mimeType: String
    let sizeBytes: Int
    let durationSeconds: Double
    let createdAt: String
    let expiresAt: String
    let playbackPath: String
}

// Sau khi kiểm tra HTTP 200:
let response = try JSONDecoder().decode(
    APIEnvelope<[OwnerRecording]>.self,
    from: responseData
)
let recordings = response.data
```

`RecordingMetadata` dùng cho item trong `data.recordings` của chi tiết SOS/nhóm chat và response upload. Các item này chỉ có field metadata, không có bộ field ngữ cảnh `sosId/sosCode/sosStatus/startedAt` của API danh sách owner. Nếu dùng một model chung, các field ngữ cảnh đó phải optional.

## 3. Log field gây lỗi ở mobile

Ở nhánh catch decode, log loại lỗi, đường dẫn field và mô tả. Ví dụ:

```swift
catch let DecodingError.typeMismatch(type, context) {
    print("Decode type mismatch", type,
          context.codingPath.map { $0.stringValue },
          context.debugDescription)
}
catch let DecodingError.keyNotFound(key, context) {
    print("Decode missing key", key.stringValue,
          context.codingPath.map { $0.stringValue })
}
catch let DecodingError.valueNotFound(type, context) {
    print("Decode missing value", type,
          context.codingPath.map { $0.stringValue })
}
catch let DecodingError.dataCorrupted(context) {
    print("Decode corrupted data",
          context.codingPath.map { $0.stringValue },
          context.debugDescription)
}
catch {
    print("Decode failed", String(describing: error))
}
```

Đoạn catch trên gắn vào khối do/catch đang decode response. Log thêm HTTP status, Content-Type và path request để xác định lỗi đến từ API danh sách hay API audio. Giữ token, nội dung ghi âm và dữ liệu riêng tư khỏi log.

## 4. API phát ghi âm trả binary

Khi bấm nghe, ghép `playbackPath` với origin `https://heros.nextteam.site`. Ví dụ đường dẫn đã có `/v1`, cần tránh ghép thành `/v1/v1/...`.

`GET /v1/sos/{sosId}/recordings/{recordingId}` cần JWT trong Authorization header.

- HTTP 200 trả bytes toàn bộ file, Content-Type theo `mimeType`.
- Request có Range hợp lệ có thể nhận 206 và Content-Range.
- URLSession tải dữ liệu audio rồi đưa vào player hoặc file tạm có đuôi đúng định dạng. Không chạy JSONDecoder đối với response audio thành công.
- Với response lỗi, đọc JSON error envelope theo HTTP status trước khi đưa dữ liệu vào player.
- WAV thực tế đã kiểm tra là PCM 16-bit mono 8 kHz. Audio MP4 thường dùng đuôi .m4a. Chọn đuôi file theo MIME, tránh ép mọi audio thành .mp3.
- Khi người hỗ trợ mất quyền hoặc SOS đã đóng, dừng playback và dọn buffer/cache theo contract SOS.

API metadata đang lưu `durationSeconds` do client gửi. Ba WAV đã kiểm tra có thời lượng thực khác field này. Player nên dùng duration đọc từ file sau khi mở thành công để hiển thị tiến trình phát.

## Tối ưu thời gian chờ khi bấm Play

Backend playback chỉ đọc metadata của clip được yêu cầu cùng các field kiểm tra quyền. Với chính chủ, bỏ hai truy vấn kiểm tra liên hệ khẩn cấp vì quyền sở hữu đã xác định từ SOS và JWT. Người hỗ trợ vẫn được kiểm tra liên kết ở mỗi request, kể cả request Range tiếp theo.

Backend truyền file bằng stream và hỗ trợ Range. Hiệu quả về thời gian thực tế cần đo lại sau deploy trên mạng/thiết bị của người dùng.

Mobile cần kiểm tra luồng tải:

- Mở danh sách chỉ tải JSON metadata. Khi bấm Play mới tải clip đã chọn.
- Gộp các lượt bấm cùng clip đang tải vào một request, thay vì tạo nhiều download song song. Hiện trạng thái “Đang tải” và cho phép hủy.
- Hủy request clip trước khi chuyển sang clip khác nếu app không còn dùng kết quả đó.
- Nếu đã có file tạm còn hợp lệ trong phiên mở màn, có thể dùng lại theo quyền hiện tại; khi logout, thu hồi liên kết hoặc SOS đóng đối với người hỗ trợ thì dừng player và dọn dữ liệu.
- Đo riêng thời gian nhận header và thời gian tải xong, log HTTP status, số byte và clip ID. Không log JWT hoặc dữ liệu audio. Nếu header về chậm, rà mạng/server/database. Nếu header nhanh nhưng nhận hết file chậm, rà băng thông, request bị lặp và cách đọc stream ở app.
- WAV đã kiểm tra chỉ khoảng 98–178 KB. Việc nén file thêm cần cân nhắc sau khi xác định bước đang chậm và có bản ghi chứa tiếng mic rõ.

## 5. Checklist test mobile

- API danh sách có data rỗng, một item và nhiều item đều decode được.
- Item có `durationSeconds: 10.3`, MIME WAV/MP4 và timestamp có mili giây decode được.
- Item trong danh sách owner và item trong chi tiết SOS/nhóm dùng đúng model.
- Bấm nghe gửi JWT, URL đúng một lần `/v1`, xử lý audio binary.
- JWT bị thu hồi trả lỗi đăng nhập phù hợp thay vì lỗi decode danh sách.
- File có tín hiệu mic nghe rõ được phát trên iPhone. Ba WAV gần nhất trong lần kiểm tra gần như im lặng, nên cần thêm clip có tiếng để xác nhận chất lượng thu âm.

Tài liệu liên quan: [Chat, phản hồi hỗ trợ và pin](MOBILE_SOS_CHAT_SUPPORT_BATTERY_VI.md).
