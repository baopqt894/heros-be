# Feedback website Heros

Website gọi server-side `POST /v1/contact`. API này không yêu cầu tài khoản; validation và giới hạn gửi áp dụng trước khi ghi MongoDB collection `contact_messages`. Chỉ trả 201 sau khi MongoDB xác nhận tạo bản ghi.

Body: `{name,email,phone,message}`; phone có thể rỗng. Thành công: `{success:true,code:201,data:{id,createdAt}}`.

## Triển khai

1. Deploy backend từ main, dùng MongoDB hiện có. Module Contact được nạp trong AppModule.
2. Website Vercel đặt `HEROS_API_URL=https://heros.nextteam.site/v1/` và `HEROS_SITE_URL=https://heros.dolphinxstudio.com`; deploy bản FE mới. Website không ghi SQLite nữa.
3. Kiểm tra body rỗng ở POST /v1/contact trả 400; phản hồi 404 nghĩa là bản backend mới chưa được deploy. Không tự chèn feedback thử vào production nếu chưa được chủ hệ thống đồng ý.

## Lấy dữ liệu cho Google Sheets

`GET /v1/contact/export?after=0` yêu cầu `Authorization: Bearer <HEROS_FEEDBACK_EXPORT_KEY>`. Đặt cùng một khóa ngẫu nhiên ít nhất 32 ký tự ở backend, Vercel web và Script Properties của Apps Script. Không đặt khóa trong client, URL hoặc ô Sheet. Chưa cấu hình trả 503; sai/thiếu token trả 401.

Response data: `{messages:[{id,name,email,phone,message,createdAt}],nextCursor:200,hasMore:true}`. ID là chuỗi ObjectId; cursor là offset không âm; tối đa 200 dòng mỗi trang. API chỉ chọn các trường này, có Cache-Control private/no-store. Không có API xóa hoặc chỉnh sửa feedback trong thay đổi này.

Apps Script lấy qua web `/api/contact/export`, dùng ID mongo để chống trùng và giữ cột Trạng thái. Sau một chu kỳ hoàn tất, script quét lại từ đầu lần sau để lấy cả bản ghi được chèn trễ. Cursor giữa chu kỳ giúp tiếp tục sau lỗi hoặc vượt giới hạn 10 trang mỗi lần bấm.

Dữ liệu SQLite cũ không tự migrate và không bị xóa. Backup/migration riêng nếu có dữ liệu lịch sử.

Giá đơn hàng đã được sửa ở commit riêng; thay đổi feedback không sửa tài khoản, đơn hàng hoặc dữ liệu thanh toán.
