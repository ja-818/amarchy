# App Review notes

App Review must be able to use the app, and the app is a window onto
*your own* amarchy machine on *your own* Tailscale network: without one
it only shows "Can't find your amarchy". So the review needs a demo
machine it can reach. Paste the text below into App Store Connect → the
version → App Review Information → Notes, with the blanks filled.

## What Julian provides first

1. **A demo machine**: amarchy on an always-on box (a small cloud VM is
   enough), with a few made-up chats in a demo project, never real ones or
   real keys: one waiting on a permission, one with a question, one done.
   Its Claude Code may be logged out; the board, the cards and the buttons
   are what the review sees.
2. **A Tailscale login for the reviewer**: a dedicated identity (for
   example a new Google or GitHub account, `amarchy.review@...`) invited to
   the tailnet, with Tailscale's access rules letting it reach only the
   demo machine. Its email and password go in App Review Information →
   Sign-in required.
3. **The demo machine's address** (`https://<demo>.<tailnet>.ts.net`), and
   its link `amarchy://open?server=https://<demo>.<tailnet>.ts.net` (Settings,
   Phone app, in its web app shows it).
4. **Notifications on the demo machine**: the push relay deployed and this
   build's `AMARCHY_RELAY` pointing at it, so the reviewer sees one arrive
   and its buttons work.
5. A short screen recording (a minute) of the same steps, attached in App
   Review Information: reviewers ask for one when a sign-in goes through
   another app.

## Notes for the reviewer

> Amarchy is a management tool for coding agents (Claude Code): it shows
> the Claude Code chats running on the user's own machine, which ones need
> them and what for, and lets them answer from the phone. It reaches that
> machine through the user's Tailscale network (a private network); we've
> set up a demo machine for you.
>
> 1. Install the Tailscale app from the App Store, open it, and sign in
>    with: ____________ / ____________ (Google account). Allow its VPN
>    configuration.
> 2. Open Amarchy. On "Can't find your amarchy", type
>    `____________.ts.net` and tap Open (or open this link on the phone:
>    amarchy://open?server=https://____________.ts.net).
> 3. The board shows the demo chats. "Needs you" filters to the ones
>    waiting on you; tap a card's Allow, or open a chat to read its
>    briefing.
> 4. Notifications: in the app, Settings → Notifications → Turn on, and
>    allow them. Tap "Send a test notification": it arrives encrypted end
>    to end; its buttons (Allow / Deny on a permission) answer without
>    opening the app (Face ID on a locked phone).
> 5. Share sheet: share a screenshot or a link to Amarchy; the app opens on
>    "Send it to a chat".
> 6. Widget: add the Amarchy widget to the home screen or the lock screen:
>    "1 needs you".
>
> The app has no account of its own, collects nothing and shows no ads;
> it uses the microphone only for dictating a message, and the camera
> only when you take a photo to send to a chat.

If the build has amarchy's own Tailscale node (`tailnet.yml`), step 1
becomes "In Amarchy, tap Sign in to Tailscale and sign in with ..." and the
Tailscale app isn't needed.
