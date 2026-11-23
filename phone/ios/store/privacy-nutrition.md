# App Privacy

The answers for App Store Connect → the app → App Privacy, why each is
what it is, and the privacy policy its URL points at. The same is
declared in each target's `PrivacyInfo.xcprivacy`.

## What leaves the phone, and where to

| What | To | Why | Kept there |
| --- | --- | --- | --- |
| The APNs push token (with the app's id and your machine's public key) | The push relay (`AMARCHY_RELAY`), when you turn notifications on | To register: the relay seals them into the address your machine sends notifications to | No: the relay keeps nothing; the sealed address is kept by your own machine |
| The phone's push public key (`p256dh`) and auth secret, and that address | Your own amarchy machine | So it can encrypt notifications for this phone only | On your machine, until you turn notifications off |
| Everything you see and do in the app | Your own amarchy machine, over your Tailscale network | It's that machine's app | On your machine, as amarchy keeps it |
| What you share into Amarchy (text, links, pictures) | Your own amarchy machine | To send it to a chat | On your machine, a day at most until a chat takes it |

Nothing goes to the developer. No analytics, no crash reporting, no ads,
no tracking, no third-party SDKs. Notifications are encrypted on your
machine for this phone only (RFC 8291): the relay and Apple's push
service carry them without being able to read them.

## The answers

1. **Do you or your third-party partners collect data from this app?**
   Yes (conservatively: the push token goes to the relay, a server the
   developer runs).
2. **Data types**: Identifiers → **Device ID** only (the push token).
   Nothing else: not contact info, not user content (what you write and
   share goes to *your* machine, never to the developer or the relay), not
   usage data, not diagnostics.
3. For Device ID:
   - **Used for**: App Functionality (delivering the notifications you turned on).
   - **Linked to the user's identity**: No. The relay never learns who you
     are; the token isn't tied to an account.
   - **Used for tracking**: No.

The label then reads: "Data Not Linked to You: Identifiers", and no
"Data Used to Track You".

## Privacy policy

Amarchy (the iPhone app) is a window onto your own amarchy machine. It has
no account, no analytics and no ads, and it sends nothing to its developer.

- **Your machine.** Everything you see in the app comes from, and
  everything you do in it goes to, the amarchy you run on your own machine,
  over your own Tailscale network. That machine keeps your chats, your code
  and what you share into it; you control it.
- **Notifications.** When you turn them on, the app makes a key pair on
  this iPhone (the private key never leaves it), registers Apple's push
  token with the push relay, and gives your machine the public key. The
  relay keeps nothing: it seals the token into an address only your
  machine can send to, and it passes on notifications your machine
  encrypted for this iPhone, which it can't read. It doesn't log tokens or
  contents.
- **The share sheet** sends what you pick to your machine only.
- **Microphone and camera** are used only when you dictate or take a
  photo to send to a chat; what they record goes to your machine.
- **Tracking.** None. No data is sold or shared with anyone.
- **Contact.** https://github.com/ja-818/amarchy/issues
