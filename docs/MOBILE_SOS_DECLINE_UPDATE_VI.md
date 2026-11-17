# Mobile: lựa chọn hỗ trợ SOS

Bản mobile mới chỉ hiện hai nút cho người nhận chưa phản hồi:

- **Hỗ trợ**: giữ API `POST /v1/sos/:id/acknowledge`, gửi `{"supportMode":"in_person"}` để thiết bị nhận tín hiệu có người xác nhận đến.
- **Không thể hỗ trợ**: gọi `POST /v1/sos/:id/decline`, không cần body.

Cả hai API dùng JWT của người nhận đã liên kết. Backend vẫn chấp nhận `remote` và request acknowledge không có `supportMode` của app cũ; chỉ bỏ nút hỗ trợ từ xa trên giao diện mới.

```bash
curl -X POST "https://heros.nextteam.site/v1/sos/${SOS_ID}/decline" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

HTTP `201`: `data.sosId` và `data.declinedAt` (ISO 8601). Gửi lại cùng SOS trả cùng thời điểm đã lưu. Không mở chat, không tăng số người ứng cứu, không kết thúc SOS và không ảnh hưởng người nhận khác.

Sau thành công, hiện “Không thể hỗ trợ” và ẩn hai nút cho SOS đó. GET chi tiết SOS và danh sách SOS đến có thêm `viewerDeclined`. Không đổi UI sang đã từ chối nếu API thất bại. Nếu nhận `409 SOS_ALREADY_ACKNOWLEDGED` hoặc `SOS_ALREADY_DECLINED`, đọc lại chi tiết để đồng bộ. Một phản hồi đã được ghi nhận không thể đổi sang lựa chọn kia cho cùng SOS. Backend phát socket `sos.declined` với `sosId`, `userId`, `declinedAt` cho chủ SOS và người đã từ chối.

## Kiểm tra SOS và chat

- SOS mới gửi push tới toàn bộ liên hệ đã chấp nhận liên kết, bật push và có FCM token đủ điều kiện cho phiên mobile hiện tại. Liên hệ chỉ có số điện thoại không tự nhận push.
- Đối chiếu `PUSH_DISPATCH type=SOS_CREATED` theo `sosId`: `users`, `tokens`, `sent`, `failed`. Token được loại trùng; số token không nhất thiết bằng số người. FCM nhận không đồng nghĩa iPhone đã hiển thị.
- Khi mở chat, mobile có thể tải chi tiết nhóm và trang tin nhắn đầu song song sau khi acknowledge thành công. Dùng giới hạn trang và cursor theo [contract chat](SOS_GROUP_CHAT_MOBILE_VI.md); không đợi tải xong ghi âm mới hiện tin nhắn.
