# Swift integration contract

The canonical handoff is now [HEROS iOS integration and App Store release (Vietnamese)](IOS_APP_INTEGRATION_AND_RELEASE_VI.md).
It covers invitation links, deployment configuration, TestFlight, App Review and known backend limitations. These older notes are supplementary.

## Response envelope

Decode every HTTP response with the same top-level structure:

```json
{
  "success": false,
  "code": 401,
  "data": {
    "errorCode": "INVALID_CREDENTIALS",
    "message": "Email or password is incorrect"
  }
}
```

`code` is the numeric HTTP status. Successful responses return their resource
inside `data`; failed responses return `errorCode`, `message`, and optional
`details` inside `data`.

## Authentication

Generate and persist one installation UUID in Keychain as `deviceId`.

Registration step 1, request a registration OTP:

```http
POST /v1/auth/email/request-otp
Content-Type: application/json

{ "email": "user@example.com", "purpose": "register" }
```

Registration step 2, create the user and receive tokens:

```http
POST /v1/users
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "deviceId": "persistent-installation-uuid",
  "password": "Heros@Test123",
  "fullName": "Nguyễn Văn A",
  "dateOfBirth": "1995-08-20",
  "gender": "male",
  "phone": "+84901234567",
  "userType": "device_owner"
}
```

`userType` is required when creating an account and is one of:

- `device_owner`: owns the HEROS device and can create SOS events;
- `emergency_contact`: a relative or friend linked to a device owner.

`community_responder` is reserved for a future release and cannot be selected
during registration in the current MVP.

For a first-time Google login, send the same `userType` field to
`POST /v1/auth/google`. Existing Google accounts do not need to resend it.

To enable a relative to receive the SOS inside the app, create or update the
owner's emergency contact with `linkedUserEmail` set to the email of an existing
`emergency_contact` account. The linked account must accept it through
`POST /v1/emergency-contacts/invitations/:id/accept`. A plain phone/email contact
can still receive the SMS composer message or email, but cannot accept the SOS
in-app. Each owner can keep at most ten contacts.

`password` is optional for backward compatibility. When it was provided during
registration, the user can subsequently log in without requesting an OTP:

```http
POST /v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "Heros@Test123",
  "deviceId": "persistent-installation-uuid"
}
```

For an existing user, request a login OTP with `purpose=login`, then verify it:

```http
POST /v1/auth/email/request-otp
Content-Type: application/json

{ "email": "user@example.com", "purpose": "login" }
```

```http
POST /v1/auth/email/verify-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "deviceId": "persistent-installation-uuid"
}
```

An OTP-only account can set a password, or an existing password account can
reset it, using the same login OTP:

```http
POST /v1/auth/password/reset
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456",
  "newPassword": "Heros@Test123",
  "deviceId": "persistent-installation-uuid"
}
```

Google Sign-In must send the ID token, not an authorization code or Google
access token:

```http
POST /v1/auth/google
Content-Type: application/json

{
  "idToken": "result.user.idToken.tokenString",
  "deviceId": "persistent-installation-uuid"
}
```

Configure Google Sign-In on iOS with the backend/server OAuth client ID so the
ID token audience is accepted by `GOOGLE_CLIENT_IDS`.

All three login methods return the same session payload. Store `accessToken` and
`refreshToken` in Keychain. On HTTP 401, call
`POST /v1/auth/refresh` once, replace both rotated tokens, then retry the original
request once.

## FCM registration

After Firebase returns an FCM registration token:

```http
POST /v1/me/devices
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "deviceId": "persistent-installation-uuid",
  "platform": "ios",
  "pushToken": "firebase-registration-token"
}
```

Repeat this request whenever Firebase rotates the token.

## Create SOS

Create a UUID once before the first attempt. Reuse it for every network retry:

```http
POST /v1/sos
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "clientRequestId": "125fe329-0bfd-428f-a69f-a9cefe22449e",
  "message": "Tôi đang gặp nguy hiểm, hãy giúp tôi",
  "location": {
    "latitude": 10.762622,
    "longitude": 106.660172,
    "accuracy": 12,
    "recordedAt": "2026-09-10T14:30:00.000Z"
  }
}
```

Use `data.smsPayload.recipients` and `data.smsPayload.message` to present the
native SMS composer:

```swift
import MessageUI

func presentSosMessage(
    recipients: [String],
    message: String,
    from presenter: UIViewController,
    delegate: MFMessageComposeViewControllerDelegate
) {
    guard MFMessageComposeViewController.canSendText() else { return }

    let composer = MFMessageComposeViewController()
    composer.messageComposeDelegate = delegate
    composer.recipients = recipients
    composer.body = message
    presenter.present(composer, animated: true)
}
```

After opening the composer, report only:

```http
PUT /v1/sos/:id/sms-status
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "status": "composer_opened" }
```

If the MessageUI delegate returns `.sent`, mobile may send
`{ "status": "user_reported_sent" }`. This is not proof of carrier delivery.

## Pairing and testing a physical HEROS device

The app pairs a physical device while logged in as a `device_owner`:

```http
POST /v1/me/heros-devices
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "hardwareId": "HEROS-TEST-001",
  "label": "Thiết bị HEROS test"
}
```

Save `data.deviceToken` into secure device storage immediately. The server only
stores its hash and cannot return the token later. Calling the pairing endpoint
again for the same owner and hardware ID rotates the token.

Use HTTPS outside local development. Never transmit the device token over plain
HTTP or include it in application logs.

Firmware can then create an SOS without storing the user's JWT:

Verify the credential without creating an SOS:

```bash
curl 'https://heros.nextteam.site/v1/device/sos/ping' \
  -H 'X-Heros-Hardware-Id: HEROS-TEST-001' \
  -H "X-Heros-Device-Token: $DEVICE_TOKEN"
```

Create the real SOS event:

```bash
DEVICE_TOKEN='TOKEN_RETURNED_BY_PAIRING_API'

curl -X POST 'https://heros.nextteam.site/v1/device/sos' \
  -H 'X-Heros-Hardware-Id: HEROS-TEST-001' \
  -H "X-Heros-Device-Token: $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"clientRequestId\": \"$(uuidgen)\",
    \"message\": \"SOS test từ thiết bị HEROS\",
    \"location\": {
      \"latitude\": 10.762622,
      \"longitude\": 106.660172,
      \"accuracy\": 10,
      \"recordedAt\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\"
    }
  }"
```

Use a new `clientRequestId` for a new button press. Reuse the same ID only when
retrying the same SOS request. Revoke lost or retired hardware with
`DELETE /v1/me/heros-devices/:hardwareId`.

## Active tracking

While an SOS is active:

- send `PUT /v1/sos/:id/location` every 10-15 seconds only when location changes;
- connect Socket.IO to namespace `/sos` with `auth: { token: accessToken }`;
- stop background location immediately after resolve or cancel;
- persist the active SOS ID and `clientRequestId` locally so app restarts recover
  through `GET /v1/sos/active`.

## Accepting an SOS and protected information

Use `GET /v1/sos/incoming/active` to restore active map markers after app launch.
Before acceptance, `GET /v1/sos/:id` returns the SOS identity and current
location but omits recordings. When a linked relative chooses to help, call:

```http
POST /v1/sos/:id/acknowledge
Authorization: Bearer <accessToken>
```

The response then contains `currentLocation`, `recordings`,
`viewerAcknowledged=true`, and the total `responderCount`. Keep the `/sos`
Socket.IO connection open to receive later `sos.location` and `sos.recording`
events. Multiple recipients may accept the same SOS; repeated acceptance by the
same user is idempotent.

## SOS voice recordings

The device owner's app may upload multiple audio clips while the SOS is active:

```http
POST /v1/sos/:id/recordings
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data

audio=<binary audio file>
durationSeconds=8.4
```

Supported types are AAC, M4A/MP4 audio, MP3, OGG and WAV. A clip is limited to
10 MiB, and the declared duration must not exceed 120 seconds. The server
validates both the declared MIME type and the file signature. One SOS accepts
up to 20 clips and 100 MiB of audio in total.

An acknowledged helper streams a clip using its `playbackPath`, for example:

```http
GET /v1/sos/:id/recordings/:recordingId
Authorization: Bearer <accessToken>
```

This endpoint returns raw audio rather than the JSON envelope. It requires the
owner or a recipient who has already acknowledged an active SOS. Access for the
recipient ends immediately after resolve/cancel. Owners use `GET /v1/sos/recordings`
for their library and `DELETE /v1/sos/:id/recordings/:recordingId` to remove a
clip. Remaining clips expire from the server after 30 days.
