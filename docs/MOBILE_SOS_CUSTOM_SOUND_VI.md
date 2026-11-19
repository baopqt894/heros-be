# HEROS iOS — cấu hình chuông SOS heros_sos.wav

## Contract backend

Thông báo tạo SOS mới có `data.type = "SOS_CREATED"`. Backend gửi tên chuông cho iOS qua FCM HTTP v1:

```json
{
  "message": {
    "token": "FCM_TOKEN",
    "notification": {
      "title": "Tín hiệu SOS",
      "body": "Người thân đang gặp sự cố, cần bạn hỗ trợ!"
    },
    "data": {
      "type": "SOS_CREATED",
      "sosId": "SOS_ID"
    },
    "apns": {
      "headers": {
        "apns-push-type": "alert",
        "apns-priority": "10"
      },
      "payload": {
        "aps": {
          "sound": "heros_sos.wav",
          "content-available": 1
        }
      }
    }
  }
}
```

Đây là ví dụ rút gọn của request backend gửi Firebase. Backend tự bổ sung các field SOS và collapse ID hiện có.

| Loại push | Tiếng báo iOS |
| --- | --- |
| `SOS_CREATED` — tạo SOS mới từ app hoặc phần cứng | `heros_sos.wav` |
| Đã an toàn, clip mới, tin nhắn và các loại push khác | `default` |

Thay đổi này dành cho iOS. Android hiện dùng chuông mặc định. Không cần thêm biến môi trường backend cho tên chuông.

## 1. Thêm file âm thanh vào bản build iOS

Đội mobile cần có file âm thanh chuông đã chọn, đặt tên chính xác **heros_sos.wav**.

1. Chọn WAV có codec Linear PCM và thời lượng dưới 30 giây.
2. Kéo file vào project Xcode, chọn copy file vào project nếu cần.
3. Trong File Inspector, bật **Target Membership** cho target app HEROS.
4. Vào **Target → Build Phases → Copy Bundle Resources**, xác nhận có `heros_sos.wav`.
5. Build và cài bản app mới lên iPhone thật.

Kiểm tra nhanh ở bản debug:

```swift
if Bundle.main.url(forResource: "heros_sos", withExtension: "wav") == nil {
    assertionFailure("Missing heros_sos.wav in the app bundle")
}
```

Backend chỉ gửi tên file trong payload. File chuông cần nằm trong app bundle hoặc `Library/Sounds` của app. Đây là tài nguyên chuông thông báo, cần thêm vào project iOS; repo backend không kèm file âm thanh. Nếu file không hợp lệ, không tìm thấy hoặc dài hơn giới hạn, hệ thống có thể phát chuông mặc định.

[Apple — Preparing Custom Alert Sounds](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/SupportingNotificationsinYourApp.html)

## 2. Xin quyền và đăng ký push

Giữ cấu hình Firebase/APNs hiện có của HEROS. Target cần capability **Push Notifications** và Firebase cần APNs key đúng app/team.

Gắn phần xin quyền vào luồng onboarding hoặc bật thông báo hiện tại của app:

```swift
import UIKit
import UserNotifications

func enableNotifications() async throws {
    let granted = try await UNUserNotificationCenter.current()
        .requestAuthorization(options: [.alert, .sound, .badge])

    if granted {
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }
}
```

Nếu app đã có code xin quyền/đăng ký push, tích hợp vào luồng đó. Tiếp tục gửi FCM token hiện tại lên `POST /v1/me/devices` sau login, token refresh và khi app về foreground theo contract đăng ký thiết bị hiện có.

Trên iPhone kiểm tra **Settings → Notifications → HEROS** hoặc **Settings → Apps → HEROS → Notifications** tùy phiên bản iOS. Bật **Allow Notifications**, **Lock Screen** và **Sounds**. Người dùng đã từ chối quyền cần bật lại trong Settings.

Không cần bật chế độ Background Audio để hệ thống phát âm thanh của thông báo trên màn hình khóa.

[Apple — Asking permission to use notifications](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)

## 3. Khi app đang mở

Delegate notification cần cho phép `.sound` khi hiển thị notification ở foreground:

```swift
func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
) async -> UNNotificationPresentationOptions {
    [.banner, .list, .sound]
}
```

Đặt method trên vào object đang tuân thủ `UNUserNotificationCenterDelegate` của app. Đảm bảo `UNUserNotificationCenter.current().delegate` được gán sớm khi khởi động và object delegate được giữ sống. Nếu app đã có method `willPresent`, bổ sung `.sound` vào nhánh hiển thị SOS.

Nếu app có logic tự phát chuông riêng cho `SOS_CREATED`, phối hợp với notification presentation để một SOS chỉ phát một lần ở foreground.

Khi app ở nền hoặc điện thoại khóa màn hình, iOS phát âm thanh từ push payload theo quyền và cài đặt của người dùng.

[Firebase — Receive messages in Apple platform apps](https://firebase.google.com/docs/cloud-messaging/ios/receive-messages)

## 4. Im lặng và Focus

Chuông thông báo thông thường chịu ảnh hưởng của chế độ im lặng, âm lượng thông báo và Focus/Do Not Disturb.

Muốn âm thanh vượt chế độ im lặng hoặc Do Not Disturb cần Critical Alerts với entitlement được Apple phê duyệt và quyền riêng của người dùng. Bản cập nhật này dùng chuông thông báo thông thường.

[Apple — Critical Alerts](https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert)

## 5. Checklist test sau deploy và cài app mới

- Xác nhận `Bundle.main.url(...)` tìm được file chuông trên bản build cài vào máy.
- Đăng nhập người nhận SOS và đăng ký FCM token cho phiên đó.
- Bật quyền thông báo, màn hình khóa và Sounds. Để âm lượng thông báo đủ nghe, tắt im lặng và Focus trong lượt test ban đầu.
- Khóa iPhone, tạo một SOS demo từ owner đã liên kết với người nhận. Xác nhận notification xuất hiện và phát `heros_sos.wav`.
- Lặp lại khi app ở nền và khi app đang mở. Foreground chỉ phát một lần.
- Xác nhận thông báo đã an toàn, clip mới và tin nhắn dùng tiếng mặc định.
- Thử tắt Sounds hoặc bật im lặng/Focus để đối chiếu hành vi theo cài đặt hệ thống.
- Bản app cũ chưa chứa file chuông cần được kiểm tra fallback tiếng mặc định.

Backend cần deploy commit chứa thay đổi và mobile cần cài build chứa file chuông. Kết quả unit test backend xác nhận payload; việc nghe chuông trên màn hình khóa cần xác nhận trên iPhone thật.

Tài liệu liên quan — [Theo dõi đăng ký FCM token](PUSH_TOKEN_LOGIN_DEBUG_VI.md).
