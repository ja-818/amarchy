<div align="center">

# Ⓐ amarchy

**Run a dozen Claude Codes at once, each in a chat of its own.**

Talk to Claude in a chat, on your phone or in a computer's browser. Each chat works on its
own copy of a project, so several can work at once without getting in each other's way.
When one of them asks you something or finishes, you know.

[Install](#install) · [Keys](#the-keys-that-matter) · [Full guide](docs/guide.md)

</div>

---

## What you get

- **A chat for each piece of work.** Pick a project, type what you want, and Claude starts on it.
  Each chat has its own copy of the project, so ten chats can change ten things at once.
- **Questions and permissions as buttons.** When Claude needs a yes, a choice or a plan
  approved, it shows a card. You tap a button and it carries on.
- **Knows who needs you.** A chat that is waiting for you says so in the list, and a chime
  plays (or your phone notifies you). Tap the notification and you land on the card.
- **Talk instead of typing.** The mic by the box writes what you say into it. A speech model
  on your own machine does the writing, so the audio stays there.
- **Keys and passwords stay out of the chat.** When a project needs one, Claude asks in an
  app card, and the value is kept on your machine, never in the conversation.
- **Light on memory.** A chat you're not using goes to sleep and frees its memory. Send it
  something and it wakes up where it was.
- **Keeps going with the lid shut.** Run amarchy on a machine that stays on. Your chats keep
  working while your laptop or phone sleeps.
- **On your phone and in your browser.** An app you add to your home screen, and the same
  app on a computer. Both work over your private Tailscale network, not the internet.

## Install

You need a Linux machine that stays on (a server, or a PC at home), with
**[Claude Code](https://docs.claude.com/en/docs/claude-code)** installed and logged in, plus
`git`, `tmux` (3.5 or newer) and `python3`. To use it from your phone or a browser you also
need [Tailscale](https://tailscale.com) on that machine and on your devices, with HTTPS
certificates turned on for your tailnet.

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh
amarchy app on
```

`amarchy app on` prints the address of the app. On your phone, open it in Safari, tap
**Share → Add to Home Screen**, and open amarchy from there. Then add a project: amarchy
offers every git repo in `~/Work`, or clones one of your GitHub repos.

Run `install.sh` again at any time to update. `install.sh --uninstall` removes amarchy and
leaves your projects and chats alone.

## The app

- **The list**: your chats, each with its name, what it's doing ("Needs your answer",
  "Working", "Done", "Ready") and its project. Put them in groups by project, priority or
  status if you like.
- **The chat**: what you said, what Claude says, the steps it took (folded into one line you
  can open), and the cards for its questions and permissions. Under it, the box you type in,
  with the model and how Claude asks for permission.
- **Chat | Terminal**: the project's own terminal, where you run it (`npm run dev`, say). On a
  computer it's a panel beside the chat.
- **Settings**: sleep, sounds, notifications, the look, dictation, secrets and the terminals.

## The keys that matter

On a computer's browser:

| Key | |
| --- | --- |
| `Ctrl+Alt+N` | New chat |
| `Ctrl+Alt+J` / `K` | Next / previous chat |
| `Ctrl+Alt+S` | Search chats |
| `Ctrl+Alt+Space` | Dictate into the chat (hold it, or tap it and tap again) |
| `Ctrl+Alt+←` / `→` | The chat / the terminal |
| `Ctrl+Alt+R` | Run the project in the terminal |
| `Ctrl+Alt+Up` / `Down` | Raise / lower the chat's priority |
| `Ctrl+Alt+Z` | Zen mode: the chat alone |
| `Ctrl+Alt+X` | Close the chat |
| `Ctrl+Alt+M` | **The amarchy menu: everything else, each with its key** |

Every action is also a command: `amarchy help`.

## More

The **[full guide](docs/guide.md)** covers all of it: [how it works](docs/guide.md#how-it-works),
[the chat](docs/guide.md#the-chat), [your phone](docs/guide.md#your-phone),
[the browser](docs/guide.md#in-a-browser-on-your-computer),
[dictation](docs/guide.md#dictation), [secrets](docs/guide.md#secrets),
[sleep](docs/guide.md#sleep), [themes](docs/guide.md#theme), [sounds](docs/guide.md#sound),
[configuration](docs/guide.md#configure) and [the CLI](docs/guide.md#cli).

[MIT](LICENSE)
