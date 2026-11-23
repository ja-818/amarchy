# Putting the Android app on Google Play

What Julian does by hand, once. After that, CI's release job
(`.github/workflows/phone-android.yml`, run by hand) builds, signs and
uploads each release to the internal testing track.

## 1. Firebase (push)

1. [console.firebase.google.com](https://console.firebase.google.com) → Add
   project (e.g. `amarchy`), Analytics off.
2. Project settings → General → Your apps → Add app → Android, package
   `io.github.ja818.amarchy`. Skip the google-services.json download: the
   build takes the values by hand.
3. From that app's settings, copy four values:
   - Web API key → `FIREBASE_API_KEY`
   - App ID (`1:…:android:…`) → `FIREBASE_APP_ID`
   - Project ID → `FIREBASE_PROJECT_ID`
   - Project number (Cloud Messaging tab: Sender ID) → `FIREBASE_SENDER_ID`
4. For local builds, put them in `phone/android/firebase.properties` (not in
   git), one `NAME=value` per line, with `AMARCHY_RELAY=https://<your relay>`.
5. The relay (`relay/`) sends through FCM's HTTP v1 API for this project:
   give it a service account with the "Firebase Cloud Messaging API Admin"
   role (its own setup).

## 2. The upload key

```sh
keytool -genkeypair -v -keystore amarchy-upload.jks -alias amarchy \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 amarchy-upload.jks      # → ANDROID_KEYSTORE_BASE64
```

Keep the `.jks` and its passwords somewhere safe (a password manager). Play
App Signing holds the real signing key; this one only uploads.

## 3. Play Console

1. [play.google.com/console](https://play.google.com/console) → Create app:
   name "Amarchy", default language English (United States), App, Free.
2. App content: privacy policy URL, ads (none), app access (it needs your
   own amarchy machine: give reviewers a test machine's address, or explain
   it's a companion app), content rating questionnaire, target audience
   (18+), news app (no), Data safety (answers in `data-safety.md`).
3. Store listing: the texts are in `fastlane/metadata/android/en-US/` (the
   first upload sets them by hand; fastlane keeps them in sync after). Add
   the icon (512×512) and at least two phone screenshots.
4. Testing → Internal testing → Create new release → let Google manage the
   app signing key (Play App Signing) → upload the first AAB **by hand**
   (the API can't create the app's first release):
   ```sh
   cd phone/android
   ANDROID_KEYSTORE_BASE64=… ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=amarchy \
   ANDROID_KEY_PASSWORD=… FIREBASE_API_KEY=… FIREBASE_APP_ID=… FIREBASE_PROJECT_ID=… \
   FIREBASE_SENDER_ID=… AMARCHY_RELAY=https://… ./gradlew bundleRelease
   # → app/build/outputs/bundle/release/app-release.aab
   ```
   Add yourself (and testers) to the internal testers list.

## 4. A service account for uploads

1. [console.cloud.google.com](https://console.cloud.google.com) → the
   Firebase project (or any) → IAM & Admin → Service accounts → Create
   (e.g. `play-upload`), no roles there → Keys → Add key → JSON. That file is
   `PLAY_JSON_KEY`.
2. Play Console → Users and permissions → Invite new users → the service
   account's email → app permissions: Amarchy → "Release to testing tracks"
   (and "Manage store presence" for the listing).

## 5. GitHub secrets

Repository → Settings → Secrets and variables → Actions → New repository
secret, each of:

| Secret | What |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the upload keystore, base64 (step 2) |
| `ANDROID_KEYSTORE_PASSWORD` | its password |
| `ANDROID_KEY_ALIAS` | the key's alias (`amarchy`) |
| `ANDROID_KEY_PASSWORD` | the key's password |
| `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID` | step 1 |
| `AMARCHY_RELAY` | the relay's address, `https://…` |
| `PLAY_JSON_KEY` | the service account's JSON key, as it is (step 4) |

## 6. Each release

Actions → "Android app" → Run workflow, with "Upload to Play's internal
track" ticked. Its version code is the run number plus 100, so each upload
is newer than the last; the version name is the one asked for (default
`1.0`). Promote it from internal to production in Play Console when it's
good.
