# Amarchy's phone apps: privacy

Last changed: 2026-11-23.

Amarchy is open-source software you run on your own computers. The iPhone and
Android apps show your own amarchy, on your own machine, over your own
Tailscale network. We (the people who make amarchy) run no accounts, no
analytics, no ads and no trackers, and we never see your chats.

## What the apps send, and to whom

- **To your own amarchy machine** (over Tailscale): everything the app shows
  and does, as the web app does in a browser. It's yours: it never reaches us.
- **To amarchy's push relay**, only if you turn notifications on: your
  phone's push token (from Apple or Google), the app's id, and your machine's
  public key (which proves a notification comes from your machine). The relay
  hands notifications to Apple's or Google's push service. **It can't read
  them**: your machine encrypts each one for your phone alone, and only the
  phone holds the key to read it. The relay keeps no database; it writes one
  log line per request (what kind, how it went, how long it took, and a
  shortened hash of the device), never a token or what a notification says.
  The relay's host (Google Cloud) may keep its own request logs, with the
  address a request came from.
- **To Apple (APNs) or Google (Firebase Cloud Messaging)**: what any app's
  notifications go through. They get the encrypted notification and the words
  shown if it can't be decrypted ("Amarchy", "Something needs you").
- **To Tailscale**, only if you sign in inside the app (amarchy's own node,
  instead of the Tailscale app): what any Tailscale device sends Tailscale,
  under [Tailscale's privacy policy](https://tailscale.com/privacy-policy).

## What stays on the phone

The keys that decrypt your notifications (made on the phone, never sent
anywhere), the address of your amarchy, what you share into the app until it
reaches your machine, and the widget's count.

## Your choices

Turn notifications off in the app's Settings (or the phone's): the app forgets
its relay address, and your machine stops sending. Deleting the app deletes
everything it kept. You can run your own relay, and build the apps to use it
([relay/README.md](../relay/README.md)).

## Contact

[github.com/ja-818/amarchy/issues](https://github.com/ja-818/amarchy/issues).
