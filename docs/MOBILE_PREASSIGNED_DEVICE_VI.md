# Mobile: thiết bị gắn sẵn với tài khoản mua hàng

## 1. Flow hiện tại

1. Khách tạo account trên web và mua hàng. Web và mobile dùng chung account/database.
2. Trước khi giao hàng, bộ phận vận hành gắn hardware ID của thiết bị với account khách trên server.
3. Firmware đã được nạp hardware ID và device token riêng. Thiết bị tự gọi API qua mạng SIM/Internet.
4. Khách đăng nhập app bằng account mua hàng, gọi `GET /v1/me` để lấy profile và thiết bị.
5. App không phải kết nối Bluetooth, nhập serial, quét QR hoặc chuyển JWT/token sang phần cứng.

Mỗi account tối đa một thiết bị vật lý, mỗi thiết bị thuộc một account.
Thanh toán thành công không tự xác định serial nào sẽ được giao: vận hành phải gán đúng thiết bị thực tế.
Account mua hàng chưa được gán thiết bị vẫn login được và nhận `device: null`.

## 2. API profile

```http
GET https://heros.nextteam.site/v1/me
Authorization: Bearer ACCESS_TOKEN
```

Response vẫn giữ nguyên các trường profile hiện tại, thêm `data.device`.
Ví dụ rút gọn khi đã gắn thiết bị đang được bật:

```json
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "ACCOUNT_ID",
    "email": "buyer@example.com",
    "userType": "device_owner",
    "device": {
      "id": "HARDWARE_DOCUMENT_ID",
      "hardwareId": "HEROS-DEVICE-001",
      "label": null,
      "enabled": true,
      "batteryPercent": null,
      "isCharging": null,
      "estimatedMinutesRemaining": null,
      "batteryReportedAt": null,
      "lastSeenAt": null
    }
  }
}
```

Khi không có thiết bị đang bật (chưa gán hoặc đã thu hồi):

```json
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "ACCOUNT_ID",
    "email": "contact@example.com",
    "userType": "emergency_contact",
    "device": null
  }
}
```

- `device.id`: MongoDB ID của document phần cứng, không phải user ID/SOS ID.
- `device.hardwareId`: serial cố định được nạp vào firmware.
- `device` luôn có trên response GET profile mới: object hoặc `null`, không phải mảng/rỗng.
- Pin và thời gian còn lại có thể `null` nếu firmware chưa báo. `0` và `false` là giá trị hợp lệ.
- `lastSeenAt` chỉ là lần xác thực/báo trạng thái gần nhất, không chứng minh thiết bị đang online.
- Không trả device token hoặc secret hash. Mobile không cần biết các credential này.
- Login/register vẫn giữ contract cũ; sau login phải gọi `GET /me`, không suy ra thiết bị từ response login.
- Sau PATCH profile, gọi lại GET `/me` để cập nhật toàn bộ profile kèm thiết bị.

## 3. Mobile cần sửa gì

1. Thêm model `device` nullable với các trường ở trên vào profile.
2. Sau login, khi mở màn Thiết bị, khi app quay lại foreground hoặc người dùng refresh: gọi GET `/me`.
3. `device != null`: hiện tab/mục Thiết bị, serial và pin. `device == null`: ẩn phần Thiết bị.
4. Không chỉ dùng `userType == device_owner` để hiện phần Thiết bị: account có role owner có thể chưa được giao thiết bị.
5. Bỏ màn bắt buộc nhập serial/QR, tìm BLE, ghép Bluetooth và chuyển token sang device.
6. Không gọi POST `/me/heros-devices` tự động khi login/refresh. Endpoint legacy này xoay token và có thể làm firmware đang nạp token cũ trả 401.
7. Khi logout/đổi account, xóa profile/device cache cũ; không hiện nhầm thiết bị account trước.
8. Lỗi mạng/401 của GET `/me` phải xử lý như lỗi mạng/phiên, không tự diễn giải thành `device: null`.

Phân biệt ba ID để tránh lỗi:

| Trường                                           | Ý nghĩa                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `deviceId` gửi lúc login hoặc POST `/me/devices` | Installation ID của điện thoại, giữ ổn định |
| `profile.device.id`                              | ID document thiết bị HEROS                  |
| `profile.device.hardwareId`                      | Hardware serial dùng bởi firmware           |

POST `/me/devices` vẫn bắt buộc để đăng ký **FCM token điện thoại** sau login/token refresh,
kể cả với người thân không có phần cứng. Không thay installation ID bằng serial HEROS.
Ẩn phần Thiết bị không được ẩn SOS đến, quyền nhận push, bản đồ hoặc nhóm ứng cứu của người thân.

## 4. Gán trước trên server (vận hành, không gọi từ mobile)

Sau khi xác minh account và serial của hàng sẽ giao, chạy trong thư mục backend:

```bash
read -r -s -p 'Preinstalled device token: ' HEROS_PROVISION_DEVICE_TOKEN
export HEROS_PROVISION_DEVICE_TOKEN
npm run device:assign -- buyer@example.com HEROS-DEVICE-001
unset HEROS_PROVISION_DEVICE_TOKEN
```

Token phải là token `hdv_...` thực tế đã nạp vào firmware qua kênh sản xuất an toàn.
Script không tạo account, không tự sửa role, không in/ghi token ra file; chỉ lưu SHA-256 hash.
`MONGODB_URI` dùng cấu hình backend hiện có. Không cần thêm biến thường trực vào `.env`.
Không chạy command chứa token literal vì shell history/log có thể lưu lại.

Nếu thiết bị đã gán đúng account, chạy lại không đổi token; token được nhập phải khớp hash đang lưu.
Nếu chỉ muốn kiểm tra liên kết đã có, có thể bỏ biến `HEROS_PROVISION_DEVICE_TOKEN`.
Gán thiết bị mới luôn yêu cầu token đã nạp sẵn.
Script từ chối account không active/không phải owner, thiết bị thuộc account khác,
owner đã có thiết bị, token không khớp hoặc thiết bị đã thu hồi.
Không chuyển lịch sử SOS/recordings giữa account và không tự gửi SOS.

Legacy provisioning API vẫn tồn tại để tương thích, không nằm trong flow app mới.
Không dùng token HEROS để đăng nhập app hoặc JWT app để xác thực firmware.

## 5. Checklist kiểm thử

- Account mua hàng dùng lại được trên app, không bắt đăng ký hoặc ghép lại.
- Trước gán: GET `/me` trả `device: null`; sau gán: refresh trả đúng ID/serial.
- Account người thân không có phần cứng: phần Thiết bị ẩn nhưng vẫn nhận/ứng cứu SOS được.
- Firmware dùng credential đã nạp: ping 200, tạo SOS, GET active, upload audio, resolve hoạt động mà không cần BLE.
- Tắt quyền thiết bị: GET `/me` trả `device: null`, hardware credential bị từ chối.
- Chuyển account/logout: không giữ thiết bị/pin cũ.
- Pin chưa có dữ liệu hiển thị trạng thái chưa cập nhật, không coi `null` là 0%.
- Xác nhận FCM/APNs riêng trên điện thoại thật; có device trong profile không chứng minh push hoạt động.
