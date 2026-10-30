# Kiem tra request tu thiet bi

Backend tu dong ghi log cho duong dan `/v1/device/...`, `/device/...` hoac
request co header `X-Heros-Hardware-Id` / `X-Heros-Device-Token`.
Khong can them bien moi vao `.env`.

Sau khi deploy va restart backend, theo doi:

```bash
pm2 logs backend --lines 100
```

Request hop le co hai dong cung `requestId`:

```text
DEVICE_HTTP_IN requestId=... method=POST path=/v1/device/sos hardwareIdPresent=true deviceTokenPresent=true
DEVICE_HTTP_OUT requestId=... method=POST path=/v1/device/sos status=201 durationMs=... authenticated=true errorCode=NONE
```

- Chi co `IN`: request da toi Node nhung chua hoan tat; co the dang upload/cho xu ly.
- `ABORTED`: ket noi dong truoc khi response hoan tat, khong co nghia thao tac chua duoc luu.
- `401` / `DEVICE_CREDENTIAL_INVALID`: sai/thieu hardware ID hoac device token, thiet bi bi tat, hoac owner khong active.
- `400` / `VALIDATION_ERROR`: body sai contract. Firmware can doc response JSON de xem chi tiet.
- `404`: sai URL, sai SOS ID, hoac SOS khong thuoc owner hien tai.
- `409`: xung dot; doc `errorCode` va response, khong tao lai lien tuc.
- `201` khi tao SOS: firmware lay ID tu `data.id` cua response JSON.
- `200` khi GET active: `data: null` nghia la chua co SOS active, khong phai loi mang.
- Khong co `IN`: chua thay request tai Node instance nay. Kiem tra log reverse proxy,
  URL/port, DNS/TLS, mang SIM va dung ban backend da deploy. Khong ket luan chi tu log firmware.

Neu firmware goi sai duong dan khong nhan dien duoc, log dung
`[unrecognized-path]` de tranh lo thong tin nhay cam trong URL.

Moi response duoc theo doi co header `X-Heros-Request-Id` do server tu tao.
Firmware nen in HTTP status, header nay va `data.errorCode` (neu co).
Khong in device token, Authorization, GPS, audio hoac toan bo request/response.
Log request vao backend khong dong nghia push da den dien thoai; xem log FCM rieng.
