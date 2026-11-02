# Kiểm tra đăng ký FCM token sau logout/login

Sau khi deploy bản có log mới, mở:

```bash
pm2 logs backend --lines 100
```

Logout rồi login lại trên app. Không login cùng account ở điện thoại khác giữa lúc test.
Mobile phải lấy FCM token hiện tại và gọi POST `/v1/me/devices` bằng JWT mới,
với `deviceId` giống installation ID dùng lúc login.

## Log cần thấy

```text
PUSH_DEVICE_HTTP_IN requestId=... method=POST path=/v1/me/devices ...
PUSH_TOKEN_REGISTER_RECEIVED userId=... installationFingerprint=... tokenFingerprint=... platform=ios
PUSH_TOKEN_REGISTERED userId=... installationFingerprint=... tokenFingerprint=... platform=ios tokenState=changed sessionUpdated=true enabled=true
PUSH_DEVICE_HTTP_OUT requestId=... method=POST path=/v1/me/devices status=201 ... authenticated=true errorCode=NONE
```

- `tokenState=new`: chưa có bản ghi cho account + installation này trước request.
- `tokenState=changed`: token khác giá trị đã lưu trước request.
- `tokenState=unchanged`: token không đổi. Đây có thể là hành vi bình thường sau logout/login.
- `sessionUpdated=true`: bản ghi push vừa được gắn với session của lần login mới.
- Token không đổi vẫn phải đăng ký lại sau mỗi login, vì session mobile đã thay đổi.
- `tokenState`/`sessionUpdated` so sánh với snapshot đọc trước upsert; nếu app gửi nhiều request đồng thời, đây là log chẩn đoán chứ không phải lịch sử giao dịch tuyệt đối.

Fingerprint là 12 ký tự đầu SHA-256, không phải token có thể dùng để gửi push.
Không đăng token/JWT/session key đầy đủ lên log hoặc chat.

## Nếu thiếu log

| Log                                   | Kết luận cần kiểm tra                                                                           |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Không có `PUSH_DEVICE_HTTP_IN`        | Chưa thấy request tới instance backend này; kiểm tra mobile có gọi API, URL và đúng process log |
| Có `IN`, trả 401, không có `RECEIVED` | JWT thiếu/sai/hết hiệu lực hoặc session cũ đã bị thu hồi                                        |
| Có `IN`, trả 400, không có `RECEIVED` | Body không hợp lệ; mobile đọc response lỗi validation                                           |
| `PUSH_TOKEN_REGISTER_REJECTED`        | `deviceId` đăng ký push khác installation ID trong JWT login                                    |
| `PUSH_TOKEN_REGISTER_FAILED`          | Đọc/ghi database thất bại, chưa xác nhận đăng ký token thành công                               |
| Có `REGISTERED` và HTTP 201           | Backend đã lưu token cho request này, chưa chứng minh iPhone đã nhận push                       |

Đối chiếu fingerprint của token dùng gửi test trên Firebase với token đã đăng ký, không chỉ so thời gian login.
Việc đổi code/app không đảm bảo FCM token tự đổi; cần callback token refresh và đăng ký lại sau login.
Nếu request thất bại do mất mạng, mobile phải retry sau khi có mạng và kiểm tra HTTP thành công.

Sau khi thấy đăng ký thành công, gửi một thông báo TEST đến token đang lưu rồi kiểm tra trên điện thoại.
Không tự tạo SOS thật chỉ để kiểm tra token. Cơ chế nhập mã email/QR không liên quan phần đăng ký push này.
