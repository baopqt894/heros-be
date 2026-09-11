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

- API base: `http://localhost:2155/v1`
- Swagger: `http://localhost:2155/api-docs`
- Health: `http://localhost:2155/v1/health`
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

GET    /v1/emergency-contacts
POST   /v1/emergency-contacts
PATCH  /v1/emergency-contacts/:id
DELETE /v1/emergency-contacts/:id

POST   /v1/sos
GET    /v1/sos/active
GET    /v1/sos/:id
PUT    /v1/sos/:id/location
POST   /v1/sos/:id/acknowledge
POST   /v1/sos/:id/resolve
POST   /v1/sos/:id/cancel
PUT    /v1/sos/:id/sms-status
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

`POST /v1/sos` is idempotent for `(ownerId, clientRequestId)`. Mobile must reuse
the same UUID when retrying a request. The response contains `smsPayload` with
phone recipients and a prebuilt message. Swift opens the native SMS composer;
the backend never claims carrier delivery.

Automatic alerts are sent through FCM to nearby opted-in responder users and by
email to contacts with email enabled. Socket.IO emits `sos.created`, `sos.location`,
`sos.acknowledged`, `sos.resolved` and `sos.cancelled`.

See [Swift integration](docs/SWIFT_INTEGRATION.md).

## Verification

```bash
npm run lint
npm test -- --runInBand
npm run build
```
