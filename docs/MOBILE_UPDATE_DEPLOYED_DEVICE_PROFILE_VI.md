# Mobile cần sửa: thiết bị gắn sẵn trong profile

## Phạm vi bản backend đã deploy

Áp dụng cho commit `97b0010` trên `main`, theo thông tin backend đã được deploy.
Base URL: `https://heros.nextteam.site/v1`.

Flow hiện tại: vận hành gắn sẵn thiết bị với account mua hàng trên backend.
Khách đăng nhập app bằng chính account mua hàng; không tạo account mới, không ghép Bluetooth.
Thiết bị dùng hardware ID và device token riêng đã nạp sẵn, không dùng JWT của mobile.

**Chưa tích hợp nhập mã email/quét QR ở bản này.** Flow kích hoạt mới đang sửa local,
chưa push/deploy. Mobile chưa gọi `/me/heros-devices/activate` hoặc `/claim`.

## 1. Đọc thiết bị từ API profile

Sau login, gọi:

```bash
curl 'https://heros.nextteam.site/v1/me' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

Response giữ nguyên các trường profile cũ và thêm `data.device`.
Ví dụ rút gọn khi account đã có thiết bị:

```json
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "ACCOUNT_ID",
    "email": "reviewer.owner@nextteam.site",
    "userType": "device_owner",
    "device": {
      "id": "HARDWARE_DOCUMENT_ID",
      "hardwareId": "HEROS-TEST-20261012-001",
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

Không có thiết bị đang được bật hoặc thiết bị đã thu hồi:

```json
{
  "success": true,
  "code": 200,
  "data": {
    "_id": "ACCOUNT_ID",
    "email": "reviewer.contact@nextteam.site",
    "userType": "emergency_contact",
    "device": null
  }
}
```

Các ví dụ chỉ minh họa cấu trúc; không hardcode ID, email hay pin vào app.

## 2. Model mobile

Thêm `device` nullable vào model profile. `device` là object, không phải mảng.

| Trường                             | Kiểu                      | Ý nghĩa                                     |
| ---------------------------------- | ------------------------- | ------------------------------------------- |
| `device`                           | object hoặc null          | Thiết bị đang gắn với account, còn được bật |
| `device.id`                        | string                    | ID document phần cứng trong MongoDB         |
| `device.hardwareId`                | string                    | Serial cố định của thiết bị                 |
| `device.label`                     | string hoặc null          | Tên thiết bị nếu đã đặt                     |
| `device.enabled`                   | boolean                   | Thiết bị có được phép dùng credential không |
| `device.batteryPercent`            | number hoặc null          | Pin 0–100, chưa báo thì null                |
| `device.isCharging`                | boolean hoặc null         | Đang sạc hay chưa có dữ liệu                |
| `device.estimatedMinutesRemaining` | number hoặc null          | Số phút còn lại do firmware ước lượng       |
| `device.batteryReportedAt`         | ISO 8601 string hoặc null | Lần báo pin gần nhất                        |
| `device.lastSeenAt`                | ISO 8601 string hoặc null | Lần backend ghi nhận thiết bị gần nhất      |

Backend không trả device token/secret hash trong profile.
`0` phần trăm pin và `false` ở trạng thái sạc là dữ liệu hợp lệ, không được đổi thành null.
Không dùng `lastSeenAt` như bằng chứng online realtime hoặc tự suy ra hết pin từ dữ liệu cũ.

## 3. Luồng login và hiển thị

1. Giữ nguyên API login hiện tại, lưu JWT an toàn như cũ.
2. Sau login thành công, gọi GET `/me` để lấy profile đầy đủ, không chỉ dùng `user` trong response login.
3. `data.device != null`: hiện tab/mục Thiết bị, serial và trạng thái pin.
4. `data.device == null`: ẩn tab/mục Thiết bị. Account owner chưa được gán device cũng có thể nhận null.
5. Không chỉ dựa vào `userType == device_owner` để quyết định hiện phần Thiết bị.
6. Bỏ bước bắt nhập serial, quét QR, tìm Bluetooth, pair hoặc đưa JWT vào firmware.
7. Khi app vào foreground, người dùng refresh hoặc mở màn Thiết bị: gọi lại GET `/me`.
8. Khi logout/đổi account: xóa cache profile/device để không hiện thiết bị của account trước.
9. Sau PATCH profile: gọi lại GET `/me`; không ghi đè model device bằng response PATCH vốn không có trường này.

Lỗi mạng hoặc HTTP 401 không có nghĩa thiết bị đã mất/đã bị gỡ.
Hiển thị lỗi tải dữ liệu hoặc xử lý đăng nhập lại theo mã lỗi, không tự đổi thành `device: null`.
Nếu nhận HTTP 200 nhưng thiếu hẳn trường `device`, kiểm tra phiên bản backend và model parsing,
không kết luận account không có thiết bị.

## 4. Không gọi API cấp lại credential

Không gọi `POST /me/heros-devices` khi login/refresh hoặc khi mở màn Thiết bị.
Trong bản đã deploy, đây là API legacy cấp lại credential và có thể xoay device token,
làm token đã nạp trong firmware bị lệch, gây `401 DEVICE_CREDENTIAL_INVALID`.

Không tự gọi DELETE `/me/heros-devices/:hardwareId` khi logout.
Logout khỏi điện thoại không được thu hồi phần cứng của khách.

Không đổi JWT/account mua hàng, không yêu cầu điện thoại luôn mở app để device gọi SOS.

## 5. Push điện thoại vẫn phải đăng ký riêng

Sau login và mỗi lần FCM token đổi, tiếp tục gọi:

```http
POST /v1/me/devices
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "deviceId": "SAME_INSTALLATION_ID_USED_AT_LOGIN",
  "platform": "ios",
  "pushToken": "FCM_REGISTRATION_TOKEN"
}
```

Android gửi `platform: "android"`.

| ID/token                                          | Dùng cho                                                   |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Login `deviceId` và POST `/me/devices` `deviceId` | Cùng installation ID ổn định của điện thoại                |
| `profile.device.id`                               | Document thiết bị HEROS, không thay installation ID        |
| `profile.device.hardwareId`                       | Serial của phần cứng                                       |
| `pushToken`                                       | FCM registration token của app                             |
| HEROS device token                                | Credential riêng nằm trong firmware, mobile không cần biết |

Account người thân dù có `device: null` vẫn phải đăng ký push và vẫn có bản đồ,
SOS đến, nhóm chat và khả năng xác nhận ứng cứu như cũ. Chỉ ẩn phần Thiết bị.

## 6. Thông báo đã an toàn

Giữ xử lý push `SOS_RESOLVED` và socket `sos.resolved`:

- Cập nhật sự cố thành `resolved`, dừng trạng thái SOS đang diễn ra.
- Hiện thông báo/banner theo `title` và `message`, không chỉ xóa marker im lặng.
- Đóng trạng thái nhóm ứng cứu khi nhận `sos.chat.closed`.
- Dedupe theo SOS ID và trạng thái để tránh hiện hai lần khi cả push và socket cùng đến.

Push đến màn hình khóa còn phụ thuộc FCM/APNs và quyền thông báo trên điện thoại.
Có device trong profile hoặc API trả 200 không chứng minh push đã hiển thị trên máy.

## 7. Test bàn giao mobile

- `reviewer.owner@nextteam.site`: dự kiến có thiết bị test `HEROS-TEST-20261012-001`; đọc giá trị thật từ GET `/me`.
- `reviewer.contact@nextteam.site`: không có phần cứng riêng, GET `/me` trả `device: null`; vẫn nhận SOS của owner.
- Đăng nhập owner không hiện màn nhập serial/QR/Bluetooth.
- Đăng nhập contact sau owner không giữ lại phần Thiết bị/pin từ owner.
- Pin null hiện chưa có dữ liệu; pin 0 hiện 0%, không coi như thiếu field.
- Refresh profile sau vận hành gán/thu hồi thiết bị cập nhật đúng giao diện.
- Firmware bấm SOS vẫn hoạt động khi điện thoại owner không mở app.
- Người thân nhận SOS, xác nhận ứng cứu, xem vị trí/ghi âm, rồi nhận thông báo khi owner xác nhận an toàn.

## Chưa triển khai lên server: kích hoạt bằng mã/QR

Định hướng tiếp theo: một mã được gửi email sau khi đơn được chuẩn bị thiết bị,
QR trong hộp chứa cùng mã. Mobile cho nhập mã hoặc quét QR rồi gọi chung API kích hoạt.
Flow này đang phát triển local theo yêu cầu chưa push; không bật màn/endpoint này trong bản mobile hiện tại.
