// amarchy's desktop app: one window around the same app the phone and the
// browser show (app/, served by an amarchy app server), this machine's or a
// server's (docs/plan-omarchy-and-machines.md, track B, and the contract's
// "The desktop app: how it's opened, what it opens"). It only adds what a
// web page can't do: a window of its own, a link scheme, a tray, the
// microphone answered, and notifications with the window closed.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod journal;
mod links;
mod notify;
mod platform;
mod sound;
mod tailnet;
mod target;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

use links::Link;
use target::{Found, Target};

const USAGE: &str = "\
amarchy-desktop: amarchy's app, in a window of its own

  amarchy-desktop                          open it (or show it, when it's running)
  amarchy-desktop amarchy://chat/<machine>/<id>
                                           open it on that chat
  amarchy-desktop --server <address>       open that amarchy, and keep it (when
                                           this computer has none of its own)
  amarchy-desktop --server ''              forget it
  amarchy-desktop --url <address>          open that one, this time only
  amarchy-desktop --hidden                 start in the tray (at login)
  amarchy-desktop --restart                the running one starts again, on the
                                           build installed now (install.sh)
  amarchy-desktop --graphics               what draws its window here: the GPU,
                                           or the CPU (then its page is painted
                                           with Skia's CPU raster)

What it opens, when not told: this computer's amarchy if it has chats (or
machines merged in), else the first machine paired with it that's on, else
the address kept with --server, else one of yours found on your tailnet.
";

const WINDOW_STATE: StateFlags = StateFlags::SIZE.union(StateFlags::POSITION).union(StateFlags::MAXIMIZED);

/// What the window's own page (dist/) shows while it isn't showing amarchy.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Status {
    /// Looking for it.
    Opening,
    /// Several of yours answer: which one.
    Choose { machines: Vec<target::Candidate> },
    /// None found: why.
    Nothing { why: String },
    /// It was found, then didn't load: why.
    Failed { label: String, why: String },
    /// This computer's Tailscale is amarchy's own node, which waits for a
    /// sign-in (waiting: its page in the browser is open).
    #[serde(rename = "signin")]
    SignIn { words: String, waiting: bool },
}

pub struct Shell {
    /// The address it was started with (--url), if any.
    given: Option<Url>,
    /// What's open, and where its pages come from (for the navigation rule).
    target: Mutex<Option<Target>>,
    origin: Arc<Mutex<Option<Url>>>,
    status: Mutex<Status>,
    /// A chat asked for before the target was known.
    pending: Mutex<Option<Link>>,
    /// Said once when the page is up (a machine just paired), and whether
    /// it's being said now.
    said: Mutex<Option<String>>,
    saying: AtomicBool,
    /// Where the window was before --restart (its route), back there.
    route: Mutex<Option<String>>,
    quitting: AtomicBool,
    finding: AtomicBool,
    /// The window's thread last seen answering (the watchdog), and a start
    /// handed over that it hasn't taken up yet (when, its arguments).
    beat: Arc<Mutex<Instant>>,
    handoff: Mutex<Option<(Instant, Vec<String>)>>,
    /// When its page's process last ended, to tell a crash from a crash loop.
    crashes: Mutex<Vec<Instant>>,
}

struct Args {
    url: Option<Url>,
    server: Option<String>,
    hidden: bool,
    link: Option<Link>,
    /// install.sh, after an update: the running one starts again on the new build.
    restart: bool,
    /// Started again by --restart: once the one before has ended (its pid),
    /// where it was (its route).
    after: Option<u32>,
    route: Option<String>,
}

fn args(argv: &[String]) -> Result<Args, String> {
    let mut a = Args { url: None, server: None, hidden: false, link: Link::from_args(argv), restart: false, after: None, route: None };
    let mut it = argv.iter().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--url" => {
                let v = it.next().ok_or("--url needs an address")?;
                a.url = Some(target::parse_address(v)?);
            }
            "--server" => a.server = Some(it.next().ok_or("--server needs an address ('' forgets it)")?.clone()),
            "--hidden" => a.hidden = true,
            "--restart" => a.restart = true,
            "--after" => a.after = it.next().and_then(|p| p.parse().ok()),
            "--route" => a.route = it.next().filter(|r| r.starts_with("#/") && r.len() < 300).cloned(),
            s if s.starts_with("amarchy://") => {
                if Link::parse(s).is_none() {
                    return Err(format!("{s} isn't a chat's link (amarchy://chat/<machine>/<id>)"));
                }
            }
            s => return Err(format!("unknown: {s}")),
        }
    }
    if a.url.is_none() {
        if let Ok(v) = std::env::var("AMARCHY_URL") {
            if !v.trim().is_empty() {
                a.url = Some(target::parse_address(&v).map_err(|e| format!("AMARCHY_URL: {e}"))?);
            }
        }
    }
    Ok(a)
}

/// --server: keep the address (or forget it).
fn keep_server(raw: &str) -> Result<(), String> {
    let mut s = target::read_settings();
    s.server = if raw.trim().is_empty() { None } else { Some(target::parse_address(raw)?.to_string()) };
    target::write_settings(&s).map_err(|e| format!("couldn't keep it: {e}"))
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if argv.iter().any(|a| a == "-h" || a == "--help") {
        print!("{USAGE}");
        return;
    }
    if argv.iter().any(|a| a == "--version") {
        println!("amarchy-desktop {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if argv.iter().any(|a| a == "--graphics") {
        platform::print_graphics();
        return;
    }
    let start = match args(&argv) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("amarchy-desktop: {e}\n\n{USAGE}");
            std::process::exit(2);
        }
    };
    if let Some(server) = &start.server {
        if let Err(e) = keep_server(server) {
            eprintln!("amarchy-desktop: {e}");
            std::process::exit(1);
        }
    }
    // Started again by --restart: the one before lets go first (its single
    // instance, its window's place).
    if let Some(pid) = start.after {
        wait_gone(pid);
    }
    // A second start hands its arguments to the running one and ends, before
    // anything of GTK starts (a start without a display: an update's
    // --restart from a service, which GTK's init would abort). With none
    // running, --restart has nothing to do.
    if start.after.is_none() && hand_over(&argv) {
        return;
    }
    if start.restart {
        return;
    }
    journal::start(start.after.is_some());
    platform::prepare();

    let shell = Shell {
        given: start.url.clone(),
        target: Mutex::new(None),
        origin: Arc::new(Mutex::new(None)),
        status: Mutex::new(Status::Opening),
        pending: Mutex::new(start.link.clone()),
        route: Mutex::new(start.route.clone()),
        said: Mutex::new(None),
        saying: AtomicBool::new(false),
        quitting: AtomicBool::new(false),
        finding: AtomicBool::new(false),
        beat: Arc::new(Mutex::new(Instant::now())),
        handoff: Mutex::new(None),
        crashes: Mutex::new(Vec::new()),
    };
    let hidden = start.hidden;
    let restart_only = start.restart;

    let builder = tauri::Builder::default()
        // First: a second start hands its arguments here and ends.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| handoff(app, argv)))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE)
                .skip_initial_state("main")
                .build(),
        )
        // Its open_url from Rust only (outward, a sign-in page). Not its
        // script on every page, which takes each click on a link that opens
        // a new window (target=_blank: a preview, a link in a reply) and asks
        // the plugin from the page, which no page may: nothing opened. Those
        // reach on_new_window instead, which hands them to your browser.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    let app = builder
        .manage(shell)
        .manage(notify::Notifier::default())
        .on_permission_request(|webview, kind| {
            // Only amarchy's own pages, and only what the app uses: the
            // microphone (dictation) and reading what you copied (Paste).
            let theirs = webview.url().ok().map(|u| u.origin());
            let ours = webview.app_handle().state::<Shell>().origin.lock().unwrap().as_ref().map(|o| o.origin());
            if theirs.is_none() || theirs != ours {
                return PermissionResponse::Deny;
            }
            match kind {
                PermissionKind::Microphone | PermissionKind::ClipboardRead => PermissionResponse::Allow,
                // The app's own browser notifications are off here: the
                // desktop app shows them itself, so nothing comes twice.
                _ => PermissionResponse::Deny,
            }
        })
        .invoke_handler(tauri::generate_handler![status, choose, use_address, retry, sign_in])
        .setup(move |app| {
            let handle = app.handle().clone();
            // --restart with none running: nothing to start again.
            if restart_only {
                std::process::exit(0);
            }
            // The one that runs (a start handed over ended before this):
            // what it draws with and what its page can play, in the log.
            platform::started();
            let win = window(&handle, hidden)?;
            platform::webview(&win);
            tray::make(&handle)?;
            #[cfg(target_os = "macos")]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h = handle.clone();
                app.deep_link().on_open_url(move |e| {
                    if let Some(l) = e.urls().iter().find_map(|u| Link::parse(u.as_str())) {
                        open_link(&h, l);
                    }
                });
            }
            #[cfg(feature = "test-hooks")]
            test_hooks(handle.clone());
            find(&handle);
            notify::follow(&handle);
            watchdog(&handle);
            // What its page can't play here (sound.rs): said once, and
            // watched for until it can.
            sound::tell(&handle);
            sound::watch(&handle);
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                page_loaded(webview.app_handle(), payload.url());
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if !app.state::<Shell>().quitting.load(Ordering::SeqCst) {
                    // Closed, it stays in the tray: its notifications go on.
                    api.prevent_close();
                    let _ = app.save_window_state(WINDOW_STATE);
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("amarchy-desktop couldn't start");
    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            // The window hidden isn't the app ending: only Quit (or a signal) is.
            if code.is_none() && !app.state::<Shell>().quitting.load(Ordering::SeqCst) {
                api.prevent_exit();
            }
        }
    });
}

/// The app's identifier (tauri.conf.json): its single instance's D-Bus name.
const IDENTIFIER: &str = "io.github.ja818.amarchy";

/// Hands argv to the running one, as tauri-plugin-single-instance does (its
/// D-Bus name and method), when one is running: whether it took them.
#[cfg(target_os = "linux")]
fn hand_over(argv: &[String]) -> bool {
    let name = format!("{IDENTIFIER}.SingleInstance");
    let path = format!("/{}", name.replace('.', "/").replace('-', "_"));
    let Ok(conn) = zbus::blocking::Connection::session() else { return false };
    let Ok(dbus) = zbus::blocking::fdo::DBusProxy::new(&conn) else { return false };
    let Ok(bus_name) = zbus::names::BusName::try_from(name.as_str()) else { return false };
    if !dbus.name_has_owner(bus_name).unwrap_or(false) {
        return false;
    }
    let cwd = std::env::current_dir().unwrap_or_default().to_string_lossy().into_owned();
    conn.call_method(Some(name.as_str()), path.as_str(), Some("org.SingleInstance.DBus"), "ExecuteCallback", &(argv.to_vec(), cwd))
        .is_ok()
}

#[cfg(not(target_os = "linux"))]
fn hand_over(_argv: &[String]) -> bool {
    false
}

/// Until the process pid has ended (up to 10 s).
fn wait_gone(pid: u32) {
    #[cfg(target_os = "linux")]
    for _ in 0..100 {
        if !std::path::Path::new(&format!("/proc/{pid}")).exists() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }
}

/// The one window: amarchy, or while it's looked for, the window's own page.
fn window(app: &AppHandle, hidden: bool) -> tauri::Result<WebviewWindow> {
    let origin = app.state::<Shell>().origin.clone();
    let opener = app.clone();
    let out = app.clone();
    let omarchy = platform::omarchy();
    let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Amarchy")
        .inner_size(1280.0, 860.0)
        .min_inner_size(360.0, 480.0);
    // On an Omarchy desktop the window is see-through: what its page leaves
    // unpainted shows the desktop behind it (wearing the desktop's look live,
    // its wallpaper, as a browser shows the app's). Elsewhere, the app's look
    // while a page loads (not WebKit's white): the last one it wore, else
    // Omarchy's default.
    let win = if omarchy { win.transparent(true) } else { win.background_color(saved_background()) };
    // Its page draws its whole window again after each big change (app/ui.js
    // uiWhole); every frame, when that's asked (platform.rs, whole_frames).
    if omarchy {
        platform::see_through();
    }
    let win = win
        .visible(false)
        .initialization_script(init_script(omarchy, platform::gpu()))
        .on_navigation(move |u| {
            if own_page(u) || matches!(u.scheme(), "about" | "blob" | "data") {
                return true;
            }
            if origin.lock().unwrap().as_ref().map(|o| o.origin()) == Some(u.origin()) {
                return true;
            }
            // Anywhere else (a link in a reply, a sign-in): your browser.
            outward(&opener, u);
            false
        })
        .on_new_window(move |u, _| {
            outward(&out, &u);
            NewWindowResponse::Deny
        })
        .on_download(|webview, event| {
            if let DownloadEvent::Requested { url, destination } = event {
                if let Ok(dir) = webview.app_handle().path().download_dir() {
                    let name = destination
                        .file_name()
                        .map(|n| n.to_owned())
                        .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(|l| l.into())))
                        .unwrap_or_else(|| "download".into());
                    *destination = free_name(&dir, &name);
                }
            }
            true
        })
        .build()?;
    let _ = win.restore_state(WINDOW_STATE);
    if !hidden {
        win.show()?;
    }
    Ok(win)
}

/// What every page in the window knows before its own scripts run: that it's
/// the desktop app (window.amarchyDesktop), whether the window is on an
/// Omarchy desktop (platform::omarchy), and whether it has a GPU to draw with
/// (platform::gpu: without one, what moves on the page steps half as often).
/// On Omarchy <html> is marked on-omarchy from the start, before the page is
/// first drawn, so a wallpaper it wouldn't draw (app.css) never flashes.
fn init_script(omarchy: bool, gpu: bool) -> String {
    let mut js = format!(
        "window.amarchyDesktop = Object.freeze({{ version: {:?}, platform: {:?}, omarchy: {omarchy}, gpu: {gpu} }});",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS
    );
    if omarchy {
        js.push_str(
            "(() => { const on = () => { const r = document.documentElement; if (r) r.classList.add('on-omarchy'); return !!r; }; \
               if (!on()) new MutationObserver((_, o) => { if (on()) o.disconnect(); }).observe(document, { childList: true }); })();",
        );
    }
    js
}

/// A file name in dir that isn't taken: name, name (2), ...
fn free_name(dir: &std::path::Path, name: &std::ffi::OsStr) -> std::path::PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = std::path::Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap()
}

/// The window's own page (dist/index.html), as the system's web view names it.
fn own_page(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

fn own_page_url() -> Url {
    let base = if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" };
    Url::parse(base).unwrap().join("index.html").unwrap()
}

fn outward(app: &AppHandle, u: &Url) {
    if matches!(u.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(u.as_str(), None::<&str>);
    }
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// The window, in front: made again if it's gone (whatever ended it).
pub fn show(app: &AppHandle) {
    let Some(w) = ensure_window(app) else { return };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
}

/// The window, there: if it's gone, made again and on what it showed.
fn ensure_window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(w) = main_window(app) {
        return Some(w);
    }
    log::warn!("its window was gone: made again");
    let w = match window(app, false) {
        Ok(w) => w,
        Err(e) => {
            log::error!("couldn't make its window again: {e}");
            return None;
        }
    };
    platform::webview(&w);
    let target = app.state::<Shell>().target.lock().unwrap().clone();
    match target {
        Some(t) => go(app, &t, None),
        None => find(app),
    }
    Some(w)
}

/// Started again (a launcher, a key, a link): answered at once, so the
/// start that handed over ends at once, and done on the window's thread;
/// the watchdog sees to it if that thread doesn't take it up.
fn handoff(app: &AppHandle, argv: Vec<String>) {
    log::info!("started again: {:?}", argv.iter().skip(1).collect::<Vec<_>>());
    *app.state::<Shell>().handoff.lock().unwrap() = Some((Instant::now(), argv.clone()));
    let app2 = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        app2.state::<Shell>().handoff.lock().unwrap().take();
        again(&app2, &argv);
    }) {
        log::error!("couldn't take up a start handed over: {e}");
    }
}

/// The window's thread must answer: a start handed over taken up within
/// HANDOFF_WAIT, and a beat at least every HUNG. If not, it's stuck (the
/// window gone with it): it starts again as a new process, with what was
/// handed over, and this one ends. (The monotonic clock: a laptop asleep
/// isn't stuck.)
const HANDOFF_WAIT: Duration = Duration::from_secs(8);
const HUNG: Duration = Duration::from_secs(45);

fn watchdog(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        let shell = app.state::<Shell>();
        if shell.quitting.load(Ordering::SeqCst) {
            return;
        }
        let beat = shell.beat.clone();
        let _ = app.run_on_main_thread(move || *beat.lock().unwrap() = Instant::now());
        let quiet = shell.beat.lock().unwrap().elapsed();
        let waiting = shell.handoff.lock().unwrap().clone().filter(|(at, _)| at.elapsed() > HANDOFF_WAIT);
        if quiet < HUNG && waiting.is_none() {
            continue;
        }
        let args = waiting.map(|(_, a)| a).unwrap_or_default();
        log::error!(
            "its window's thread hasn't answered for {}s{}: starting again",
            quiet.as_secs(),
            if args.is_empty() { "" } else { " (a start handed over waits)" }
        );
        let exe = std::env::current_exe().ok().map(|p| std::path::PathBuf::from(p.to_string_lossy().trim_end_matches(" (deleted)")));
        if let Some(exe) = exe {
            let mut cmd = std::process::Command::new(exe);
            cmd.arg("--after").arg(std::process::id().to_string());
            for a in args.iter().skip(1).filter(|a| a.starts_with("amarchy://")) {
                cmd.arg(a);
            }
            if let Some(u) = shell.given.clone() {
                cmd.arg("--url").arg(u.as_str());
            }
            if let Some(e) = journal::stderr_for_child() {
                cmd.stderr(e).env("AMARCHY_DESKTOP_STDERR", "given");
            }
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                cmd.process_group(0);
            }
            if let Err(e) = cmd.spawn() {
                log::error!("couldn't start again: {e}");
            }
        }
        std::process::exit(1);
    });
}

/// Its page's process ended (platform.rs): the page loaded again, unless it
/// keeps ending (three times in two minutes), then its own page says so.
pub fn web_died(app: &AppHandle, why: &str) {
    let shell = app.state::<Shell>();
    let recent = {
        let mut c = shell.crashes.lock().unwrap();
        c.retain(|t| t.elapsed() < Duration::from_secs(120));
        c.push(Instant::now());
        c.len()
    };
    log::error!("{why} ({recent} in the last two minutes)");
    if recent >= 3 {
        let label = shell.target.lock().unwrap().as_ref().map(|t| t.label()).unwrap_or_else(|| "amarchy".into());
        *shell.status.lock().unwrap() = Status::Failed {
            label,
            why: format!("{why}, again and again. Its log says more: {}", journal::file().display()),
        };
        *shell.target.lock().unwrap() = None;
        to_own_page(app);
        return;
    }
    let Some(w) = main_window(app) else { return };
    let was = w.url().ok();
    log::info!("its page loaded again (it was on {})", was.as_ref().map(|u| u.as_str()).unwrap_or("nothing"));
    let target = shell.target.lock().unwrap().clone();
    match target {
        Some(t) if !was.as_ref().map(own_page).unwrap_or(false) => {
            // Back where it was (its route), its cookie again if it's this machine's.
            let mut u = t.open_url(None);
            if let Some(f) = was.as_ref().and_then(|u| u.fragment()) {
                u.set_fragment(Some(f));
            }
            go_url(app, &t, u);
        }
        _ => {
            let _ = w.reload();
        }
    }
}

pub fn quit(app: &AppHandle) {
    log::info!("quit");
    app.state::<Shell>().quitting.store(true, Ordering::SeqCst);
    let _ = app.save_window_state(WINDOW_STATE);
    app.exit(0);
}

/// Started again while running: its link, its address, or just the window.
fn again(app: &AppHandle, argv: &[String]) {
    match args(argv) {
        Ok(a) if a.restart => restart(app, argv.first().map(String::as_str)),
        Ok(a) => {
            if let Some(server) = a.server {
                if keep_server(&server).is_ok() {
                    *app.state::<Shell>().target.lock().unwrap() = None;
                    find(app);
                }
            }
            if let Some(l) = a.link {
                open_link(app, l);
            }
            if !a.hidden {
                show(app);
            }
        }
        Err(_) => show(app),
    }
}

/// Starts again on the build installed now (the one that asked, argv0):
/// hidden if it was, on the chat it was on.
pub fn restart(app: &AppHandle, exe: Option<&str>) {
    let exe = exe
        .filter(|e| std::path::Path::new(e).is_absolute() && std::path::Path::new(e).is_file())
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok().map(|p| std::path::PathBuf::from(p.to_string_lossy().trim_end_matches(" (deleted)"))));
    let Some(exe) = exe else { return };
    let w = main_window(app);
    let hidden = !w.as_ref().and_then(|w| w.is_visible().ok()).unwrap_or(true);
    let route = w.and_then(|w| w.url().ok()).filter(|u| !own_page(u)).and_then(|u| u.fragment().map(|f| format!("#{f}")));
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--after").arg(std::process::id().to_string());
    if hidden {
        cmd.arg("--hidden");
    }
    if let Some(r) = route.filter(|r| r.starts_with("#/")) {
        cmd.arg("--route").arg(r);
    }
    if let Some(u) = app.state::<Shell>().given.clone() {
        cmd.arg("--url").arg(u.as_str());
    }
    if let Some(e) = journal::stderr_for_child() {
        cmd.stderr(e).env("AMARCHY_DESKTOP_STDERR", "given");
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    if cmd.spawn().is_ok() {
        quit(app);
    }
}

/// A notification clicked: the window, on its route (a chat), at the card it
/// asks about (the app's amarchy-ask, as a phone's notification does).
pub fn open_route(app: &AppHandle, hash: Option<&str>, ask: Option<&str>) {
    show(app);
    let Some(t) = app.state::<Shell>().target.lock().unwrap().clone() else { return };
    let Some(w) = main_window(app) else { return };
    let on_app = w.url().ok().map(|u| u.origin()) == Some(t.origin().origin());
    if on_app {
        let mut js = String::new();
        if let Some(h) = hash {
            js += &format!("location.hash = {};", serde_json::to_string(h).unwrap());
        }
        if let Some(a) = ask {
            js += &format!(
                "setTimeout(() => window.dispatchEvent(new CustomEvent('amarchy-ask', {{ detail: {{ id: {} }} }})), 300);",
                serde_json::to_string(a).unwrap()
            );
        }
        let _ = w.eval(js);
        return;
    }
    // Not on the app (its own page): the app, started there (?ask=, app.js's start).
    let mut u = t.open_url(None);
    if let Some(a) = ask {
        u.query_pairs_mut().append_pair("ask", a);
    }
    if let Some(h) = hash {
        u.set_fragment(Some(h.trim_start_matches('#')));
    }
    go_url(app, &t, u);
}

/// Opens a chat: in the app if it's up (its route, no reload), else once it is.
pub fn open_link(app: &AppHandle, link: Link) {
    show(app);
    let shell = app.state::<Shell>();
    let target = shell.target.lock().unwrap().clone();
    let Some(t) = target else {
        *shell.pending.lock().unwrap() = Some(link);
        return;
    };
    let Some(w) = main_window(app) else { return };
    let on_app = w.url().ok().map(|u| u.origin()) == Some(t.origin().origin());
    if on_app {
        let hash = link.hash(t.machine());
        let _ = w.eval(format!("location.hash = {};", serde_json::to_string(&hash).unwrap()));
    } else {
        go(app, &t, Some(&link));
    }
}

/// Looks for the amarchy to open, off the window's thread (amarchy's CLI,
/// the tailnet), then opens it, or shows why not.
pub fn find(app: &AppHandle) {
    let shell = app.state::<Shell>();
    if shell.finding.swap(true, Ordering::SeqCst) {
        return;
    }
    *shell.status.lock().unwrap() = Status::Opening;
    if shell.target.lock().unwrap().is_none() {
        to_own_page(app);
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let given = app.state::<Shell>().given.clone();
        let found = target::find(given, true);
        settle(&app, found);
    });
}

fn settle(app: &AppHandle, found: Found) {
    let shell = app.state::<Shell>();
    shell.finding.store(false, Ordering::SeqCst);
    match found {
        Found::Open { target, said } => {
            *shell.said.lock().unwrap() = said;
            let link = shell.pending.lock().unwrap().take();
            if link.is_none() {
                let route = shell.route.lock().unwrap().take();
                if let Some(route) = route {
                    return go_route(app, &target, &route);
                }
            }
            let same = shell.target.lock().unwrap().as_ref() == Some(&target);
            let on_app = main_window(app).and_then(|w| w.url().ok()).map(|u| u.origin()) == Some(target.origin().origin());
            // Reload found what's open already: the page as it is, but
            // fresh (a server that came back), on the chat asked for.
            if same && on_app && link.is_none() {
                if let Some(w) = main_window(app) {
                    let _ = w.eval("location.reload();");
                }
                return;
            }
            go(app, &target, link.as_ref());
            if shell.said.lock().unwrap().is_some() {
                say(app);
            }
        }
        Found::Choose { machines } => {
            *shell.status.lock().unwrap() = Status::Choose { machines };
            to_own_page(app);
        }
        Found::Nothing { why } => {
            *shell.status.lock().unwrap() = Status::Nothing { why };
            *shell.target.lock().unwrap() = None;
            to_own_page(app);
        }
        Found::SignIn { words } => {
            log::info!("amarchy's own Tailscale node waits for a sign-in");
            *shell.status.lock().unwrap() = Status::SignIn { words, waiting: false };
            *shell.target.lock().unwrap() = None;
            to_own_page(app);
        }
    }
}

/// Opens a target (on a chat). This machine's gets its cookie first, off the
/// window's thread (the web view's cookies are set from another).
fn go(app: &AppHandle, t: &Target, link: Option<&Link>) {
    go_url(app, t, t.open_url(link));
}

fn go_url(app: &AppHandle, t: &Target, url: Url) {
    let shell = app.state::<Shell>();
    *shell.origin.lock().unwrap() = Some(t.origin());
    *shell.target.lock().unwrap() = Some(t.clone());
    let Target::Local { port, .. } = t else {
        if let Some(w) = main_window(app) {
            // On the tailnet, through amarchy's own Tailscale node when it's
            // this computer's (else straight).
            platform::proxy(&w, tailnet::proxy_for(&url).as_deref());
            let _ = w.navigate(url);
        }
        return;
    };
    let (app, port, t) = (app.clone(), *port, t.clone());
    std::thread::spawn(move || {
        let Some(w) = main_window(&app) else { return };
        let cookie = target::local_cookie(port).and_then(|c| {
            let pair = format!("{}={}", c.name(), c.value());
            w.set_cookie(c).map_err(|e| format!("its cookie: {e}")).map(|_| pair)
        });
        match cookie {
            Ok(pair) => {
                // The notices' stream and buttons use it too (notify.rs).
                *app.state::<notify::Notifier>().cookie.lock().unwrap() = Some(pair);
                let _ = w.navigate(url);
            }
            Err(why) => {
                let shell = app.state::<Shell>();
                *shell.status.lock().unwrap() = Status::Failed { label: t.label(), why };
                *shell.target.lock().unwrap() = None;
                to_own_page(&app);
            }
        }
    });
}

/// Opens a target on a route of the app (where --restart left it).
fn go_route(app: &AppHandle, t: &Target, route: &str) {
    let mut u = t.open_url(None);
    u.set_fragment(Some(route.trim_start_matches('#')));
    go_url(app, t, u);
}

fn to_own_page(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if !w.url().map(|u| own_page(&u)).unwrap_or(false) {
            let _ = w.navigate(own_page_url());
        }
    }
}

/// amarchy's page didn't load: the window's own page says why, with Retry.
pub fn load_failed(app: &AppHandle, uri: &str, why: &str) {
    let app = app.clone();
    let (uri, why) = (uri.to_string(), why.to_string());
    let _ = app.clone().run_on_main_thread(move || {
        if Url::parse(&uri).map(|u| own_page(&u)).unwrap_or(false) {
            return;
        }
        let shell = app.state::<Shell>();
        let label = shell.target.lock().unwrap().as_ref().map(|t| t.label()).unwrap_or_else(|| uri.clone());
        *shell.status.lock().unwrap() = Status::Failed { label, why };
        *shell.target.lock().unwrap() = None;
        to_own_page(&app);
    });
}

// ---- the look's background, kept for the next start (look.json)

fn look_file() -> std::path::PathBuf {
    target::state_dir().join("desktop/look.json")
}

fn saved_background() -> Color {
    std::fs::read_to_string(look_file())
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v["background"].as_str().and_then(parse_color))
        .unwrap_or(Color(0x1a, 0x1b, 0x26, 0xff))
}

/// #rrggbb, or rgb()/rgba() as a page computes it.
fn parse_color(s: &str) -> Option<Color> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        if hex.len() == 6 {
            let n = u32::from_str_radix(hex, 16).ok()?;
            return Some(Color((n >> 16) as u8, (n >> 8) as u8, n as u8, 0xff));
        }
        return None;
    }
    let inner = s.strip_prefix("rgba(").or_else(|| s.strip_prefix("rgb("))?.strip_suffix(')')?;
    let mut parts = inner.split([',', ' ', '/']).filter(|p| !p.is_empty()).map(|p| p.trim().parse::<f32>().ok());
    let (r, g, b) = (parts.next()??, parts.next()??, parts.next()??);
    Some(Color(r as u8, g as u8, b as u8, 0xff))
}

/// The look the app wears now (its bars' color), worn by the window between
/// pages (unless it's see-through, on Omarchy) and kept for the next start.
fn keep_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let Some(w) = main_window(&app) else { return };
        let w2 = w.clone();
        let _ = w.eval_with_callback(
            "(document.querySelector('meta[name=\"theme-color\"]') || {}).content || getComputedStyle(document.body).backgroundColor",
            move |v| {
                let Some(raw) = serde_json::from_str::<String>(&v).ok() else { return };
                let Some(c) = parse_color(&raw) else { return };
                // (A see-through window stays so: its page paints what it covers.)
                if !platform::omarchy() {
                    let _ = w2.set_background_color(Some(c));
                }
                let hex = format!("#{:02x}{:02x}{:02x}", c.0, c.1, c.2);
                let f = look_file();
                if std::fs::read_to_string(&f).map(|s| s.contains(&hex)).unwrap_or(false) {
                    return;
                }
                let _ = std::fs::create_dir_all(f.parent().unwrap());
                let _ = std::fs::write(f, serde_json::json!({ "background": hex }).to_string() + "\n");
            },
        );
    });
}

fn page_loaded(app: &AppHandle, url: &Url) {
    if own_page(url) {
        return;
    }
    keep_background(app);
    if app.state::<Shell>().said.lock().unwrap().is_some() {
        say(app);
    }
}

/// What the window says once (a machine just paired), in the app's own
/// toast when the app is up: kept until the page shows it, so a page that
/// loads again meanwhile (its service worker's first start) doesn't lose it.
/// What was said stays on the page (window.amarchyDesktopSaid).
fn say(app: &AppHandle) {
    let shell = app.state::<Shell>();
    if shell.saying.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        for _ in 0..240 {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let Some(text) = app.state::<Shell>().said.lock().unwrap().clone() else { break };
            let Some(w) = main_window(&app) else { break };
            let t = serde_json::to_string(&text).unwrap();
            let shown = format!(
                "(() => {{ if (window.amarchyDesktopSaid === {t}) return true; \
                   if (typeof toast !== 'function' || typeof app === 'undefined' || !app.view) return false; \
                   toast({t}); window.amarchyDesktopSaid = {t}; return true; }})()"
            );
            if eval_true(&w, shown) {
                *app.state::<Shell>().said.lock().unwrap() = None;
                break;
            }
        }
        app.state::<Shell>().saying.store(false, Ordering::SeqCst);
    });
}

/// Whether a script's value in the window is true (false if it doesn't answer).
fn eval_true(w: &WebviewWindow, js: String) -> bool {
    let (tx, rx) = std::sync::mpsc::channel();
    if w.eval_with_callback(js, move |v| {
        let _ = tx.send(v.trim() == "true");
    })
    .is_err()
    {
        return false;
    }
    rx.recv_timeout(std::time::Duration::from_secs(3)).unwrap_or(false)
}

// ---- what the window's own page (dist/) asks

#[tauri::command]
fn status(app: AppHandle) -> Status {
    app.state::<Shell>().status.lock().unwrap().clone()
}

/// One of several found: paired with, and opened.
#[tauri::command]
fn choose(app: AppHandle, name: String) -> Result<(), String> {
    let Status::Choose { machines } = app.state::<Shell>().status.lock().unwrap().clone() else {
        return Err("nothing to choose from".into());
    };
    let c = machines.into_iter().find(|m| m.name == name).ok_or("not one of them")?;
    let cli = target::amarchy_cli().ok_or("amarchy isn't installed on this computer")?;
    *app.state::<Shell>().status.lock().unwrap() = Status::Opening;
    let app2 = app.clone();
    std::thread::spawn(move || {
        let found = match target::pair_with(&cli, &c) {
            Ok(t) => Found::Open { target: t, said: Some(format!("Paired with {}.", c.label.as_deref().unwrap_or(&c.name))) },
            Err(why) => Found::Nothing { why },
        };
        settle(&app2, found);
    });
    Ok(())
}

/// An address typed in: kept (as --server) and opened.
#[tauri::command]
fn use_address(app: AppHandle, address: String) -> Result<(), String> {
    keep_server(&address)?;
    find(&app);
    Ok(())
}

#[tauri::command]
fn retry(app: AppHandle) {
    find(&app);
}

/// Sign in to Tailscale (amarchy's own node): its page in the browser, then
/// the window goes on once the node is on the tailnet (for up to 10 minutes).
#[tauri::command]
fn sign_in(app: AppHandle) -> Result<(), String> {
    let url = tailnet::login_url()?;
    if let Some(u) = &url {
        log::info!("signing amarchy's own Tailscale node in (its page, in the browser)");
        app.opener().open_url(u, None::<&str>).map_err(|e| format!("couldn't open its page: {e}"))?;
        // (Its lock let go before it's taken again: an `if let` would hold it.)
        let now = app.state::<Shell>().status.lock().unwrap().clone();
        if let Status::SignIn { words, .. } = now {
            *app.state::<Shell>().status.lock().unwrap() = Status::SignIn { words, waiting: true };
        }
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        for _ in 0..300 {
            if tailnet::node().map(|n| n.on()).unwrap_or(true) {
                log::info!("amarchy's own Tailscale node is on the tailnet");
                find(&app2);
                return;
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
    Ok(())
}

// The tests' way in: each line on stdin is {"id", "js"}, JavaScript to run in
// the window (its value comes back on stdout as "@@<id> <json>"), or
// {"id", "do"}: what the shell itself does or is ("close", "url",
// "visible", "size", "destroy": its window gone, "hang": its window's
// thread stuck for a minute, "pid", "drawing": with compositing or not,
// "stderr": 200 KB written to it).
#[cfg(feature = "test-hooks")]
fn test_hooks(app: AppHandle) {
    std::thread::spawn(move || {
        use std::io::BufRead;
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(cmd) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
            let id = cmd["id"].as_str().unwrap_or("").to_string();
            let win = main_window(&app);
            if let Some(what) = cmd["do"].as_str() {
                let v = match (what, &win) {
                    ("pid", _) => serde_json::json!(std::process::id()),
                    // 200 KB on its stderr, as GTK and WebKit write theirs: true once written (never, if it blocks).
                    ("stderr", _) => {
                        for i in 0..2000 {
                            eprintln!("a test's line {i} on stderr {}", "x".repeat(80));
                        }
                        serde_json::json!(true)
                    }
                    ("hang", _) => {
                        let _ = app.run_on_main_thread(|| std::thread::sleep(Duration::from_secs(60)));
                        serde_json::json!(true)
                    }
                    (_, None) => serde_json::json!(null),
                    ("close", Some(w)) => serde_json::json!(w.close().is_ok()),
                    ("destroy", Some(w)) => serde_json::json!(w.destroy().is_ok()),
                    ("url", Some(w)) => serde_json::json!(w.url().map(|u| u.to_string()).unwrap_or_default()),
                    ("visible", Some(w)) => serde_json::json!(w.is_visible().unwrap_or(false)),
                    // How its page draws: {"policy": WebKit's ("never": no compositing), "cpu_painting"}.
                    ("drawing", Some(w)) => platform::drawing(w),
                    ("size", Some(w)) => {
                        let s = w.inner_size().unwrap_or_default();
                        serde_json::json!([s.width, s.height])
                    }
                    _ => serde_json::json!(null),
                };
                println!("@@{id} {v}");
                continue;
            }
            let Some(win) = win else {
                println!("@@{id} {}", serde_json::json!({"error": "no window"}));
                continue;
            };
            let js = cmd["js"].as_str().unwrap_or("null").to_string();
            let fail = id.clone();
            if let Err(e) = win.eval_with_callback(js, move |v| println!("@@{id} {v}")) {
                println!("@@{fail} {}", serde_json::json!({"error": e.to_string()}));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_is_the_configs() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
    }

    #[test]
    fn colors() {
        assert_eq!(parse_color("#1a1b26"), Some(Color(0x1a, 0x1b, 0x26, 0xff)));
        assert_eq!(parse_color("rgb(26, 27, 38)"), Some(Color(26, 27, 38, 0xff)));
        assert_eq!(parse_color("rgba(26, 27, 38, 0.5)"), Some(Color(26, 27, 38, 0xff)));
        assert_eq!(parse_color("rgb(26 27 38 / 50%)"), Some(Color(26, 27, 38, 0xff)));
        assert_eq!(parse_color("red"), None);
        assert_eq!(parse_color("#fff"), None);
    }

    #[test]
    fn arguments() {
        let a = args(&["x".into(), "--hidden".into(), "amarchy://chat/m/i".into()]).unwrap();
        assert!(a.hidden && a.link.is_some());
        assert!(args(&["x".into(), "amarchy://nope".into()]).is_err());
        assert!(args(&["x".into(), "--bogus".into()]).is_err());
        let r = args(&["x".into(), "--after".into(), "12".into(), "--route".into(), "#/s/a".into()]).unwrap();
        assert_eq!((r.after, r.route.as_deref()), (Some(12), Some("#/s/a")));
        assert_eq!(args(&["x".into(), "--route".into(), "javascript:x".into()]).unwrap().route, None);
    }

    #[test]
    fn page_told() {
        let off = init_script(false, true);
        assert!(off.contains("omarchy: false") && !off.contains("on-omarchy") && off.contains("gpu: true"));
        let on = init_script(true, false);
        assert!(on.contains("omarchy: true") && on.contains("classList.add('on-omarchy')") && on.contains("gpu: false"));
    }
}
