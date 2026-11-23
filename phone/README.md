# The phone apps

amarchy's app on iPhone and Android: a thin native shell around the same app
the browser shows (`app/`, served by your amarchy), never a second UI. What a
shell adds is only what a web page can't do on a phone:

- **Notifications you act on**: Allow, Deny, a question's answer, Ship it, on
  the notification itself, without opening the app; end-to-end encrypted, so
  the push relay (`relay/`) and Apple's and Google's push never read them.
- **The share sheet**: a screenshot, a link or some text, straight into
  amarchy's "Send it to a chat".
- **A widget**: "2 need you" on the home screen and the lock screen.

The contract (what the page, the shell, the machine and the relay say to each
other) is in [the plan](../docs/plan-omarchy-and-machines.md), "The phone apps
and the push relay". This file is the shells' side of it, in detail: both
shells do exactly this.

| | |
| --- | --- |
| `ios/` | The iPhone app: Swift, an XcodeGen project (`project.yml`), iOS 17 and newer. The app, its Notification Service Extension, its widget, its Share Extension |
| `android/` | The Android app: Kotlin, Gradle, Android 8 (API 26) and newer |
| `testdata/push-vectors.json` | Notifications encrypted as the server encrypts them, and RFC 8291's example, that every side decrypts in its tests (`make-vectors.py` makes them) |

## What a shell is

- **One web view** on the machine's app, `https://<machine>.<tailnet>.ts.net/`
  (the address it keeps, below). Pages of that origin stay in it; any other
  link opens in the system's browser (Safari, or a Custom Tab).
- **Its own page** while it isn't showing amarchy: the desktop app's own,
  `desktop/dist/` (the same files, copied into the app when it's built), driven
  through `window.amarchyShell.invoke(command, args)` → a promise, set before
  its scripts run. Its commands are the desktop's:
  - `status` → `{"kind": "opening"|"choose"|"nothing"|"failed"|"signin",
    "label", "why", "machines": [{"name", "label", "url"}], "waiting"}`
    (polled every half second);
  - `choose {"name"}` (one of `machines`), `use_address {"address"}` (typed:
    `amarchy.tail1234.ts.net`, with or without `https://`), `retry`,
    `sign_in` (Tailscale's login page, in the system's browser sheet).
  `nothing`: no address yet, or none answers, and the Tailscale app's VPN
  isn't on: `why` says to turn it on (or sign in here, with the app's own
  node, when the build has it). `failed`: the address didn't answer.
- **The bridge**: `window.amarchyPhone`, set before the app's scripts run, on
  the machine's origin only (iOS: a `WKUserScript` at document start, for the
  main frame, and a `WKScriptMessageHandlerWithReply` that checks the
  message's frame is the main frame on that origin; Android: androidx.webkit's
  `addDocumentStartJavaScript` and `addWebMessageListener`, both with that
  origin as their only allowed rule):

  ```js
  window.amarchyPhone = {
    version: "1.0 (12)", platform: "ios" /* or "android" */, relay: "https://relay.example",
    call(command, args) { /* → Promise of the answer, rejected with Error(message) */ },
  };
  ```

  | Command | Args | Answer |
  | --- | --- | --- |
  | `push.state` | | `"on"` (allowed, and subscribed), `"off"`, `"denied"` (the system's settings block it), `"unsupported"` (no relay in this build, or no push service on the phone) |
  | `push.subscribe` | `{"key"}`: the machine's VAPID key (base64url, 65 bytes) | `{"endpoint", "keys": {"p256dh", "auth"}, "app": {"platform", "version", "device"}}` |
  | `push.unsubscribe` | | `{"endpoint"}` it dropped, or `null` |
  | `notes.clear` | `{"tags": ["<tag>", ...]}` | `null`: those notifications are off the screen |
  | `status` | `{"needs", "chats": [{"key", "name", "why"}]}` | `null`: kept for the widget (and the badge, `needs`) |

  The shell tells the page with an event:
  `window.dispatchEvent(new CustomEvent("amarchy-open", {detail: {go, ask, share}}))`:
  `go` a route (`/#/s/<key>`) to open, `ask` the chat whose card to show
  (a notification tapped), `share: true` (something was just shared: the page
  looks for it). When the page isn't loaded yet it loads
  `<server>/?ask=<ask>#/s/<key>` instead.

## Notifications

1. **Turning them on** (`push.subscribe`, the page's "Turn on notifications"):
   - the system's permission (iOS `requestAuthorization([.alert, .sound,
     .badge])`; Android 13+ `POST_NOTIFICATIONS`), while it's still the tap;
   - the phone's push token (APNs device token as lowercase hex; FCM token);
   - the phone's keys, made once and kept: a P-256 key pair and a 16-byte
     auth secret (iOS: the Keychain, in the access group the extension shares,
     `kSecAttrAccessibleAfterFirstUnlock`; Android: the private key and the
     secret wrapped by an AES key in the Android Keystore, in the app's own
     storage). They never leave the phone; `p256dh` is the public key's 65
     uncompressed bytes, base64url;
   - registered with the relay: `POST <relay>/v1/register` `{"platform":
     "apns"|"apns-sandbox"|"fcm", "token", "app": "<bundle id or package>",
     "server_key": "<key>"}` → `{"endpoint"}` (`apns-sandbox` for a debug
     build: Xcode's runs get development tokens);
   - kept: `{server, key, endpoint}`, so the token changing (FCM's
     `onNewToken`, a new APNs token at launch) registers again and the shell
     tells that machine itself: `POST <server>/api/push` with the new
     subscription, then `POST <server>/api/push/remove` `{"endpoint": old}`,
     with `Origin: <server>` and `Content-Type: application/json`.
2. **One arrives**: APNs gives the extension `p`; FCM gives the messaging
   service `data.p`: base64url of an RFC 8291 aes128gcm record (salt 16,
   record size 4, key id length 1 = 65, the server's one-time key 65, then
   the ciphertext with its 16-byte tag). Decrypt: ECDH(phone's private key,
   that key); `IKM = HKDF(salt: auth, ikm: secret, info: "WebPush: info\0" ||
   p256dh || server key, 32)`; `CEK = HKDF(salt, IKM, "Content-Encoding:
   aes128gcm\0", 16)`; `NONCE = HKDF(salt, IKM, "Content-Encoding:
   nonce\0", 12)`; AES-128-GCM open; strip trailing zeros, then the `0x02`
   delimiter. The plaintext is JSON:

   ```json
   {"title": "Fix the login", "body": "Asks: Allow Bash: npm test?\nHouston Os",
    "tag": "houston-os-fix-login", "url": "/#/s/houston-os-fix-login",
    "ask": "houston-os-fix-login", "waiting": 2, "urgent": false,
    "server": "https://amarchy.example.ts.net", "session": "houston-os-fix-login", "sound": "chime",
    "actions": [{"label": "Allow", "path": "/api/session/houston-os-fix-login/answer",
                 "body": {"request_id": "r1", "choice": "allow"}}]}
   ```

   Every field but `title` may be missing. Shown: the title and the body; one
   per `tag` (a newer one replaces it: on iOS the relay's `apns-collapse-id`,
   the tag's hash from `Topic`, and `threadIdentifier` is the tag; Android
   the notification's tag); the badge is
   `waiting` (when it's there); `urgent`: iOS time-sensitive, Android a
   heads-up that stays; the actions as buttons (iOS: a category made for
   these labels, `amarchy.<hash>`, registered from the extension before it
   hands the notification over, each action `.authenticationRequired`;
   Android: up to three `NotificationCompat.Action`s, each
   `setAuthenticationRequired(true)`). `waiting` also goes to the widget.
   Nothing to decrypt with, or it doesn't decrypt: "Amarchy" / "Open it to
   see", nothing else.
3. **A button**: `POST <server><path>` with `body` as JSON, `Origin:
   <server>`, `Content-Type: application/json`, from the shell (iOS starts the
   app in the background for it; Android's broadcast receiver, `goAsync`),
   with 20 seconds to answer. It worked: the notification goes. It didn't:
   a notification "Couldn't send <label>" / "Open the chat to answer", tapped
   opens it.
4. **Tapped**: the app opens on `url`, on the card when there's `ask`
   (`amarchy-open`, above).

## Reaching your machine

The machine's address is kept by the shell (the last one that answered). It
gets it from `amarchy://open?server=<https url>` (Settings → Phone app in the
web app has it), typed on its own page, or, with the app's own node, found on
the tailnet (each peer's `GET /api/peer/hello`). It reaches it:

- **through the Tailscale app**, when its VPN is on: everything to `*.ts.net`
  just goes;
- **else through amarchy's own node in the app** (`tailnet/mobile`, gomobile),
  when the build has it: its proxy on `127.0.0.1` set on the web view (iOS 17
  `WKWebsiteDataStore.proxyConfigurations`, Android androidx.webkit
  `ProxyController`) and on the shell's own requests, only for tailnet names
  and addresses. The build has it when the node's library is in place:
  `phone/android/app/libs/tailnet.aar` and
  `phone/ios/Frameworks/Tailnet.xcframework`, each the "Tailscale node"
  workflow's artifact (`tailnet-android`, `tailnet-ios`), or bound here from
  `tailnet/`: `gomobile bind -target=android -androidapi 26 -trimpath
  -ldflags "-s -w" -o tailnet.aar ./mobile` (the Android NDK), and
  `-target=ios,iossimulator -iosversion 17.0 -o Tailnet.xcframework` on a Mac
  with Xcode. On Android it stands in for what Android keeps from an app's
  own code (its network interfaces, its DNS) with Tailscale's `androidbin`.
  The phones' CI builds take the newest one built on main by themselves.

`amarchy://chat/<machine>/<id>` opens that chat (`#/s/<id>` when `<machine>`
is the machine it opens, else `#/s/<machine>:<id>`).

## The share sheet

iOS: a Share Extension (text, links, up to 20 pictures) puts what you share
in the app group's inbox and opens the app (`amarchy://share`); Android: the
app takes `ACTION_SEND` and `ACTION_SEND_MULTIPLE` (text, pictures). The app
sends it to the machine as the iPhone's Shortcut does: `POST <the share
address>` (`GET <server>/api/share/key` → `{"url"}`, kept), a
`multipart/form-data` form with `text` and one `images` file per picture, then
tells the page (`amarchy-open` with `share: true`), which shows "Send it to a
chat". Not sent (the machine out of reach): kept in the inbox, sent the next
time the app opens.

## The widget

"2 need you" and the first chats' names (`status` from the page; `waiting`
from each notification), tapped opens the app (on that chat, for a chat's
line). iOS: WidgetKit, `systemSmall`, `systemMedium`, and the lock screen's
`accessoryCircular`, `accessoryRectangular`, `accessoryInline`, reading the
app group's `status.json` and reloaded by the app and the extension; Android:
an app widget, updated the same way.

## Builds

- Android: `cd phone/android && ./gradlew assembleDebug testDebugUnitTest lint`
  (JDK 17, the Android SDK). Push needs a Firebase project: its values come
  from `phone/android/firebase.properties` (not in git) or the build's
  environment (`FIREBASE_*`); without them the app builds and runs, and says
  notifications aren't in this build. In CI, `.github/workflows/phone-android.yml`
  builds it, runs its tests and lint; run by hand, it releases it to Play's
  internal track (`android/store/README.md` says what's set up first).
- iOS: on a Mac, `cd phone/ios && xcodegen && xcodebuild ...`; in CI,
  `.github/workflows/phone.yml` builds it for the simulator and runs its
  tests.
- The relay's address is built in: `AMARCHY_RELAY` (iOS: a build setting,
  in the app's `Info.plist` as `AmarchyRelay`; Android: a Gradle property or
  the environment, `BuildConfig.AMARCHY_RELAY`). Without it, notifications
  are "unsupported" in that build.
