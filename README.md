<div align="center">

# Ⓐ amarchy

**Run a dozen Claude Codes at once on your server, and drive them from your phone and your browser.**

Each session gets its own git worktree and a terminal beside it.
Your phone buzzes when one of them needs you.

[Install](#install) · [Keys](#keys-in-the-browser) · [Full guide](docs/guide.md)

</div>

---

## What you get

- **New agent in one line.** Say what it should do, pick a project, send. You get a fresh worktree and branch, with Claude in it and a terminal beside it.
- **Keeps going with the lid shut.** Sessions run in tmux on your server, so they keep working while your laptop sleeps and your phone is in your pocket.
- **On your phone.** A home-screen app to read, answer and start sessions. Claude's questions show up as buttons, you can dictate, paste a picture, and get push notifications.
- **In your browser.** The same app on a Mac's wide screen: your sessions on the left, Claude's real terminal in the middle and the session's terminal on the right, all on keys.
- **Agents that start agents.** Ask one Claude to start a session per GitHub issue, and they all appear in the list, each on its own branch.
- **Knows who needs you.** It notifies you when a session asks a question. Sessions that finished and that you haven't opened yet are marked, so you can tell them from the ones you've read.
- **Sessions you can find.** They're listed by what they're about (**Login:** redirect loop), with search, priorities, and grouping by project, priority or status.
- **Light on memory.** Idle sessions that aren't open anywhere sleep and free their memory. Send them something and they wake up mid-conversation.

It's private: the app is only on your [Tailscale](https://tailscale.com) network, and it only answers your own Tailscale login.

## Install

On a Linux server with **python3**, **git**, **tmux 3.5+**, **[Claude Code](https://docs.claude.com/en/docs/claude-code)** (logged in) and **Tailscale** (with HTTPS certificates turned on for your tailnet):

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh
amarchy app on        # prints the app's address, https://<server>.<tailnet>.ts.net
```

- **iPhone:** open that address in Safari, then Share → **Add to Home Screen**. Open it from the home screen and turn on notifications in its settings.
- **Mac:** open it in Safari, then File → **Add to Dock** (or Install in Chrome).

amarchy offers every git repo in `~/Work`, or clones one of yours from GitHub. It keeps itself up to date from GitHub. `install.sh --uninstall` removes it.

## Keys in the browser

| Key | |
| --- | --- |
| `Ctrl+Alt+N` | New session |
| `Ctrl+Alt+J` / `K` | Next / previous session |
| `Ctrl+Alt+S` | Search sessions |
| `Ctrl+Alt+←` / `→` | Claude / the terminal |
| `Ctrl+Alt+R` | Run the project in the terminal |
| `Ctrl+Alt+X` | Close the session and remove its worktree |
| `Ctrl+Alt+M` | **The amarchy menu: everything else, each with its key** |

On a Mac that's Control+Option. Everything is also a command on the server: `amarchy help`.

## More

The **[full guide](docs/guide.md)** covers all of it: [sessions](docs/guide.md#sessions),
[the phone](docs/guide.md#on-your-iphone), [the browser](docs/guide.md#in-a-browser-on-your-computer),
[sleep](docs/guide.md#sleep), [themes](docs/guide.md#theme), [your assistant](docs/guide.md#your-assistant),
[notifications](docs/guide.md#notifications), [scripts and agents](docs/guide.md#from-scripts-and-agents),
[configuration](docs/guide.md#configure) and [the CLI](docs/guide.md#cli).

[MIT](LICENSE)
