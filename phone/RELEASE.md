# Shipping the phone apps: what only you can do

Everything is built and tested in CI. What's left needs your accounts, so
it's yours, in this order. About an hour the first time; after that, a
release is **Run workflow** with **release** ticked.

| What | Where its details are |
| --- | --- |
| The push relay, on Google Cloud Run's free tier | [relay/README.md](../relay/README.md) |
| The iPhone app: signing, TestFlight, the App Store | [ios/store/README.md](ios/store/README.md) |
| The Android app: Firebase, Play | [android/store/README.md](android/store/README.md) |
| The privacy policy both stores link to | [PRIVACY.md](PRIVACY.md) |

## 1. Google Cloud and Firebase (15 min)

1. [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** `amarchy` (Analytics off). It's a Google Cloud project
   too: note its **project id**.
2. **Add app → Android**, package `io.github.ja818.amarchy`. Skip
   `google-services.json`. Copy its **API key**, **App ID**, **Project ID**
   and **Sender ID** (step 4's secrets).
3. [console.cloud.google.com](https://console.cloud.google.com) → that
   project → **Billing**: link an account (Cloud Run asks for one even on its
   free tier; the relay stays inside it). A $1 budget alert if you like.

## 2. Apple (20 min)

[ios/store/README.md](ios/store/README.md), steps 1 to 6: the app group,
the four App IDs, the **APNs key** (`.p8`, for the relay), the Apple
Distribution certificate (`.p12`, for CI), the App Store Connect app record,
and an App Store Connect **API key** (Admin).

## 3. Deploy the relay (10 min)

On a computer with [gcloud](https://cloud.google.com/sdk/docs/install)
signed in (`gcloud auth login`), from this repo:

```sh
APNS_KEY_FILE=~/Downloads/AuthKey_XXXXXXXXXX.p8 APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=YYYYYYYYYY \
  relay/deploy/cloudrun/deploy.sh <your-project-id>
```

It prints the relay's address (`https://amarchy-relay-….run.app`). Check
`<address>/v1/health` says `"apns": true, "fcm": true`.

## 4. GitHub secrets (5 min)

[github.com/ja-818/amarchy/settings/secrets/actions](https://github.com/ja-818/amarchy/settings/secrets/actions),
one each (`gh secret set NAME < file` works too):

| Secret | What |
| --- | --- |
| `AMARCHY_RELAY` | The relay's address (step 3) |
| `APPLE_TEAM_ID` | Your Team ID |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | The App Store Connect API key (its `.p8`, as it is) |
| `IOS_DIST_CERT_P12`, `IOS_DIST_CERT_PASSWORD` | The Distribution certificate, base64, and its password |
| `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_SENDER_ID` | Step 1 |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Your upload key ([android/store/README.md](android/store/README.md) step 2: one `keytool` command; keep it forever) |
| `PLAY_JSON_KEY` | Play's service account (step 6) |

## 5. iPhone: TestFlight (10 min, then Apple's processing)

**Actions → iPhone app → Run workflow**, branch `main`, tick **release**.
App Store Connect → **TestFlight** → add yourself as an internal tester (no
review for internal testers) → install with the TestFlight app.

Then on the iPhone: in Safari, open your amarchy → **Settings → The phone
app → Open in the app**; **Turn on notifications**; remove the home-screen
web app (hold its icon, **Remove App**), or every notification comes twice.

## 6. Android: Play internal testing (15 min)

[android/store/README.md](android/store/README.md), steps 3 and 4: create
the app in Play Console, upload the first `.aab` by hand (Play's rule), make
the service account (`PLAY_JSON_KEY`). From then on, **Actions → Android app
→ Run workflow**, **release** ticked, uploads each one.

## 7. Public, later

- **App Store**: [ios/store/review-notes.md](ios/store/review-notes.md):
  Apple's reviewers need a demo machine they can reach, with a Tailscale
  login of their own. The listing, privacy answers and screenshots are ready
  in [ios/store/](ios/store/).
- **Play**: the listing, screenshots and feature graphic are in
  `android/fastlane/metadata/`; Data safety answers in
  [android/store/data-safety.md](android/store/data-safety.md).
