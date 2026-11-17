# Mobile: hiển thị pin thiết bị HEROS

## Phạm vi

Backend đã có dữ liệu pin trong `GET /v1/me`. Mobile chỉ đọc dữ liệu để hiển thị,
không phải kết nối Bluetooth và không cần giữ device token của phần cứng.
Đây là pin HEROS, không phải pin điện thoại.

Luồng dữ liệu:

```text
Firmware báo pin → PUT /v1/device/status
Backend lưu pin → Mobile gọi GET /v1/me → Hiển thị data.device
```

## API dành cho mobile

```bash
curl 'https://heros.nextteam.site/v1/me' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

Response ví dụ rút gọn, các trường profile cũ vẫn giữ nguyên:

```json
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "ACCOUNT_ID",
    "device": {
      "id": "HARDWARE_DOCUMENT_ID",
      "hardwareId": "HEROS-DEVICE-001",
      "label": null,
      "enabled": true,
      "batteryPercent": 82,
      "isCharging": false,
      "estimatedMinutesRemaining": 2880,
      "batteryReportedAt": "2026-11-12T03:00:00.000Z",
      "lastSeenAt": "2026-11-12T03:00:00.000Z"
    }
  }
}
```

Không hardcode các giá trị minh họa vào app.

| Trường trong `data.device` | Kiểu | Mobile hiển thị |
| --- | --- | --- |
| `batteryPercent` | số nguyên 0–100 hoặc null | Phần trăm pin, ví dụ `82%` |
| `isCharging` | boolean hoặc null | `true`: đang sạc; `false`: không sạc; null: chưa có dữ liệu |
| `estimatedMinutesRemaining` | số nguyên không âm hoặc null | Thời gian còn lại ước tính, đơn vị phút |
| `batteryReportedAt` | thời gian ISO 8601 hoặc null | Lần backend nhận báo pin gần nhất |
| `lastSeenAt` | thời gian ISO 8601 hoặc null | Lần ghi nhận thiết bị gần nhất, không dùng thay thời gian báo pin |

## Mobile cần sửa

1. Thêm các field nullable ở trên vào model `device` trong profile.
2. Có `data.device` thì hiện phần thiết bị và pin. `device == null` thì ẩn phần thiết bị.
3. Dùng icon pin kèm phần trăm; khi `isCharging == true` thêm trạng thái sạc.
4. Pin `null`: hiện “Chưa cập nhật”, không đổi thành `0%`. Pin bằng 0 vẫn phải hiện `0%`.
5. Thời gian còn lại chỉ là ước tính từ firmware, không được tính ra một giờ hết pin chắc chắn.
6. Hiển thị thời điểm cập nhật pin để người dùng biết nếu số liệu đã cũ.

Gợi ý giao diện: `Pin 82% · Không sạc`, dòng phụ `Cập nhật 2 phút trước`.
Có thể dùng màu cảnh báo khi pin ≤20%, nhưng đây là quy tắc UI đề xuất,
không phải cơ chế backend tự gửi thông báo pin yếu.

Với `estimatedMinutesRemaining`, có thể quy đổi phút thành ngày/giờ/phút.
Ví dụ 2880 phút là khoảng 2 ngày. Nếu null thì ẩn dòng ước tính.
Backend có thể giữ ước tính trước đó nếu lần báo pin sau firmware không gửi trường này;
không coi đây là phép đo mới hoặc tự chạy bộ đếm hết pin.

## Khi nào tải lại

- Sau login: gọi GET `/me`, không chỉ dùng object `user` của response login.
- Khi mở màn Thiết bị, app quay lại foreground hoặc người dùng kéo refresh.
- Nếu muốn cập nhật khi đang xem màn Thiết bị, có thể poll khoảng 60 giây/lần,
  chỉ một request tại một thời điểm, dừng khi rời màn hoặc app xuống nền.
- Hiện chưa có socket event riêng thông báo thay đổi pin. Poll profile nhanh hơn
  không làm firmware gửi số liệu pin mới nhanh hơn.

Lỗi mạng không đồng nghĩa pin về 0 hoặc thiết bị bị gỡ. Có thể giữ số liệu đã nhận
và đánh dấu chưa tải được dữ liệu mới. Khi logout/đổi account, xóa cache thiết bị/pin cũ.
`lastSeenAt` hoặc `batteryReportedAt` không tự chứng minh thiết bị đang online realtime.

## Phân biệt API và credential

- Mobile đọc GET `/me` bằng JWT của chủ thiết bị.
- Chỉ firmware gửi PUT `/device/status` bằng hardware ID + device token.
- Không lấy phần trăm pin điện thoại để báo thành pin HEROS.
- Người thân không có thiết bị riêng vẫn nhận SOS bình thường; không lấy pin của owner
  bằng profile người thân. GET `/me` luôn trả profile của account đang login.

Ví dụ payload firmware để phối hợp test:

```json
{
  "batteryPercent": 82,
  "isCharging": false,
  "estimatedMinutesRemaining": 2880
}
```

`batteryPercent` và `isCharging` bắt buộc; thời gian còn lại tùy chọn.

## Checklist test

- Firmware báo 82% → refresh profile → mobile hiện 82%.
- Firmware đổi `isCharging` sang true → refresh → mobile hiện đang sạc.
- Pin 0% hiển thị đúng, không thành “Chưa cập nhật”.
- Thiết bị chưa từng báo pin: pin và thời gian cập nhật null, không báo hết pin.
- Không có thiết bị: `device: null`, phần thiết bị ẩn.
- Đổi account hoặc logout không để lại pin/serial của account cũ.
- Số liệu cũ hoặc request lỗi không bị diễn giải thành trạng thái online chắc chắn.

Xem thêm [profile thiết bị](MOBILE_PREASSIGNED_DEVICE_VI.md)
và [hướng dẫn firmware gửi pin](DEVICE_RESCUE_STATUS_UPDATE_VI.md).
