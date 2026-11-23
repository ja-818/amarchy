// What its page can play, and its sounds played by the app itself when the
// page can't.
//
// WebKitGTK plays a page's sounds with GStreamer, in its page's process.
// Without GStreamer's audio sink (autoaudiosink, in gst-plugins-good) an
// <audio> or a <video> that loads ends that process (WebKit aborts: on
// Julian's M5 the window's page crashed each time a chime rang, 2026-11-22),
// and without its decoders (wavparse; oggdemux, vorbisdec) the chimes don't
// play. So before the window, the app asks the same GStreamer (its library,
// its plugins) whether it has them, and when it doesn't:
//
//   - its page loads no media at all (a Content-Security-Policy of
//     media-src 'none', in place before the page's own scripts run): a
//     chime, a chime's preview or a post's video can't end it;
//   - the page's sounds (the chimes, a preview, Mission complete's) are
//     played by the app itself, with PipeWire's pw-play (or paplay): those
//     the page asks for (window.amarchyDesktopMedia.play), and each
//     notification's;
//   - it's said: in its log, once in a notification, in Settings, and when
//     dictation (which needs GStreamer's audio too) can't start;
//   - it watches GStreamer's plugins: once what's missing is installed, it
//     starts again by itself, its page playing them again.
//
// AMARCHY_DESKTOP_SOUND=1 lets the page play them even so (to try it).
// Linux only: macOS and Windows play a page's sounds with their own.

// (Its page's side, what GStreamer lacks and a crash's words, is Linux's alone.)
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// What this computer's web view lacks, as its page is told
/// (window.amarchyDesktopMedia): only when it lacks something.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Lacks {
    /// Whether the page plays its sounds (and loads media) itself.
    pub sounds: bool,
    /// Whether dictation can start here (a microphone through GStreamer, and its audio).
    pub dictation: bool,
    /// Whether the app plays the page's sounds when the page can't (pw-play or paplay is here).
    pub native: bool,
    /// GStreamer's elements it lacks.
    pub missing: Vec<String>,
    /// The packages that have them, in words ("gst-plugins-good and gst-plugin-pipewire"),
    /// and the command that installs them.
    pub packages: String,
    pub fix: String,
}

static LACKS: Mutex<Option<Lacks>> = Mutex::new(None);

/// What this computer's web view lacks, if anything.
pub fn lacks() -> Option<Lacks> {
    LACKS.lock().unwrap().clone()
}

/// Whether its page plays sounds and loads media (else the app plays them).
pub fn page_plays() -> bool {
    lacks().map(|l| l.sounds).unwrap_or(true)
}

/// A line GStreamer (or WebKit's media) wrote: what a crash playing a sound says before it.
pub fn gstreamer_said(line: &str) -> bool {
    ["GStreamer", "gst_", "Gst", "missing a plug-in", "audiosink", "decodebin"].iter().any(|w| line.contains(w))
}

/// Its page's process crashed with GStreamer's words before it: from now
/// on (this run) its page loads no media and the app plays its sounds.
/// Whether that's new.
pub fn crashed() -> bool {
    let mut l = LACKS.lock().unwrap();
    if l.as_ref().is_some_and(|l| !l.sounds) {
        return false;
    }
    let mut now = l.clone().unwrap_or_else(|| Lacks { dictation: true, ..Default::default() });
    now.sounds = false;
    now.native = player().is_some();
    *l = Some(now);
    true
}

/// The page's script, before its own (each page it loads): what this
/// computer lacks, and when its sounds are the app's, no media at all.
pub fn page_script(l: &Lacks) -> String {
    let lacks = serde_json::to_string(l).unwrap_or_else(|_| "{}".into());
    format!(
        r#"(() => {{
  const lacks = {lacks};
  let n = 0;
  const post = (m) => {{ try {{ window.webkit.messageHandlers.amarchySound.postMessage(JSON.stringify(m)); }} catch (e) {{ /* not the app's */ }} }};
  window.amarchyDesktopMedia = Object.freeze({{ ...lacks,
    play(src, o) {{
      if (lacks.sounds || !lacks.native) return () => {{}};
      const id = ++n;
      post({{ play: String(src), volume: o && typeof o.volume === "number" ? o.volume : 1, id }});
      return () => post({{ stop: id }});
    }} }});
  if (lacks.sounds) return;
  // No media here: one that loads would end this page's process.
  const guard = () => {{
    const m = document.createElement("meta");
    m.httpEquiv = "Content-Security-Policy";
    m.content = "media-src 'none'";
    document.head.prepend(m);
  }};
  if (document.head) guard();
  else new MutationObserver((_, o) => {{ if (document.head) {{ o.disconnect(); guard(); }} }}).observe(document, {{ childList: true, subtree: true }});
}})();"#
    )
}

// ---- what plays them here, outside the web view

/// PipeWire's pw-play, else PulseAudio's paplay (each plays .wav, .ogg,
/// .oga, .flac, .opus and .mp3 through libsndfile): (its path, whether it's pw-play).
fn player() -> Option<(PathBuf, bool)> {
    let path = std::env::var_os("PATH")?;
    for (name, pw) in [("pw-play", true), ("paplay", false)] {
        for dir in std::env::split_paths(&path) {
            let p = dir.join(name);
            if executable(&p) {
                return Some((p, pw));
            }
        }
    }
    None
}

fn executable(p: &std::path::Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    p.is_file()
}

/// Those playing now, by the page's id (to stop one: a preview's when the next one starts).
static PLAYING: Mutex<Option<HashMap<u64, Child>>> = Mutex::new(None);
static CLEARED: std::sync::Once = std::sync::Once::new();

/// What the page asked of the app ({"play": "/sound/<name>", "volume", "id"}, {"stop": id}).
pub fn asked(app: &AppHandle, msg: &str) {
    if page_plays() {
        return;
    }
    let Ok(m) = serde_json::from_str::<serde_json::Value>(msg) else { return };
    if let Some(id) = m["stop"].as_u64() {
        // Asked to end (pw-play closes its stream); let go of once it has (play's thread).
        if let Some(c) = PLAYING.lock().unwrap().get_or_insert_with(HashMap::new).get_mut(&id) {
            #[cfg(unix)]
            // SAFETY: a signal to our own child, not yet waited for (its pid is still its).
            unsafe {
                libc::kill(c.id() as libc::pid_t, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            let _ = c.kill();
        }
        return;
    }
    if let Some(src) = m["play"].as_str() {
        play(app, src, m["volume"].as_f64().unwrap_or(1.0), m["id"].as_u64());
    }
}

/// One of the amarchy's sounds (/sound/<name>), played by the app itself,
/// off the window's thread: fetched once (kept while it runs) and handed to
/// pw-play. Whether it's played so (else the page plays it).
pub fn play(app: &AppHandle, src: &str, volume: f64, id: Option<u64>) -> bool {
    if page_plays() {
        return false;
    }
    let name = src.strip_prefix("/sound/").unwrap_or("");
    if name.is_empty() || name.contains('/') || name.contains("..") || src.len() > 300 {
        return true;
    }
    let Some((exe, pw)) = player() else {
        log::warn!("no sound: its page can't play {src}, and there's no pw-play or paplay to play it");
        return true;
    };
    let Some(t) = app.state::<crate::Shell>().target.lock().unwrap().clone() else { return true };
    let (app, src) = (app.clone(), src.to_string());
    let volume = volume.clamp(0.0, 1.0);
    std::thread::spawn(move || {
        let Some(file) = kept(&app, &t, &src) else {
            log::warn!("no sound: couldn't get {src} from {}", t.origin());
            return;
        };
        let mut cmd = std::process::Command::new(&exe);
        if pw {
            cmd.arg("--media-role=Notification").arg(format!("--volume={volume:.2}"));
        } else {
            cmd.arg(format!("--volume={}", (volume * 65536.0) as u32)).arg("--property=media.role=event");
        }
        cmd.arg(&file).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null());
        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("no sound: {} didn't start: {e}", exe.display());
                return;
            }
        };
        log::debug!("{src} played by {}", exe.display());
        // Kept by its id until it ends (or is stopped), then let go of.
        let key = id.unwrap_or_else(|| u64::MAX - u64::from(child.id()));
        PLAYING.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, child);
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            let mut playing = PLAYING.lock().unwrap();
            let map = playing.get_or_insert_with(HashMap::new);
            match map.get_mut(&key).map(|c| c.try_wait()) {
                Some(Ok(None)) => continue,
                _ => {
                    map.remove(&key);
                    break;
                }
            }
        }
    });
    true
}

/// The sound's file, fetched from the amarchy open (with its cookie when
/// it's this machine's) and kept while the app runs.
fn kept(app: &AppHandle, t: &crate::target::Target, src: &str) -> Option<PathBuf> {
    use std::hash::{Hash, Hasher};
    let dir = app.path().app_cache_dir().ok()?.join("sounds");
    // Kept from an earlier run: a sound of yours may have changed since.
    CLEARED.call_once(|| {
        let _ = std::fs::remove_dir_all(&dir);
    });
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (t.origin().as_str(), src).hash(&mut h);
    let file = dir.join(format!("{:016x}", h.finish()));
    if file.is_file() {
        return Some(file);
    }
    let bytes = crate::notify::fetch(app, t, src, 6_000_000)?;
    std::fs::create_dir_all(&dir).ok()?;
    let part = file.with_extension("part");
    std::fs::write(&part, bytes).ok()?;
    std::fs::rename(&part, &file).ok()?;
    Some(file)
}

// ---- what's asked of GStreamer (Linux)

#[cfg(target_os = "linux")]
pub use linux::{check, tell, watch};

#[cfg(not(target_os = "linux"))]
pub fn check() {}
#[cfg(not(target_os = "linux"))]
pub fn tell(_app: &AppHandle) {}
#[cfg(not(target_os = "linux"))]
pub fn watch(_app: &AppHandle) {}

#[cfg(target_os = "linux")]
mod linux {
    use super::{player, Lacks, LACKS};
    use std::path::PathBuf;
    use std::time::{Duration, SystemTime};
    use tauri::{AppHandle, Manager};

    #[derive(Clone, Copy, Debug, PartialEq)]
    enum Pkg {
        Good,
        Base,
        BaseLibs,
        PipeWire,
    }

    #[derive(Clone, Copy, Debug, PartialEq)]
    pub(super) enum Distro {
        Arch,
        Debian,
        Fedora,
        Other,
    }

    /// What the page's sounds need of GStreamer, and the package that has each.
    const SOUNDS: &[(&str, Pkg)] = &[
        ("autoaudiosink", Pkg::Good), // without it, a media element ends the page's process
        ("wavparse", Pkg::Good),      // the chimes (.wav)
        ("oggdemux", Pkg::Base),      // and the .oga ones
        ("vorbisdec", Pkg::Base),
        ("decodebin", Pkg::BaseLibs), // Web Audio's decoding
        ("audioconvert", Pkg::BaseLibs),
        ("audioresample", Pkg::BaseLibs),
        ("appsink", Pkg::BaseLibs),
    ];
    /// What dictation needs too: a microphone (one of these), and the audio
    /// its page listens with.
    const MIC: &[(&str, Pkg)] = &[("pipewiresrc", Pkg::PipeWire), ("pulsesrc", Pkg::Good)];
    const LISTENS: &[&str] = &["autoaudiosink", "audioconvert", "audioresample"];

    impl Pkg {
        fn name(self, d: Distro) -> &'static str {
            match (d, self) {
                (Distro::Debian, Pkg::Good) => "gstreamer1.0-plugins-good",
                (Distro::Debian, Pkg::Base | Pkg::BaseLibs) => "gstreamer1.0-plugins-base",
                (Distro::Debian, Pkg::PipeWire) => "gstreamer1.0-pipewire",
                (Distro::Fedora, Pkg::Good) => "gstreamer1-plugins-good",
                (Distro::Fedora, Pkg::Base | Pkg::BaseLibs) => "gstreamer1-plugins-base",
                (Distro::Fedora, Pkg::PipeWire) => "pipewire-gstreamer",
                (_, Pkg::Good) => "gst-plugins-good",
                (_, Pkg::Base) => "gst-plugins-base",
                (_, Pkg::BaseLibs) => "gst-plugins-base-libs",
                (_, Pkg::PipeWire) => "gst-plugin-pipewire",
            }
        }
    }

    fn distro() -> Distro {
        let on = |tool: &str| ["/usr/bin", "/bin", "/usr/sbin"].iter().any(|d| std::path::Path::new(d).join(tool).exists());
        if on("pacman") {
            Distro::Arch
        } else if on("apt-get") {
            Distro::Debian
        } else if on("dnf") {
            Distro::Fedora
        } else {
            Distro::Other
        }
    }

    pub(super) fn fix(d: Distro, pkgs: &[&str]) -> String {
        let all = pkgs.join(" ");
        match d {
            Distro::Arch => format!("sudo pacman -S --needed {all}"),
            Distro::Debian => format!("sudo apt install {all}"),
            Distro::Fedora => format!("sudo dnf install {all}"),
            Distro::Other => format!("install GStreamer's {} with your packages", pkgs.join(", ")),
        }
    }

    pub(super) fn and_list(items: &[&str]) -> String {
        match items {
            [] => String::new(),
            [one] => one.to_string(),
            [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
        }
    }

    /// What it lacks, by what GStreamer has (has: an element's there).
    pub(super) fn lacking(has: &dyn Fn(&str) -> bool, d: Distro, native: bool) -> Option<Lacks> {
        let mut missing: Vec<(&str, Pkg)> = SOUNDS.iter().filter(|(e, _)| !has(e)).copied().collect();
        let sounds = missing.is_empty();
        let mic = MIC.iter().any(|(e, _)| has(e));
        if !mic {
            missing.push(MIC[0]);
        }
        if missing.is_empty() {
            return None;
        }
        let mut pkgs: Vec<&str> = Vec::new();
        for (_, p) in &missing {
            let n = p.name(d);
            if !pkgs.contains(&n) {
                pkgs.push(n);
            }
        }
        Some(Lacks {
            sounds,
            dictation: mic && LISTENS.iter().all(|e| has(e)),
            native: !sounds && native,
            missing: missing.iter().map(|(e, _)| e.to_string()).collect(),
            packages: and_list(&pkgs),
            fix: fix(d, &pkgs),
        })
    }

    /// Before the window: what this computer's GStreamer has for the page, in the log.
    pub fn check() {
        let t0 = std::time::Instant::now();
        let Some(version) = gst::version() else {
            log::warn!("sound: couldn't ask GStreamer what it has (libgstreamer-1.0 didn't load): the page plays its sounds as it can");
            return;
        };
        let has = |e: &str| gst::has(e);
        let mut l = lacking(&has, distro(), player().is_some());
        let took = t0.elapsed().as_millis();
        match &mut l {
            None => log::info!("sound: GStreamer {version} has what the page's sounds and dictation need ({took} ms)"),
            Some(l) => {
                log::warn!(
                    "sound: GStreamer {version} lacks {} ({}; {took} ms)",
                    l.missing.join(", "),
                    l.packages
                );
                if std::env::var_os("AMARCHY_DESKTOP_SOUND").is_some() && !l.sounds {
                    l.sounds = true;
                    l.native = false;
                    log::warn!("sound: AMARCHY_DESKTOP_SOUND=1: the page plays its sounds even so (a media element may end its process)");
                } else if !l.sounds {
                    log::warn!(
                        "sound: its page loads no media (one would end its process), and {}",
                        if l.native { "the app plays the page's sounds itself" } else { "there's no pw-play or paplay to play its sounds: none" }
                    );
                }
                if !l.dictation {
                    log::warn!("sound: dictation can't start here");
                }
                log::warn!("sound: to fix it: {}", l.fix);
            }
        }
        *LACKS.lock().unwrap() = l;
    }

    /// Said once (for what it lacks now): a notification, its click on Settings.
    pub fn tell(app: &AppHandle) {
        let Some(l) = super::lacks() else { return };
        let f = crate::target::state_dir().join("desktop/media.json");
        let told = std::fs::read_to_string(&f)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v["told"].as_str().map(str::to_string));
        if told.as_deref() == Some(l.fix.as_str()) {
            return;
        }
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(&f, serde_json::json!({ "told": l.fix }).to_string() + "\n");
        let (it, there) = if l.packages.contains(" and ") { ("them", "they're") } else { ("it", "it's") };
        let body = match (l.sounds, l.native, l.dictation) {
            (false, true, false) => format!("Amarchy plays its sounds itself meanwhile; dictation waits on {it}."),
            (false, true, true) => "Amarchy plays its sounds itself meanwhile.".to_string(),
            (false, false, false) => format!("Amarchy can't play its sounds or take dictation until {there} installed."),
            (false, false, true) => format!("Amarchy can't play its sounds until {there} installed."),
            (true, _, _) => format!("Dictation in Amarchy waits on {it}."),
        };
        let (app, title, body) = (app.clone(), format!("This computer lacks {}", l.packages), format!("{body} {}", l.fix));
        std::thread::spawn(move || {
            use notify_rust::{Hint, Notification};
            let shown = Notification::new()
                .appname("Amarchy")
                .summary(&title)
                .body(&body)
                .icon("amarchy")
                .hint(Hint::DesktopEntry("amarchy".into()))
                .action("default", "Open")
                .show();
            match shown {
                Ok(h) => h.wait_for_action(|a| {
                    if a == "default" {
                        let app2 = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            crate::show(&app2);
                            if let Some(w) = app2.get_webview_window("main") {
                                let _ = w.eval("if (typeof openSettings === 'function') openSettings();");
                            }
                        });
                    }
                }),
                Err(e) => log::warn!("couldn't say what GStreamer lacks: {e}"),
            }
        });
    }

    /// While it lacks something: GStreamer's plugin folders watched; once
    /// what's missing is there, it starts again (its page's process with it).
    pub fn watch(app: &AppHandle) {
        let Some(was) = super::lacks() else { return };
        let app = app.clone();
        std::thread::spawn(move || {
            let mut seen = stamps();
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let now = stamps();
                if now == seen {
                    continue;
                }
                seen = now;
                gst::rescan();
                let has = |e: &str| gst::has(e);
                let back: Vec<&String> = was.missing.iter().filter(|e| has(e)).collect();
                if back.is_empty() {
                    continue;
                }
                log::info!(
                    "sound: GStreamer has {} now: starting again, its page with it",
                    back.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                );
                let app2 = app.clone();
                let _ = app.run_on_main_thread(move || crate::restart(&app2, None));
                return;
            }
        });
    }

    /// GStreamer's plugin folders (its own, and those the environment
    /// names) and when each last changed.
    fn stamps() -> Vec<(PathBuf, Option<SystemTime>)> {
        let mut dirs: Vec<PathBuf> = Vec::new();
        for var in ["GST_PLUGIN_SYSTEM_PATH_1_0", "GST_PLUGIN_SYSTEM_PATH", "GST_PLUGIN_PATH_1_0", "GST_PLUGIN_PATH"] {
            if let Some(v) = std::env::var_os(var) {
                dirs.extend(std::env::split_paths(&v).filter(|p| !p.as_os_str().is_empty()));
            }
        }
        dirs.extend(gst::plugin_dir());
        if let Some(data) = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share"))) {
            dirs.push(data.join("gstreamer-1.0/plugins"));
        }
        dirs.sort();
        dirs.dedup();
        dirs.into_iter()
            .map(|d| {
                let t = std::fs::metadata(&d).and_then(|m| m.modified()).ok();
                (d, t)
            })
            .collect()
    }

    /// GStreamer, the library WebKit's page process plays with (already
    /// loaded with WebKitGTK), asked through its C functions.
    mod gst {
        use std::ffi::{c_char, c_int, c_uint, c_void, CStr, CString};
        use std::path::PathBuf;
        use std::sync::OnceLock;

        type Init = unsafe extern "C" fn(*mut c_int, *mut c_void, *mut c_void) -> c_int;
        type Version = unsafe extern "C" fn(*mut c_uint, *mut c_uint, *mut c_uint, *mut c_uint);
        type Find = unsafe extern "C" fn(*const c_char) -> *mut c_void;
        type Unref = unsafe extern "C" fn(*mut c_void);
        type Update = unsafe extern "C" fn() -> c_int;
        type Registry = unsafe extern "C" fn() -> *mut c_void;
        type FindPlugin = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_void;
        type Filename = unsafe extern "C" fn(*mut c_void) -> *const c_char;

        struct Gst {
            find: Find,
            unref: Unref,
            update: Update,
            registry: Registry,
            find_plugin: FindPlugin,
            filename: Filename,
            version: String,
        }

        // SAFETY: plain function pointers into a library that stays loaded.
        unsafe impl Send for Gst {}
        unsafe impl Sync for Gst {}

        static GST: OnceLock<Option<Gst>> = OnceLock::new();

        fn load() -> Option<Gst> {
            // SAFETY: dlopen/dlsym of GStreamer's documented C functions, with
            // their C signatures; gst_init_check is safe to call more than once.
            unsafe {
                let lib = libc::dlopen(c"libgstreamer-1.0.so.0".as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
                if lib.is_null() {
                    return None;
                }
                let sym = |name: &CStr| {
                    let p = libc::dlsym(lib, name.as_ptr());
                    (!p.is_null()).then_some(p)
                };
                use std::mem::transmute;
                let init = transmute::<*mut c_void, Init>(sym(c"gst_init_check")?);
                let version = transmute::<*mut c_void, Version>(sym(c"gst_version")?);
                let g = Gst {
                    find: transmute::<*mut c_void, Find>(sym(c"gst_element_factory_find")?),
                    unref: transmute::<*mut c_void, Unref>(sym(c"gst_object_unref")?),
                    update: transmute::<*mut c_void, Update>(sym(c"gst_update_registry")?),
                    registry: transmute::<*mut c_void, Registry>(sym(c"gst_registry_get")?),
                    find_plugin: transmute::<*mut c_void, FindPlugin>(sym(c"gst_registry_find_plugin")?),
                    filename: transmute::<*mut c_void, Filename>(sym(c"gst_plugin_get_filename")?),
                    version: String::new(),
                };
                if init(std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) == 0 {
                    return None;
                }
                let (mut a, mut b, mut c, mut d) = (0, 0, 0, 0);
                version(&mut a, &mut b, &mut c, &mut d);
                Some(Gst { version: format!("{a}.{b}.{c}"), ..g })
            }
        }

        fn get() -> Option<&'static Gst> {
            GST.get_or_init(load).as_ref()
        }

        pub fn version() -> Option<String> {
            get().map(|g| g.version.clone())
        }

        /// Whether GStreamer has the element (its factory).
        pub fn has(element: &str) -> bool {
            let (Some(g), Ok(name)) = (get(), CString::new(element)) else { return true };
            // SAFETY: a factory found is a new reference, given back at once.
            unsafe {
                let f = (g.find)(name.as_ptr());
                if f.is_null() {
                    return false;
                }
                (g.unref)(f);
                true
            }
        }

        /// Its plugins looked at again (some installed since).
        pub fn rescan() {
            if let Some(g) = get() {
                // SAFETY: gst_update_registry takes the registry's own lock.
                unsafe {
                    (g.update)();
                }
            }
        }

        /// The folder its own plugins are in (its core elements' plugin's).
        pub fn plugin_dir() -> Option<PathBuf> {
            let g = get()?;
            // SAFETY: the default registry isn't ours to free; the plugin
            // found is a new reference, given back once its file name is copied.
            unsafe {
                let p = (g.find_plugin)((g.registry)(), c"coreelements".as_ptr());
                if p.is_null() {
                    return None;
                }
                let f = (g.filename)(p);
                let path = (!f.is_null()).then(|| PathBuf::from(CStr::from_ptr(f).to_string_lossy().into_owned()));
                (g.unref)(p);
                path?.parent().map(|d| d.to_path_buf())
            }
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::linux::*;

    #[test]
    fn lacking() {
        let none = |_: &str| true;
        assert_eq!(super::linux::lacking(&none, Distro::Arch, true), None);
        // Julian's M5: GStreamer and its base libraries, nothing else.
        let base_libs = |e: &str| ["decodebin", "audioconvert", "audioresample", "appsink"].contains(&e);
        let l = super::linux::lacking(&base_libs, Distro::Arch, true).unwrap();
        assert!(!l.sounds && !l.dictation && l.native);
        assert_eq!(l.packages, "gst-plugins-good, gst-plugins-base and gst-plugin-pipewire");
        assert_eq!(l.fix, "sudo pacman -S --needed gst-plugins-good gst-plugins-base gst-plugin-pipewire");
        assert!(l.missing.starts_with(&["autoaudiosink".to_string(), "wavparse".to_string()]));
        // Only the microphone's: its sounds play, dictation waits.
        let no_mic = |e: &str| !["pipewiresrc", "pulsesrc"].contains(&e);
        let l = super::linux::lacking(&no_mic, Distro::Debian, false).unwrap();
        assert!(l.sounds && !l.dictation && !l.native);
        assert_eq!(l.fix, "sudo apt install gstreamer1.0-pipewire");
        assert_eq!(and_list(&["a"]), "a");
    }

    #[test]
    fn page_script() {
        let l = super::Lacks { sounds: false, native: true, packages: "gst-plugins-good".into(), fix: "sudo pacman -S x".into(), ..Default::default() };
        let s = super::page_script(&l);
        assert!(s.contains("media-src 'none'") && s.contains("amarchySound") && s.contains(r#""fix":"sudo pacman -S x""#));
        assert!(super::gstreamer_said("GStreamer element autoaudiosink not found. Please install it"));
        assert!(!super::gstreamer_said("MESA-EGL: warning: DRI3 error"));
    }
}
