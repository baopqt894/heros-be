# Heros SOS Backend

NestJS + MongoDB backend for the Heros Swift application. It provides email and
password login, email OTP, Google Sign-In, JWT sessions, user profiles, emergency
contacts, FCM devices, last-known location, SOS creation, acknowledgement and
real-time Socket.IO events.

## Setup

```bash
cp .env.example .env
npm install
npm run start:dev
```

- Production API base: `https://heros.nextteam.site/v1`
- Production Swagger: `https://heros.nextteam.site/api-docs`
- Production health: `https://heros.nextteam.site/v1/health`
- Local API base: `http://localhost:2155/v1`
- Socket.IO namespace: `/sos`

All protected endpoints require `Authorization: Bearer <accessToken>`.

Every response has exactly the same top-level envelope: `success`, numeric HTTP
`code`, and `data`. On failure, the message and stable machine-readable
`errorCode` are returned inside `data`:

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

## Main endpoints

```text
POST   /v1/auth/email/request-otp
POST   /v1/auth/email/verify-otp
POST   /v1/auth/login
POST   /v1/auth/password/reset
POST   /v1/auth/google
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/users

GET    /v1/me
PATCH  /v1/me
PUT    /v1/me/location

POST   /v1/me/devices
DELETE /v1/me/devices/:deviceId

GET    /v1/me/heros-devices
POST   /v1/me/heros-devices
DELETE /v1/me/heros-devices/:hardwareId

GET    /v1/emergency-contacts
POST   /v1/emergency-contacts
GET    /v1/emergency-contacts/invitations
POST   /v1/emergency-contacts/invitations/:id/accept
POST   /v1/emergency-contacts/invitations/:id/decline
DELETE /v1/emergency-contacts/invitations/:id/link
PATCH  /v1/emergency-contacts/:id
DELETE /v1/emergency-contacts/:id

POST   /v1/sos
GET    /v1/sos/active
GET    /v1/sos/incoming/active
GET    /v1/sos/recordings
GET    /v1/sos/:id
PUT    /v1/sos/:id/location
POST   /v1/sos/:id/acknowledge
POST   /v1/sos/:id/recordings
GET    /v1/sos/:id/recordings/:recordingId
DELETE /v1/sos/:id/recordings/:recordingId
POST   /v1/sos/:id/resolve
POST   /v1/sos/:id/cancel
PUT    /v1/sos/:id/sms-status

POST   /v1/device/sos
GET    /v1/device/sos/ping
PUT    /v1/device/status
```

## Authentication

Email OTP codes expire after five minutes by default, can only be attempted five
times and are stored as HMAC hashes. Send `purpose=register`, then call
`POST /v1/users` to create an account. Login OTP only works for an existing user.
Refresh tokens are rotated and only their SHA-256 hashes are persisted.

Include an optional `password` (8-128 characters) in `POST /v1/users` to enable
password login through `POST /v1/auth/login`. Passwords use salted `scrypt`
hashes and are never returned by the API. Accounts created without a password
continue to use email OTP or Google Sign-In.

An existing OTP-only account can request a login OTP and submit it to
`POST /v1/auth/password/reset` with `newPassword`. A successful reset also
returns a new authenticated session.

Google login accepts the Google ID token produced by the Swift application. Its
`aud` must match one of the comma-separated `GOOGLE_CLIENT_IDS` values. This
implementation follows the `google-auth-library` ID-token verification pattern
used by `lms-saas`, while allowing a verified Google identity to create a new
Heros account directly.

## SOS and SMS

New accounts can be `device_owner` or `emergency_contact`. Only a
`device_owner` can create an SOS. Community responders remain reserved for a
future release and are not included in SOS delivery. A device owner can keep up
to ten emergency contacts. Linking an existing `emergency_contact` account with
`linkedUserEmail` creates an invitation that the recipient must accept.

`POST /v1/sos` is idempotent for `(ownerId, clientRequestId)`. Mobile must reuse
the same UUID when retrying a request. The response contains `smsPayload` with
phone recipients and a prebuilt message. Swift opens the native SMS composer;
the backend never claims carrier delivery.

Automatic alerts are sent to accepted emergency-contact accounts through FCM
and to enabled contact email addresses. Socket.IO emits `sos.created`,
`sos.location`, `sos.acknowledged`, `sos.recording`, `sos.resolved` and
`sos.cancelled`.

An alerted user can see the current location on the map. After calling
`POST /v1/sos/:id/acknowledge`, that user can receive live `sos.location`
events, see recording metadata and stream protected audio. Recording access is
revoked as soon as the SOS is resolved or cancelled. Owners can list and delete
their recordings; the server removes remaining clips after 30 days.
Audio is never exposed through the public static-file directory. Each clip is
limited to 10 MiB and its declared duration is limited to 120 seconds. One SOS
can contain up to 20 clips and 100 MiB total audio.

## Physical-device authentication

The mobile FCM registration under `/v1/me/devices` is separate from a physical
HEROS device. A logged-in `device_owner` pairs hardware through
`POST /v1/me/heros-devices`. The response returns a `deviceToken` exactly once;
only its SHA-256 hash is stored. Firmware then creates SOS events through
`POST /v1/device/sos` with `X-Heros-Hardware-Id` and
`X-Heros-Device-Token`. Pairing the same hardware again rotates its token, and
deleting it revokes further device requests.

One owner can pair one physical HEROS device. Firmware reports battery percent,
charging state and its remaining-time estimate through `PUT /v1/device/status`.

## Demo accounts

Run `npm run seed:demo` to create the accepted owner/contact pair. Both accounts
use password and mock OTP `123456`:

- `owner@heros.vn`
- `contact@heros.vn`

See [the complete Vietnamese iOS integration and release guide](docs/IOS_APP_INTEGRATION_AND_RELEASE_VI.md)
for invitations before App Store publication, verified API contracts, TestFlight,
review submission and known release blockers. The older [Swift notes](docs/SWIFT_INTEGRATION.md)
remain supplementary.

## Verification

```bash
npm run lint
npm test -- --runInBand
npm run build
```
