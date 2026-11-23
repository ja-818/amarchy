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
| `src/platform.rs` | Linux: the app id `amarchy`, NVIDIA, the PulseAudio guard, WebKitGTK's settings (the microphone), its load failures, its page's process ending and why (drawing the safe way only after crashes with no sign why), what draws its GL (no GPU: its page painted on the CPU, `--graphics`), whether it's on an Omarchy desktop (the page told, `amarchyDesktop.omarchy`: see-through as the terminals, its look live drawn without a wallpaper of its own) |
| `src/sound.rs` | What its page can play: GStreamer asked at start; without its plugins, no media in the page (one would end it), its sounds played by the app (`pw-play`), said once, and a start again once they're installed |
| `src/notify.rs` | Its notifications: it follows `GET /api/notices` of what it opens (the contract's "Its notifications"), shows each natively with its buttons, does what a button says as the page would, opens the chat on a click, rings the chat's chime |
| `src/tray.rs` | The tray: Open, Reload, Its log, Quit, and how many need you |
| `src/journal.rs` | Its log (below) |
| `src/tailnet.rs` | amarchy's own Tailscale node, when it's this computer's: its sign-in (the own page's **Sign in to Tailscale**) and its proxy, for the window (WebKit's proxy settings, never for 127.0.0.1) and the notices |
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
- **Its page's process crashes**: the page loads again, and the log says
  why, by what that process wrote last. GStreamer's words before it: a sound
  or a video ended it (below), so its page loads no media from then on and
  the GPU isn't blamed. No sign why: twice in ten minutes, it draws the safe
  way from then on (WebKit's DMA-BUF renderer and compositing off, its
  hardware acceleration never), kept in `rendering.json` beside the log;
  `AMARCHY_DESKTOP_GPU=1` tries the GPU again. Three crashes in two minutes:
  its own page says so, with the log's path.
- **GStreamer without its plugins** (`gst-plugins-good`: WebKit's audio
  sink; `gst-plugins-base`: the `.oga` chimes; `gst-plugin-pipewire`: the
  microphone): WebKit aborts its page's process when a page's `<audio>` or
  `<video>` loads with no audio sink. So at start it asks GStreamer (the
  library and plugins WebKit's page process uses) what it has, in a few
  milliseconds; when the page's sounds can't play, its page loads no media
  (a `media-src 'none'` policy, before the page's scripts), and the page's
  sounds (`window.amarchyDesktopMedia.play`) and its notifications' chimes
  are played by the app itself, with `pw-play` (or `paplay`). It says what's
  missing and the command in its log, once in a notification, in Settings,
  and when dictation can't start; once they're installed it sees GStreamer's
  plugins change and starts again by itself. `AMARCHY_DESKTOP_SOUND=1` lets
  the page play them even so.
- **No GPU to draw with** (a GPU whose Linux driver isn't there yet, as
  Apple's M5 today; a virtual machine): Mesa runs WebKit's GL on the CPU
  (llvmpipe), every frame a GPU's work emulated. It asks EGL what draws its
  GL before the window, in a process of its own (`amarchy-desktop
  --graphics` says it too), and there its page's tiles are painted with
  Skia's CPU raster (`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`), compositing kept
  (without it WebKit 2.54 paints on the page's own thread, and held keys came
  out seconds late). `AMARCHY_DESKTOP_GPU=1` paints through GL anyway. The
  page itself draws as few frames as it can, anywhere: what moves for as long
  as it's on screen moves with the spinners' tick (app.js, the beat).
- **Its window's thread stuck** (a start handed over not taken up in 8 s, or
  no answer for 45 s): it starts again as a new process, on the chat it was
  asked for, and the stuck one ends.

## Build and run

Needs Rust, WebKitGTK 4.1 and libayatana-appindicator (on Arch: `rust
webkit2gtk-4.1 libayatana-appindicator`, and `gst-plugins-good
gst-plugins-base gst-plugin-pipewire` for its sounds and microphone).

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
                                                    # a restart), its self-healing, amarchy's own
                                                    # Tailscale node (its sign-in, through its proxy),
                                                    # on an Omarchy desktop (no wallpaper of its own)
python3 test/sound-test.py                          # GStreamer without its plugins (Julian's M5; its core
                                                    # elements only; none at all): no media in the page,
                                                    # nothing ends it, its sounds played by the app, said
                                                    # once; installed: it starts again; a sound's crash
                                                    # isn't blamed on the GPU
python3 ../test/desktop-notices.py                  # the server's side: kept, streamed, the buttons
python3 test/install-test.py                        # install.sh when pacman can't get a package (a 404):
                                                    # built anyway without the sounds' and mic's, mise's
                                                    # Rust, why
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
the Windows installer) as the run's artifacts. The deb and the rpm depend on
GStreamer's good, base and PipeWire plugins (its sounds and microphone); it
stays up without them all the same. `packaging/arch/PKGBUILD` is
`amarchy-desktop-git` for the AUR and omarchy-pkgs, built from amarchy's main
(`makepkg -si`). Nothing is published: that's Julian's call.
