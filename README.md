<div align="center">

# Ⓐ amarchy

**Run a dozen Claude Codes at once, right in your Omarchy desktop.**

Each session gets its own git worktree, its own workspace and a terminal next to it.
The Ⓐ in your bar lights up when one of them needs you.

<img src="docs/demo.gif" alt="One prompt in amarchy starts an agent per open GitHub issue, each in its own worktree" width="100%">

[Install](#install) · [Keys](#the-keys-that-matter) · [Full guide](docs/guide.md)

</div>

---

## What you get

- **One key, new agent.** `Super+Alt+N`, pick a project, and you're done. You get a fresh worktree and branch, with Claude in the middle and a terminal beside it.
- **Agents that start agents.** Ask one Claude to start a session per GitHub issue, and they all appear in the list, each on its own branch.
- **Knows who needs you.** The Ⓐ in the bar lights up, and a chime plays, when a session asks a question or finishes. Click it to jump there.
- **Sessions you can find.** They're listed by what they're about (**Login:** redirect loop), with search, priorities, and grouping by project, priority or status.
- **Light on memory.** Idle sessions sleep and free their memory. Start typing and they wake up mid-conversation.
- **Keeps going with the lid shut.** Put your sessions on a server. They keep working while your laptop sleeps.
- **On your phone.** A home-screen web app to read, answer and start sessions, with push notifications.
- **In a browser.** The same app on a computer's wide screen is amarchy as your desktop has it, with Claude's and the session's real terminals: no Omarchy needed there.

It's all plain Omarchy: ordinary Hyprland windows, `Super+arrows`, the Omarchy menu, your theme.
Running another multiplexer inside a tiling window manager felt like one too many, so amarchy lives in the desktop instead.

## Install

You need **Omarchy 4** and **[Claude Code](https://docs.claude.com/en/docs/claude-code)**, logged in.

```sh
git clone https://github.com/ja-818/amarchy ~/.local/share/amarchy && ~/.local/share/amarchy/install.sh
```

Then press **`Super+Alt+N`**. amarchy offers every git repo in `~/Work`, or clones one of yours from GitHub.

You can run `install.sh` again at any time to update. `install.sh --uninstall` removes amarchy.

## The keys that matter

| Key | |
| --- | --- |
| `Super+Alt+N` | New session |
| `Super+Alt+A` | Back to amarchy |
| `Ctrl+Alt+J` / `K` | Next / previous session |
| `Ctrl+Alt+S` | Search sessions |
| `Ctrl+Alt+Z` | Zen mode: just Claude |
| `Ctrl+Alt+R` | Run the project in the terminal |
| `Ctrl+Alt+X` | Close the session and remove its worktree |
| `Ctrl+Alt+M` | **The amarchy menu: everything else, each with its key** |

Every action is also a command: `amarchy help`.

## More

The **[full guide](docs/guide.md)** covers all of it: [how it works](docs/guide.md#how-it-works),
[sleep](docs/guide.md#sleep), [themes](docs/guide.md#theme), [sounds](docs/guide.md#sound),
[remote sessions](docs/guide.md#remote-sessions), [the phone app](docs/guide.md#your-phone),
[the browser](docs/guide.md#in-a-browser-on-your-computer),
[configuration](docs/guide.md#configure) and [the CLI](docs/guide.md#cli).

[MIT](LICENSE)
