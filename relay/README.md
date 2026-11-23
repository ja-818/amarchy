# amarchy-relay

amarchy's phone apps get notifications from your machines. A web page gets
them through its browser's push service; a native app can only get them from
Apple's (APNs) or Google's (FCM), and only a sender holding the app's keys can
reach those. `amarchy-relay` is that sender, and nothing more: a small Web
Push service (RFC 8030) in front of APNs and FCM. Your machine sends to it
exactly as it sends to a browser's push service, encrypted for the phone
(RFC 8291), and the relay hands the encrypted record to Apple or Google as it
came. It keeps nothing. It's open source so you can read what it does, and
run your own.

## What it sees, and what it never sees

It sees:

- the phone's push token (an APNs device token, or an FCM token);
- the app's id (`io.github.ja818.amarchy`);
- your machine's public key (its VAPID key, which signs what it sends);
- when a push comes, how big it is, and the address it comes from.

It never sees what a notification says. Your machine encrypts it with a key
only the phone has. The relay can't decrypt it, and refuses anything that
isn't encrypted that way (`Content-Encoding: aes128gcm`). Apple and Google
see the same encrypted record, and the words the phone shows when it can't
decrypt: "Amarchy", "Something needs you".

It keeps nothing:

- No database. The endpoint it gives a phone holds the token, the app and the
  machine's key, sealed with the relay's secret (AES-256-GCM). It opens it
  when a push comes, and forgets it.
- In memory only: its rate limits, by a hash of each endpoint and each
  address.
- Its log: one line a request. The method, what it was (register, push,
  health), the status, the device (the first 8 hex digits of its endpoint's
  SHA-256), what APNs or FCM answered, and how long it took. Never a token, an
  endpoint, a payload or a JWT.

## The API

`POST /v1/register` (JSON, 4 KB at most), from the phone app:

```json
{"platform": "apns", "token": "<hex>", "app": "io.github.ja818.amarchy", "server_key": "<the machine's VAPID key>"}
```

`platform` is `apns`, `apns-sandbox` (an app built by Xcode) or `fcm`. It
answers `200 {"endpoint": "https://<relay>/v1/push/<handle>"}`. The phone
gives that endpoint to its machine as any browser's subscription.

`POST /v1/push/<handle>`, from the machine, as to any Web Push service:

- `Content-Encoding: aes128gcm`, a body of 2,900 bytes at most, shaped like
  one aes128gcm record;
- `Authorization: vapid t=<JWT>, k=<key>`: `k` is the key the endpoint was
  made for, the JWT is ES256, its `aud` is the relay's address, its `exp`
  within 24 hours;
- `TTL` (seconds, required, 28 days at most), `Urgency` (`very-low`, `low`,
  `normal`, `high`), `Topic` (optional, 32 base64url characters at most: a
  newer push with the same topic replaces the older).

| Answer | Why |
| --- | --- |
| 201 | Sent. `Location: /v1/message/<id>`, and the `TTL` it used |
| 400 | A header or the body isn't right |
| 401 | No VAPID, or its JWT doesn't verify, or expired |
| 403 | Signed with another key than the endpoint's, or for another `aud` |
| 404 | Not an endpoint this relay made |
| 410 | APNs or FCM says the phone is gone: drop it |
| 413 | Over 2,900 bytes |
| 415 | Not `aes128gcm` |
| 429 | Over a limit: `Retry-After` says when to try again |
| 502 | APNs or FCM failed (the words say how) |
| 503 | This relay doesn't send to that platform |

`GET /v1/health` answers `{"ok": true, "apns": true, "fcm": true}`: which it
sends to. `GET /` says what it is.

Limits, per device: 30 pushes at once, then 15 a minute. Per address: 20
registrations, then 20 an hour; 300 pushes, then 600 a minute.

## Configuration

All from its environment. `amarchy-relay check` says what's set, and what's
wrong, never a secret.

| Variable | |
| --- | --- |
| `RELAY_URL` | Required. Its public address, like `https://relay.example.com`: endpoints start with it, and machines sign for it |
| `RELAY_SECRET` | Required, 32 characters or more: `amarchy-relay secret` makes one. Keep it: endpoints open only with it |
| `RELAY_SECRETS` | Older secrets, comma separated: endpoints made with them still open |
| `RELAY_OLD_URLS` | Older addresses, comma separated: endpoints phones hold there still work |
| `PORT`, `RELAY_LISTEN` | Where it listens: `:$PORT` (8080), or `RELAY_LISTEN` (`127.0.0.1:8099`) |
| `RELAY_TRUST_PROXY` | `1` behind a proxy that appends the client's address to `X-Forwarded-For` (Cloud Run, Caddy, nginx) |
| `RELAY_CLIENT_IP_HEADER` | A header the proxy puts the client's address in instead (`Fly-Client-IP`) |
| `APNS_KEY` or `APNS_KEY_FILE` | Apple's `.p8` key: its contents (PEM, or the base64 inside it) or its path |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | The key's id, and your Apple team's |
| `APNS_TOPICS` | The iPhone apps it sends for: bundle ids, comma separated |
| `APNS_URL`, `APNS_SANDBOX_URL` | Apple's push service (`https://api.push.apple.com`, `https://api.sandbox.push.apple.com`) |
| `FCM_PROJECT` | Your Firebase project's id: FCM is on with it |
| `FCM_CREDENTIALS` | A service account's key (its JSON, or a path to it). Unset on Google Cloud: it uses the service's own account |
| `FCM_APPS` | The Android apps it sends for: package names, comma separated (unset: any) |
| `FCM_URL`, `FCM_TOKEN_URL`, `FCM_METADATA_URL` | Google's addresses, for tests |
| `RELAY_DEVICE_BURST`, `RELAY_DEVICE_PER_MIN` | A device's limit (30, 15) |
| `RELAY_REGISTER_BURST`, `RELAY_REGISTER_PER_HOUR` | An address's registrations (20, 20) |
| `RELAY_PUSH_BURST`, `RELAY_PUSH_PER_MIN` | An address's pushes (300, 600) |

APNs and FCM are each optional. Half of one set up is an error, so it never
starts quietly without what you meant to give it. A configuration problem
exits with 2.

## Run it

### On your computer

```sh
cd relay
export RELAY_SECRET=$(go run ./cmd/amarchy-relay secret)
RELAY_URL=http://127.0.0.1:8099 RELAY_LISTEN=127.0.0.1:8099 go run ./cmd/amarchy-relay
curl http://127.0.0.1:8099/v1/health
```

### On Google Cloud Run, free

One instance, none while idle: it fits Cloud Run's free tier, and Secret
Manager's, Cloud Build's and Artifact Registry's for its three secrets and
its small image. Cloud Run still needs a billing account on the project.

1. A Google Cloud project with billing on. For Android, add Firebase to it
   (console.firebase.google.com, Add project, pick it): its project is FCM's.
2. For iPhone, an APNs key: developer.apple.com, Certificates, IDs &
   Profiles, Keys, +, "Apple Push Notifications service (APNs)". Download the
   `.p8` (only once), and note its Key ID and your Team ID (Membership).
3. `gcloud auth login`, then, from the repo:

   ```sh
   APNS_KEY_FILE=~/Downloads/AuthKey_XXXXXXXXXX.p8 APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=YYYYYYYYYY \
     relay/deploy/cloudrun/deploy.sh <project-id>
   ```

4. It prints the relay's address. Build the phone apps with it:
   `AMARCHY_RELAY=<address>` (`phone/README.md`, "Builds").

What the script does, saying each step: checks your key with
`amarchy-relay check` before anything else; turns on the APIs it uses; makes
the service its own account, which may read its secrets and send with FCM
(Firebase Cloud Messaging Admin, so no FCM key file); keeps the relay's
secret (made for it) and the APNs key in Secret Manager; builds the image from
`relay/` and deploys it with at most one instance (its limits live in its
memory), none while idle, the smallest size, open to everyone;
`RELAY_URL` set to the service's address; then asks it `/v1/health`.

Run it again any time: it changes only what's different. Without
`APNS_KEY_FILE` it leaves APNs as it is. `FCM=off` turns FCM off.
`RELAY_URL=https://relay.example.com` moves it to your own domain (map it
first: `gcloud beta run domain-mappings create`); the old address keeps
working for the endpoints phones hold (`RELAY_OLD_URLS`).
`ROTATE_SECRET=1` makes a new secret, and keeps the old one opening the
endpoints it made (`RELAY_SECRETS`). Its log:
`gcloud run services logs read amarchy-relay --region us-central1 --project <project-id>`.

### On Fly.io

`relay/deploy/fly.toml` has the steps at its top: one machine, stopped while
idle. FCM needs a service account's key there (`FCM_CREDENTIALS`), as Fly has
no Google metadata server.

### On your own server

`relay/deploy/amarchy-relay.service` is a systemd unit (its own throwaway
user, no files, no privileges), with its configuration in
`/etc/amarchy-relay.env` (`relay/deploy/amarchy-relay.env.example`). Put it
behind a reverse proxy that serves HTTPS, with `RELAY_TRUST_PROXY=1`. The
unit's top says how to install it. Or the image: `docker build -t
amarchy-relay relay/`, then run it with the same variables.

## Your own relay means your own apps

Push credentials are bound to the app. An APNs key sends only to apps of its
Apple team, by their bundle ids. An FCM token belongs to the Firebase project
the app was built with. So a relay can send only to apps built with its keys:
the published amarchy apps use the project's relay. To run your own, build
the apps yourself: the iPhone app with your bundle id and team (and your APNs
key in your relay's `APNS_TOPICS`), the Android app with your Firebase
project, and `AMARCHY_RELAY` set to your relay's address.

## Development

```sh
cd relay
go vet ./...
go test -race ./...
```

Only Go's standard library. The tests run the relay as it's deployed (from
its environment) against a fake APNs (HTTP/2 over TLS, checking the provider
token as Apple does), a fake FCM, OAuth token server and metadata server. They
decrypt every record in `phone/testdata/push-vectors.json` as the phones do,
send records through the relay and decrypt what APNs and FCM got, check every
refusal, limit and upstream answer above, and that the log never holds a
token, an endpoint, a payload or a JWT. `.github/workflows/relay.yml` runs
them, builds it, and builds its image.
