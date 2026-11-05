# Firmware HEROS: nhận tín hiệu có người đến ứng cứu

## API mới

`GET /v1/device/sos/:id/rescue-status`

- `:id` là `data.id` trả về khi tạo SOS hoặc lấy SOS đang hoạt động qua `GET /v1/device/sos/active`. Không dùng mã SOS hiển thị.
- Dùng hardware ID và device token hiện có. Không cần JWT, không ghép lại thiết bị.
- Backend chỉ cho đọc SOS thuộc chủ thiết bị. Tính năng dùng được trên production sau khi backend mới được deploy.

```bash
curl -i "https://heros.nextteam.site/v1/device/sos/${SOS_ID}/rescue-status" \
  -H "X-Heros-Hardware-Id: ${HARDWARE_ID}" \
  -H "X-Heros-Device-Token: ${DEVICE_TOKEN}"
```

## Response

Chưa có người ứng cứu vẫn trả HTTP `200`:

```json
{
  "success": true,
  "code": 200,
  "data": {
    "sosId": "YOUR_SOS_ID",
    "sosStatus": "active",
    "rescueStatus": "WAITING_FOR_RESPONDER",
    "hasInPersonResponder": false,
    "responderCount": 0,
    "inPersonCount": 0,
    "remoteCount": 0
  }
}
```

Khi có người xác nhận đến trực tiếp, `rescueStatus` là `RESPONDER_EN_ROUTE`,
`hasInPersonResponder` là `true` và `inPersonCount` lớn hơn 0.
Đây là xác nhận đến hỗ trợ, không phải xác minh người đó đã đến nơi.

| `data.rescueStatus` | Firmware xử lý |
| --- | --- |
| `WAITING_FOR_RESPONDER` | Chưa có người xác nhận; tiếp tục poll |
| `RESPONDER_EN_ROUTE` | Có người xác nhận đến trực tiếp; phát tín hiệu |
| `REMOTE_SUPPORT` | Có hỗ trợ từ xa; không phát tín hiệu “có người đến” |
| `SUPPORT_CONFIRMED` | Có xác nhận nhưng chưa chọn hình thức; không phát tín hiệu “có người đến” |
| `SOS_CLOSED` | Tắt tín hiệu, dừng poll; `sosStatus` cho biết `resolved` hay `cancelled` |

## Logic tích hợp

1. Sau khi có SOS ID, gọi API ngay. Sau mỗi response, chờ khoảng **5 giây** rồi gọi tiếp; không chạy hai request polling đồng thời.
2. Khi bắt đầu theo dõi SOS mới, đặt trạng thái trước đó là `false`. Chỉ phát tín hiệu LED/còi theo thiết kế firmware khi `hasInPersonResponder` chuyển từ `false` sang `true`. Không phát lặp khi vẫn là `true`.
3. Khi một response hợp lệ trả về `false`, cập nhật trạng thái về `false`. Nếu SOS đã đóng, dừng vòng polling. Bỏ qua response đến muộn nếu firmware đã chuyển sang SOS ID khác.
4. Nếu mất mạng, timeout hoặc HTTP `5xx`, giữ trạng thái cuối, retry với thời gian chờ tăng dần. Không coi lỗi mạng là “chưa có ai đến”.
5. HTTP `401`: dừng retry liên tục, kiểm tra hardware ID/device token. HTTP `404`: kiểm tra SOS ID và gọi `GET /v1/device/sos/active` để đồng bộ; nếu không còn SOS thì dừng.

## Test bàn giao

- Tạo SOS mới: thấy `WAITING_FOR_RESPONDER`, thiết bị chưa phát tín hiệu.
- Người hỗ trợ xác nhận đến trực tiếp: poll tiếp theo thấy `RESPONDER_EN_ROUTE`, tín hiệu phát một lần.
- Thử một SOS riêng chỉ có hỗ trợ từ xa: không phát tín hiệu “có người đến”.
- Xác nhận đã an toàn hoặc hủy SOS: nhận `SOS_CLOSED` và dừng poll.
- Ngắt mạng khi polling: không tạo SOS mới, không tự đổi trạng thái ứng cứu.

Không in device token vào log. Xem thêm [contract firmware đầy đủ](DEVICE_FIRMWARE_CONTRACT_VI.md).
