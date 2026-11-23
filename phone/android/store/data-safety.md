# Google Play: the Data safety form

What to answer in Play Console → App content → Data safety, and why. The
app is a window on your own amarchy machine: your chats go from that machine
to this phone over your own Tailscale network, never through us.

## Data collection and security

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** (only what notifications need, below) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS everywhere: to the relay, to Google's push, to your machine) |
| Do you provide a way for users to request that their data is deleted? | **Yes**: turning notifications off (in the app, or uninstalling it) deletes the push token; the relay keeps nothing to delete |

## Data types

Only one: **Device or other IDs**.

| | |
| --- | --- |
| What | The phone's push token (Firebase Cloud Messaging's), with the phone's push public key (a P-256 key made on the phone) |
| Collected | **Yes**: it leaves the phone, to the push relay (and Google's FCM, which issues and delivers to it) |
| Shared | **No** (the relay and FCM are service providers delivering for the app; nothing is given to a third party for its own use) |
| Processed ephemerally | **Yes**: the relay keeps nothing. The token is sealed (AES-256-GCM, the relay's secret) into the address your machine pushes to, and only opened to deliver a notification |
| Required or optional | **Optional**: only when you turn notifications on |
| Why | **App functionality** (delivering notifications) |

Firebase Cloud Messaging also uses a Firebase installation ID to issue the
token (Google's own disclosure for FCM: Device or other IDs, app
functionality). It's covered by the same answer.

## Not collected

- **Messages, chats, notification content**: notifications are end-to-end
  encrypted (Web Push, RFC 8291) by your machine for this phone's key; the
  relay and Google carry ciphertext only. The key to read them never leaves
  the phone (it's wrapped by the Android Keystore).
- **Photos, files, text you share**: they go from the phone straight to
  your own machine, over your Tailscale network.
- **Audio**: the microphone is used only by the app's dictation, and what
  it hears goes to your own machine.
- **Location, contacts, personal info, financial info, app activity, web
  browsing, diagnostics, crash logs**: none. No analytics, no ads, no
  crash reporting.
- **No account with us**: you sign in to nothing of ours. Tailscale's own
  sign-in is Tailscale's.

## Security practices

- Data is encrypted in transit: **Yes**.
- You can request that data be deleted: **Yes** (turn notifications off, or
  uninstall).
- Independent security review: **No**.
- Nothing is sold, nothing is used for advertising.

## Privacy policy

Play requires a privacy policy URL: both apps' is
`https://github.com/ja-818/amarchy/blob/main/phone/PRIVACY.md`.
