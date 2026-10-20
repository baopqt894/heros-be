# Tài khoản demo cho App Review

API production: `https://heros.nextteam.site/v1` (HTTPS).

| Tài khoản | Role | OTP đăng nhập |
| --- | --- | --- |
| `reviewer.owner@nextteam.site` | `device_owner` | `123456` |
| `reviewer.contact@nextteam.site` | `emergency_contact` | `123456` |

Đây là hai tài khoản demo chuyên dụng. Owner có contact reviewer trong danh sách khẩn cấp ở trạng thái `accepted`. Người thân không cần nhận hoặc chấp nhận lời mời lại. Liên kết theo chiều owner → contact; contact không trở thành owner và không có danh sách khẩn cấp ngược chiều.

## Chuẩn bị backend

1. Deploy code có danh sách hai email reviewer.
2. Chạy trên host backend, dùng đúng `MONGODB_URI` của production:

```bash
npm run seed:reviewer
```

Script chỉ tạo/cập nhật hai profile reviewer và một liên kết tương ứng; không reset account demo cũ hoặc mật khẩu/session hiện có. Có thể chạy lại để khôi phục liên kết `accepted` sau khi reviewer thử hủy kết bạn. Account không được gán hardware vật lý tự động; nếu app yêu cầu hardware thì cần cấu hình thiết bị reviewer thật qua flow đã có.

Flag `.env`:

```ini
REVIEWER_AUTH_ENABLED=true
```

Code bật reviewer OTP trừ khi flag này là `false`; không phụ thuộc `DEMO_AUTH_ENABLED` của cặp `owner@heros.vn`/`contact@heros.vn`. Không cần SMTP cho hai email reviewer. User thật vẫn dùng OTP email bình thường. Không thêm domain wildcard hay bypass cho email gần giống, alias hoặc email chưa đăng ký.

OTP cố định chỉ áp dụng luồng login (kể cả xác thực OTP login trực tiếp); không dùng để đăng ký tài khoản mới, xác nhận xóa tài khoản hoặc cập nhật SĐT. Luồng đặt lại mật khẩu hiện dùng OTP purpose login nên cũng nhận OTP cố định cho hai demo này. Mã khác `123456` bị từ chối khi chế độ demo bật. Tài khoản bị khóa/xóa vẫn bị chặn.

## Đăng nhập trên app

1. Chọn đăng nhập bằng email.
2. Nhập một trong hai email trên.
3. Bấm gửi mã; không cần mở hộp thư.
4. Nhập `123456`, vào thẳng tài khoản tương ứng.

Login vẫn áp dụng một session mobile đang hoạt động cho mỗi account. Reviewer đăng nhập lại cùng account trên máy khác sẽ thu hồi phiên mobile trước; dùng hai account khác nhau trên hai máy để thử SOS/người thân.

## cURL kiểm tra

Yêu cầu mã của owner (không gửi email thật):

```bash
curl -X POST 'https://heros.nextteam.site/v1/auth/email/request-otp' \
  -H 'Content-Type: application/json' \
  -d '{"email":"reviewer.owner@nextteam.site","purpose":"login"}'
```

Response thành công có `data.mockOtp: true`. Xác thực owner:

```bash
curl -X POST 'https://heros.nextteam.site/v1/auth/email/verify-otp' \
  -H 'Content-Type: application/json' \
  -d '{"email":"reviewer.owner@nextteam.site","otp":"123456","deviceId":"reviewer-owner-installation-001"}'
```

Xác thực người thân:

```bash
curl -X POST 'https://heros.nextteam.site/v1/auth/email/verify-otp' \
  -H 'Content-Type: application/json' \
  -d '{"email":"reviewer.contact@nextteam.site","otp":"123456","deviceId":"reviewer-contact-installation-001"}'
```

Mỗi response trả `data.accessToken`, `data.user.userType`; không đưa token vào review notes hoặc log công khai. Dùng token owner kiểm tra liên kết:

```bash
curl 'https://heros.nextteam.site/v1/emergency-contacts' \
  -H 'Authorization: Bearer OWNER_ACCESS_TOKEN'
```

Danh sách có email `reviewer.contact@nextteam.site`, `linkedUserId` đúng ID account contact và `invitationStatus: "accepted"`. GET invitations của contact có thể trả rỗng vì đã chấp nhận, không phải thiếu liên kết. Khi owner có SOS đang hoạt động, contact kiểm tra `GET /v1/sos/incoming/active` bằng token riêng.

## Review notes để đưa vào App Store Connect

```text
Dedicated demo accounts:
Owner: reviewer.owner@nextteam.site
Emergency contact: reviewer.contact@nextteam.site

Choose email OTP sign-in. For either demo account, use the fixed code 123456.
No mailbox access is needed. The emergency contact relationship is already accepted.
Use the two accounts on separate devices to test the owner/contact flow.
The fixed OTP applies only to these dedicated demo accounts; normal users use email verification.
```

Liên hệ demo tắt email SOS (`emailEnabled=false`) và bật push (`pushEnabled=true`). Push cần app đăng ký FCM token và cho phép notification. Không gắn người thật vào hai tài khoản reviewer. Việc hỗ trợ app review không đồng nghĩa app đã được Apple duyệt; phần hardware, entitlement và thông tin review vẫn cần cấu hình theo bản build thực tế.
