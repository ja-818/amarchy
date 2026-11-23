# The desktop app

amarchy's app in a window of its own: a thin [Tauri 2](https://tauri.app)
shell around the same app the phone and the browser show (`app/`, served by an
amarchy app server), never a second UI. Linux first (WebKitGTK), with macOS
(WKWebView) and Windows (WebView2) built from the same code. What it does for
someone using it: [the guide](../docs/guide.md#the-desktop-app). What it opens
and how it's opened is part of the contract between machines and apps:
[the plan](../docs/plan-omarchy-and-machines.md) ("The desktop app: how it's
opened, what it opens").

| | |
| --- | --- |
| `src/main.rs` | The window, its navigation rule (amarchy's pages in it, anything else in your browser), the permissions it answers (the microphone yes, the app's own notifications no), links, closing to the tray, `--restart` after an update |
| `src/target.rs` | What it opens (the contract's order), through amarchy's CLI; this machine's amarchy with the local key (its cookie asked for natively, never in an address) |
| `src/links.rs` | `amarchy://chat/<machine>/<id>`, and the app's route to it |
| `src/platform.rs` | Linux: the app id `amarchy`, NVIDIA, the PulseAudio guard, WebKitGTK's settings (the microphone), its load failures, its page's process ending (and drawing the safe way after a crash) |
| `src/notify.rs` | Its notifications: it follows `GET /api/notices` of what it opens (the contract's "Its notifications"), shows each natively with its buttons, does what a button says as the page would, opens the chat on a click, rings the chat's chime |
| `src/tray.rs` | The tray: Open, Reload, Its log, Quit, and how many need you |
| `src/journal.rs` | Its log (below) |
| `dist/` | Its own page, while the window isn't showing amarchy: looking for it, which one, why not |
| `install.sh` | Built and installed on the machine it runs on (amarchy's `install.sh` runs it on a computer with a desktop) |
| `amarchy.desktop` | Its launcher entry (and `amarchy.desktop.hbs`, the same for Tauri's packages) |
| `test/` | Its tests, on the real window |

## Its log, and how it heals itself

`~/.local/state/amarchy/desktop/desktop.log` (the last 2 MB, then
`desktop.log.1`; the tray's **Its log** opens it): what it does and why
(which board it opens, a start handed over, a notice's button that didn't
go), the machine and its GPU driver, and everything GTK, WebKit and
GStreamer write to stderr, a panic too. Readable without a terminal open.

- **A start never does nothing.** A second start hands its arguments to the
  running one and ends at once; the running one takes them up on its
  window's thread, and makes its window again if it's gone.
- **Its page's process crashes**: the page loads again, and it draws the
  safe way from then on (WebKit's DMA-BUF renderer and compositing off, its
  hardware acceleration never), kept in `rendering.json` beside the log;
  `AMARCHY_DESKTOP_GPU=1` tries the GPU again. Three crashes in two minutes:
  its own page says so, with the log's path.
- **Its window's thread stuck** (a start handed over not taken up in 8 s, or
  no answer for 45 s): it starts again as a new process, on the chat it was
  asked for, and the stuck one ends.

## Build and run

Needs Rust, WebKitGTK 4.1 and libayatana-appindicator (on Arch: `rust
webkit2gtk-4.1 libayatana-appindicator`, and `gst-plugin-pipewire
gst-plugins-good` for the microphone).

```sh
cargo run -- --url https://<your amarchy>.ts.net     # a server, by hand
cargo run                                           # what it finds (the contract's order)
./install.sh                                        # built and installed as amarchy's install.sh does
```

## Tests

```sh
cargo test                                          # links, addresses, arguments, colors
cargo build --features test-hooks                   # the build the window tests drive
python3 test/shell-test.py                          # the real window under Xvfb: what it opens, the
                                                    # local key, pairing, the chooser, links, the tray,
                                                    # its size, no white flash, its page's own words, its
                                                    # notifications (buttons, a click, closed, a chime,
                                                    # a restart)
python3 ../test/desktop-notices.py                  # the server's side: kept, streamed, the buttons
python3 test/install-test.py                        # install.sh when pacman can't get a package (a 404):
                                                    # built anyway without the mic's, mise's Rust, why
python3 test/compare.py                             # the window next to Chromium, phone and wide: the
                                                    # same layout (boxes to 3 px), side by side pictures
```

`test/shell.py` runs the app in an X server of its own (Xvfb) with a D-Bus of
its own, real keys and clicks (xdotool), JavaScript in its window (the
`test-hooks` feature: never in a build for people), screenshots and its memory,
and a notification daemon on that bus (`test/notifyd.py`, PyGObject) that
records what it shows and presses its buttons.
`test/server.py` is an amarchy app server with a home and tmux of its own, as a
server through Tailscale or as this machine's own (`--local`, the real local
key). Nothing in them reaches a real machine: amarchy's CLI there is a made-up
one, or this checkout's on a test home with pairing refused. Its homes go under
`~/.cache/amarchy-tests` (unless `TMPDIR` says) and away at the end. Needs Xvfb,
xdotool, ImageMagick, dbus, tmux and PyGObject (and for compare.py, Chromium
with playwright-core, as the app's view tests).

## Packages

CI (`.github/workflows/desktop.yml`) builds and tests it on Linux (x86_64 and
aarch64), macOS and Windows, and keeps its packages (deb, rpm, AppImage, dmg,
the Windows installer) as the run's artifacts. `packaging/arch/PKGBUILD` is
`amarchy-desktop-git` for the AUR and omarchy-pkgs, built from amarchy's main
(`makepkg -si`). Nothing is published: that's Julian's call.
