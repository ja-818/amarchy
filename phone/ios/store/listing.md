# App Store listing

What goes in App Store Connect → the app → its version page and App
Information. Limits are Apple's; the counts are this text's.

## Name (30)

Amarchy

## Subtitle (30)

Manage your coding agents

(25 characters)

## Promotional text (170)

Stop babysitting your agents. Manage them. See which of your Claude Code
chats needs you and what for, answer and ship with a tap, from your phone.

(147 characters)

## Description (4,000)

Stop babysitting your agents. Manage them.

Amarchy is a management tool for coding agents (Claude Code, today) that
lets one person run a dozen of them from a box that never sleeps. This is
its iPhone app: your amarchy, in your pocket.

- A board that says who needs you, and what for. "Needs you" filters to the
  chats waiting on you; the rest keep working.
- Replies that open with a briefing: what happened, what was checked,
  what's on you. The details stay folded until you want them.
- Answers and shipping with a tap. A question, a permission, a plan to
  approve, "Ship it?": they're buttons, on the card and on the
  notification itself, without opening the app.
- Notifications you act on, end-to-end encrypted: they're sealed on your
  machine for this phone only, so the relay that carries them and Apple's
  push service never read them.
- Share into a chat: a screenshot, a link or some text, from any app's
  share sheet.
- A widget on the home screen and the lock screen: "2 need you", and
  which.
- Dictate instead of typing.

Amarchy runs on your own machine: a Linux box that stays on (a server, a
desktop, a machine in a cloud), with Claude Code and amarchy installed
(free and open source: github.com/ja-818/amarchy). This app opens it over
your Tailscale network: you need your own amarchy machine on your tailnet,
and the Tailscale app on this iPhone. Your chats, your code and your keys
stay on your machine.

## Keywords (100, comma separated, no spaces needed)

claude code,coding agents,ai agents,agent manager,claude,tailscale,developer,terminal,git,omarchy

(97 characters)

## URLs

- Support URL: https://github.com/ja-818/amarchy/issues
- Marketing URL: https://github.com/ja-818/amarchy
- Privacy Policy URL: https://github.com/ja-818/amarchy/blob/main/phone/ios/store/privacy-nutrition.md#privacy-policy

## App Information

- Category: Developer Tools; secondary: Productivity
- Age rating: 4+ (none of the questionnaire's content)
- Copyright: 2026 Julian Arango
- Price: free; no in-app purchases
- Export compliance: uses only the encryption in iOS itself (HTTPS, and
  CryptoKit to open its own notifications): `ITSAppUsesNonExemptEncryption`
  is NO in its Info.plist, so App Store Connect doesn't ask on each build.
