# Signing, TestFlight and the App Store

Everything here is prepared and has never run: nothing signs, uploads or
publishes until you do the steps below and start the workflow's `release`
job by hand. CI's builds and tests need none of it.

| | |
| --- | --- |
| `listing.md` | The App Store page: name, subtitle, promotional text, description, keywords, URLs, category |
| `privacy-nutrition.md` | App Privacy's answers, why, and the privacy policy its URL points at |
| `review-notes.md` | What App Review needs (a demo machine it can reach) and the notes to paste |
| `../fastlane/` | `fastlane beta`: signs a Release build and uploads it to TestFlight |

**The one way it signs**: an Apple Distribution certificate you make once
(its `.p12` in a GitHub secret), and an App Store Connect API key that makes
the four App Store provisioning profiles (the app and its three extensions)
and uploads the build. No Apple ID password and no `match` repository.

## Once: the developer portal (developer.apple.com → Certificates, IDs & Profiles)

1. **Identifiers → App Groups → +**: `group.io.github.ja818.amarchy`
   ("Amarchy").
2. **Identifiers → App IDs → + → App**, explicit, four of them:

   | Bundle ID | Description | Capabilities |
   | --- | --- | --- |
   | `io.github.ja818.amarchy` | Amarchy | App Groups (the group above), Push Notifications, Time Sensitive Notifications |
   | `io.github.ja818.amarchy.notifications` | Amarchy Notifications | App Groups (the group), Time Sensitive Notifications |
   | `io.github.ja818.amarchy.widget` | Amarchy Widget | App Groups (the group) |
   | `io.github.ja818.amarchy.share` | Amarchy Share | App Groups (the group) |

   (Keychain sharing between the app and its notification extension needs
   nothing here: it's the team's own group, `<team>.io.github.ja818.amarchy.shared`.)
3. **Keys → +**: "Amarchy push", Apple Push Notifications service (APNs).
   Download the `.p8` (once). It's the relay's, not GitHub's: the relay's
   `APNS_KEY` (the file's text), `APNS_KEY_ID`, `APNS_TEAM_ID` (your team),
   `APNS_TOPICS=io.github.ja818.amarchy`.
4. **Certificates → + → Apple Distribution**. It asks for a certificate
   signing request; on any machine with openssl:

   ```sh
   openssl req -new -newkey rsa:2048 -nodes -keyout dist.key -out dist.csr \
     -subj "/CN=Julian Arango/emailAddress=<your Apple ID email>/C=US"
   ```

   Upload `dist.csr`, download `distribution.cer`, then make the `.p12`:

   ```sh
   openssl x509 -inform der -in distribution.cer -out dist.pem
   openssl pkcs12 -export -legacy -inkey dist.key -in dist.pem -out dist.p12   # asks for a password: keep it
   base64 -w0 dist.p12 > dist.p12.b64
   ```

   Keep `dist.key` and `dist.p12` somewhere safe, never in git.

## Once: App Store Connect (appstoreconnect.apple.com)

5. **Apps → + → New App**: iOS, name `Amarchy`, primary language English
   (U.S.), bundle ID `io.github.ja818.amarchy`, SKU `amarchy-ios`, full
   access.
6. **Users and Access → Integrations → App Store Connect API → Team Keys →
   +**: name "amarchy CI", access **Admin** (it makes the provisioning
   profiles; App Manager is enough once they exist). Download the `.p8`
   (once), and note its Key ID and the Issuer ID above the list.

## Once: the GitHub secrets (github.com/ja-818/amarchy → Settings → Secrets and variables → Actions)

| Secret | Its value |
| --- | --- |
| `ASC_KEY_ID` | The API key's Key ID (step 6) |
| `ASC_ISSUER_ID` | The Issuer ID (step 6) |
| `ASC_KEY_P8` | The API key's `.p8` file, as it is (`-----BEGIN PRIVATE KEY-----`...) |
| `APPLE_TEAM_ID` | Your team's ID (10 characters: Membership details) |
| `IOS_DIST_CERT_P12` | `dist.p12.b64`'s text (step 4) |
| `IOS_DIST_CERT_PASSWORD` | The `.p12`'s password |
| `AMARCHY_RELAY` | The push relay's address, `https://...` (built into the app: its notifications go through it) |

From a terminal: `gh secret set ASC_KEY_P8 < AuthKey_XXXX.p8`, `gh secret
set IOS_DIST_CERT_P12 < dist.p12.b64`, `gh secret set ASC_KEY_ID` (it asks).

## Each TestFlight build

7. GitHub → Actions → **iPhone app** → **Run workflow** → branch `main`,
   tick **release** → Run. It builds and tests first, then `fastlane beta`:
   the profiles (made the first time), a Release build numbered after
   TestFlight's last (with amarchy's own Tailscale node when the "Tailscale
   node" workflow on main has built it), signed, uploaded. About 25 minutes.
8. App Store Connect → the app → **TestFlight**: the build shows after
   Apple processes it (10 to 30 minutes). Add yourself to an internal
   testing group; on the iPhone, the TestFlight app installs it.

On a Mac instead: the same environment variables, then
`cd phone/ios && ./generate.sh && fastlane beta`.

## Before the App Store

9. The version page: `listing.md`'s text; screenshots of a 6.9" iPhone
   (1320 × 2868): the CI run's `phone-ios-screenshots` artifact has the
   simulator's, from demo chats only.
10. App Privacy: `privacy-nutrition.md`.
11. App Review Information: `review-notes.md` (a demo machine and a
    Tailscale login for the reviewer, which you set up first).
