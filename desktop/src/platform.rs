// What each system needs before the window, and of its web view.

/// Before anything starts (no threads yet: the environment is set here).
/// Every start does it, one that only hands its arguments over too.
pub fn prepare() {
    #[cfg(target_os = "linux")]
    linux::prepare();
}

/// In the one that runs (not a start that hands over and ends), before its
/// window: said in the log once, and what its page can play asked.
pub fn started() {
    #[cfg(target_os = "linux")]
    linux::started();
}

// ---- safe rendering, after its page's process crashed with no sign why
//
// Its page's process crashing is first asked why: what it wrote last. One
// that crashed with GStreamer's words before it was playing a sound or a
// video (sound.rs): its page loads no media from then on, and the GPU isn't
// blamed. One that crashed with no sign why loads again; twice in ten
// minutes, it draws without the GPU's DMA-BUF and compositing from then on
// (a new or experimental driver: Apple Silicon's, NVIDIA's), kept in
// rendering.json; AMARCHY_DESKTOP_GPU=1 tries the GPU again.

fn rendering_file() -> std::path::PathBuf {
    crate::target::state_dir().join("desktop/rendering.json")
}

/// Whether it draws the safe way (and why), as kept.
pub fn safe_rendering() -> Option<String> {
    if std::env::var_os("AMARCHY_DESKTOP_GPU").is_some() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(rendering_file()).ok()?).ok()?;
    v["safe"].as_bool().filter(|s| *s).map(|_| v["why"].as_str().unwrap_or("its page crashed").to_string())
}

/// From now on, the safe way (why: what crashed).
pub fn keep_safe_rendering(why: &str) {
    let f = rendering_file();
    let _ = std::fs::create_dir_all(f.parent().unwrap());
    let _ = std::fs::write(&f, serde_json::json!({ "safe": true, "why": why, "cause": "unexplained" }).to_string() + "\n");
}

/// The safe way as the build before kept it (after any crash, its cause
/// not asked: on Julian's M5 they were sounds): forgotten, so it draws with
/// the GPU again until a crash with no sign why says otherwise. Whether it was.
fn forget_blind_safe_rendering() -> bool {
    let f = rendering_file();
    let Some(v) = std::fs::read_to_string(&f).ok().and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) else {
        return false;
    };
    if v.get("cause").is_some() {
        return false;
    }
    std::fs::remove_file(&f).is_ok()
}

/// Its page's process crashed with no sign why: when (the last ten minutes').
static UNEXPLAINED: std::sync::Mutex<Vec<std::time::Instant>> = std::sync::Mutex::new(Vec::new());
const UNEXPLAINED_WITHIN: std::time::Duration = std::time::Duration::from_secs(600);

/// A crash with no sign why: whether it's the one that makes it draw the
/// safe way (the second in ten minutes).
fn unexplained_again() -> bool {
    let mut u = UNEXPLAINED.lock().unwrap();
    u.retain(|t| t.elapsed() < UNEXPLAINED_WITHIN);
    u.push(std::time::Instant::now());
    u.len() >= 2
}

/// The last few of what was said, on a line.
fn last_words(lines: &[&String], n: usize) -> String {
    let from = lines.len().saturating_sub(n);
    lines[from..].iter().map(|l| l.trim()).collect::<Vec<_>>().join(" | ")
}

// ---- no GPU here: its page painted on the CPU
//
// WebKit paints its page's tiles through GL (Skia's GPU raster) and
// composites them through GL. Where there's no GPU to draw with (a
// computer whose GPU driver isn't there yet, as Apple's M5 on Linux today;
// a virtual machine), Mesa runs that GL on the CPU (llvmpipe): every frame
// is a GPU's work emulated, and a page that moves at all costs a core,
// the keys you press waiting in line behind its frames. There its tiles are
// painted with Skia's own CPU raster (WEBKIT_SKIA_ENABLE_CPU_RENDERING),
// what a CPU does well; compositing stays (without it, WebKit 2.54 paints
// on the page's own thread, slower still, and held keys came out seconds
// late). What draws its GL is asked of EGL in a process of its own
// (--graphics: a driver that hangs or crashes takes only that one down),
// before the window. The page draws as few frames as it can (app.js, the
// beat) wherever it is.

/// Whether there's no GPU to draw with here (its page painted on the CPU):
/// set once, before the window.
static NO_GPU: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Whether its page has a GPU to draw with (as far as it knows: true
/// unless EGL said the CPU draws its GL). The page is told
/// (amarchyDesktop.gpu): without one, what moves steps half as often.
pub fn gpu() -> bool {
    !NO_GPU.get().copied().unwrap_or(false)
}

/// Whether a GL renderer (GL_RENDERER) is one drawn by the CPU.
pub fn software_renderer(renderer: &str) -> bool {
    let r = renderer.to_ascii_lowercase();
    ["llvmpipe", "softpipe", "swrast", "swiftshader", "software rasterizer"].iter().any(|s| r.contains(s))
}

/// Why there's no GPU to draw with, by what draws its GL (None: unknown),
/// and whether there's a render node at all.
fn no_gpu_why(renderer: Option<&str>, render_node: bool) -> Option<String> {
    match renderer {
        Some(r) if software_renderer(r) => Some(format!("its GL is drawn on the CPU ({r}): no GPU driver here")),
        Some(_) => None,
        None if !render_node => Some("no GPU here (no render node in /dev/dri)".into()),
        None => None,
    }
}

/// `amarchy-desktop --graphics`: what draws its GL here, and so how its
/// window draws (also how a start asks, in a process of its own).
pub fn print_graphics() {
    #[cfg(target_os = "linux")]
    {
        let renderer = linux::gl_renderer();
        println!("renderer: {}", renderer.as_deref().unwrap_or("unknown (EGL didn't say)"));
        let how = if std::env::var_os("AMARCHY_DESKTOP_GPU").is_some() {
            "through GL, as WebKit does by default (AMARCHY_DESKTOP_GPU)".to_string()
        } else if let Some(why) = no_gpu_why(renderer.as_deref(), linux::render_node()) {
            format!("its page painted on the CPU (Skia), composited: {why}")
        } else {
            "through the GPU (WebKit's default)".to_string()
        };
        let how = match safe_rendering() {
            Some(why) => format!("without compositing (the safe way, since {why}); else {how}"),
            None => how,
        };
        println!("draws: {how}");
    }
    #[cfg(not(target_os = "linux"))]
    println!("draws: as the system's web view does (WebKit's or WebView2's own)");
}

/// The window's way to the tailnet: through amarchy's own node's proxy
/// (Some), or straight (None). Never for this computer's own addresses.
pub fn proxy(win: &tauri::WebviewWindow, url: Option<&str>) {
    #[cfg(target_os = "linux")]
    linux::proxy(win, url);
    #[cfg(not(target_os = "linux"))]
    let _ = (win, url);
}

/// Whether its window is on an Omarchy desktop: Hyprland's session, with
/// Omarchy's look in place (its current theme, where Omarchy 4 keeps it).
/// There the window is one of the desktop's: see-through (what its page leaves
/// unpainted shows the desktop behind it), faded as its terminals are
/// (omarchy/hypr/amarchy.lua); wearing the desktop's look live, its page
/// paints no wallpaper and nothing under it, so the desktop's own wallpaper
/// shows through its panes and cards as a browser shows the app's (app.css,
/// html.on-omarchy).
pub fn omarchy() -> bool {
    #[cfg(target_os = "linux")]
    return linux::omarchy();
    #[cfg(not(target_os = "linux"))]
    false
}

/// How its page draws now, for the tests: WebKit's hardware acceleration
/// policy ("always", "never"), and whether its tiles are painted on the CPU.
#[cfg(feature = "test-hooks")]
pub fn drawing(win: &tauri::WebviewWindow) -> serde_json::Value {
    let cpu = std::env::var_os("WEBKIT_SKIA_ENABLE_CPU_RENDERING").is_some_and(|v| v == "1");
    #[cfg(target_os = "linux")]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::{SettingsExt, WebViewExt};
            let p = WebViewExt::settings(&wv.inner()).map(|s| match s.hardware_acceleration_policy() {
                webkit2gtk::HardwareAccelerationPolicy::Never => "never".to_string(),
                webkit2gtk::HardwareAccelerationPolicy::Always => "always".to_string(),
                other => format!("{other:?}").to_lowercase(),
            });
            let _ = tx.send(p);
        });
        let policy = rx.recv_timeout(std::time::Duration::from_secs(5)).ok().flatten();
        serde_json::json!({ "policy": policy, "cpu_painting": cpu })
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = win;
        serde_json::json!({ "policy": null, "cpu_painting": cpu })
    }
}

/// The web view's own settings, once it's made.
pub fn webview(win: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    linux::webview(win);
    #[cfg(not(target_os = "linux"))]
    let _ = win;
}

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::RefCell;
    use std::os::unix::net::UnixStream;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    /// The safe way an earlier build kept, forgotten by prepare (said by started).
    static FORGOT: AtomicBool = AtomicBool::new(false);

    pub fn prepare() {
        // The app id Hyprland, the launcher and the bar know it by
        // (amarchy.desktop): Wayland's app_id and X11's class come from it.
        gtk::glib::set_prgname(Some("amarchy"));
        gtk::glib::set_application_name("Amarchy");

        // NVIDIA's driver and WebKitGTK's DMA-BUF renderer: a blank or
        // flickering window. The renderer WebKit falls back to works.
        if Path::new("/proc/driver/nvidia/version").exists() && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if super::forget_blind_safe_rendering() {
            FORGOT.store(true, Ordering::SeqCst);
        }
        // Its page crashed before with no sign why: drawn the safe way (no DMA-BUF, no compositing).
        if super::safe_rendering().is_some() {
            for var in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE"] {
                if std::env::var_os(var).is_none() {
                    std::env::set_var(var, "1");
                }
            }
        }
        // No GPU to draw with (what draws its GL, as kept: graphics_kept):
        // its tiles painted by Skia's CPU raster, not GL emulated on the CPU.
        let renderer = if std::env::var_os("AMARCHY_DESKTOP_GPU").is_some() { None } else { graphics_kept() };
        let no_gpu = renderer.as_ref().and_then(|r| super::no_gpu_why(r.as_deref(), render_node()));
        let _ = RENDERER.set(renderer);
        let _ = super::NO_GPU.set(no_gpu.is_some());
        if no_gpu.is_some() && std::env::var_os("WEBKIT_SKIA_ENABLE_CPU_RENDERING").is_none() {
            std::env::set_var("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "1");
        }

        // No PulseAudio answering (a machine without PipeWire's pulse
        // server): GStreamer's pulse probe looks for one every way it knows,
        // 5 s each, and the page freezes 10 s the first time the mic is
        // asked for. Told where the one socket is, it gives up at once (the
        // microphone comes through PipeWire's own provider).
        if std::env::var_os("PULSE_SERVER").is_none() {
            if let Some(run) = std::env::var_os("XDG_RUNTIME_DIR") {
                let socket = Path::new(&run).join("pulse/native");
                if UnixStream::connect(&socket).is_err() {
                    std::env::set_var("PULSE_SERVER", format!("unix:{}", socket.display()));
                }
            }
        }

    }

    pub fn started() {
        if FORGOT.load(Ordering::SeqCst) {
            log::info!("drawing with the GPU again: the safe way was kept by an earlier build after a crash, without asking why (a sound's, most likely)");
        }
        let renderer = RENDERER.get().cloned().flatten();
        log::info!("graphics: {}; GL: {}", graphics(), renderer.as_ref().map(|r| r.as_deref().unwrap_or("unknown")).unwrap_or("not asked"));
        if omarchy() {
            log::info!("on an Omarchy desktop: the window is see-through as its terminals are, its look live drawn without a wallpaper of its own");
        }
        if let Some(why) = super::safe_rendering() {
            log::info!("drawing the safe way (no GPU compositing) since {why}; AMARCHY_DESKTOP_GPU=1 tries the GPU again");
        }
        if let Some(why) = renderer.as_ref().and_then(|r| super::no_gpu_why(r.as_deref(), render_node())) {
            log::info!("its page painted on the CPU (Skia's raster, not GL emulated on it): {why}; AMARCHY_DESKTOP_GPU=1 paints through GL anyway");
        }
        // Asked again meanwhile (a new Mesa that now drives this GPU, a driver
        // gone): kept for the next start.
        if std::env::var_os("AMARCHY_DESKTOP_GPU").is_none() {
            std::thread::spawn(move || {
                let now = gl_probe();
                if Some(&now) != renderer.as_ref() {
                    keep_graphics(&now);
                    log::info!("what draws its GL changed ({} now): from its next start", now.as_deref().unwrap_or("unknown"));
                }
            });
        }
        // What its page can play here (GStreamer's plugins), before the window.
        crate::sound::check();
    }

    pub fn omarchy() -> bool {
        let hyprland = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some_and(|s| !s.is_empty())
            || std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|d| d.split(':').any(|d| d.eq_ignore_ascii_case("hyprland")));
        if !hyprland {
            return false;
        }
        // Omarchy's state: $XDG_STATE_HOME's, else under $HOME (as its scripts read it).
        let state = [std::env::var_os("XDG_STATE_HOME").filter(|s| !s.is_empty()).map(std::path::PathBuf::from),
                     std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/state"))];
        state.into_iter().flatten().any(|s| s.join("omarchy/current/theme").is_dir())
    }

    pub fn proxy(win: &tauri::WebviewWindow, url: Option<&str>) {
        let url = url.map(str::to_string);
        let through = url.is_some();
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::{NetworkProxyMode, NetworkProxySettings, WebViewExt, WebsiteDataManagerExt};
            let Some(dm) = wv.inner().website_data_manager() else { return };
            match &url {
                Some(u) => {
                    let mut s = NetworkProxySettings::new(Some(u), &["localhost", "127.0.0.1", "::1"]);
                    dm.set_network_proxy_settings(NetworkProxyMode::Custom, Some(&mut s));
                }
                None => dm.set_network_proxy_settings(NetworkProxyMode::Default, None),
            }
        });
        if through {
            log::info!("its window reaches the tailnet through amarchy's own Tailscale node");
        }
    }

    /// What draws its GL, as prepare had it (None: not asked, AMARCHY_DESKTOP_GPU;
    /// Some(None): EGL didn't say), for started to say.
    static RENDERER: std::sync::OnceLock<Option<Option<String>>> = std::sync::OnceLock::new();

    fn graphics_file() -> std::path::PathBuf {
        crate::target::state_dir().join("desktop/graphics.json")
    }

    /// What tells this computer's graphics apart: its kernel, its GPUs' nodes
    /// and drivers. A new kernel or GPU driver asks EGL again before the window.
    fn graphics_sig() -> String {
        let kernel = std::fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default();
        let mut nodes: Vec<String> = std::fs::read_dir("/sys/class/drm")
            .map(|d| {
                d.flatten()
                    .map(|e| {
                        let driver = std::fs::read_link(e.path().join("device/driver")).ok();
                        format!("{}={}", e.file_name().to_string_lossy(), driver.as_deref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
                    })
                    .collect()
            })
            .unwrap_or_default();
        nodes.sort();
        format!("{}|{}", kernel.trim(), nodes.join(","))
    }

    /// What draws its GL here, as kept for this computer's graphics (asked
    /// of EGL before the window when it isn't: the first start, a new kernel
    /// or GPU driver), so a start that only hands its arguments over (a key,
    /// a link) never waits on it. The running one asks again (started).
    fn graphics_kept() -> Option<Option<String>> {
        let kept: Option<serde_json::Value> = std::fs::read_to_string(graphics_file()).ok().and_then(|s| serde_json::from_str(&s).ok());
        if let Some(v) = kept.filter(|v| v["sig"].as_str() == Some(&graphics_sig())) {
            return Some(v["renderer"].as_str().map(str::to_string));
        }
        let now = gl_probe();
        keep_graphics(&now);
        Some(now)
    }

    fn keep_graphics(renderer: &Option<String>) {
        let f = graphics_file();
        let _ = std::fs::create_dir_all(f.parent().unwrap());
        let _ = std::fs::write(&f, serde_json::json!({ "sig": graphics_sig(), "renderer": renderer }).to_string() + "\n");
    }

    /// Whether this computer has a render node (a GPU Mesa can draw with,
    /// when its driver's there).
    pub fn render_node() -> bool {
        std::fs::read_dir("/dev/dri")
            .map(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD")))
            .unwrap_or(false)
    }

    /// What draws its GL, asked of this same program in a process of its own
    /// (--graphics), so a driver that hangs or crashes there takes only that
    /// one down: None when it can't say within a few seconds.
    fn gl_probe() -> Option<String> {
        use std::io::Read;
        use std::process::{Command, Stdio};
        let exe = std::env::current_exe().ok()?;
        let mut child = Command::new(exe)
            .arg("--graphics")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let started = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if started.elapsed() < Duration::from_secs(4) => std::thread::sleep(Duration::from_millis(10)),
                _ => {
                    // (Killed, not waited for: one stuck in its driver may never end.)
                    let _ = child.kill();
                    log::warn!("asking EGL what draws its GL didn't end within 4 s: taken as unknown");
                    return None;
                }
            }
        }
        let mut out = String::new();
        child.stdout.take()?.read_to_string(&mut out).ok()?;
        out.lines()
            .find_map(|l| l.strip_prefix("renderer: "))
            .filter(|r| !r.starts_with("unknown"))
            .map(str::to_string)
    }

    /// What draws GL here, as EGL says (GL_RENDERER): the GPU's name, or
    /// Mesa's llvmpipe when the CPU does it. Asked on EGL's surfaceless
    /// platform (no window, no display), as WebKit's page process draws.
    pub fn gl_renderer() -> Option<String> {
        use std::ffi::{c_char, c_void, CStr};
        type Display = *mut c_void;
        const EGL_PLATFORM_SURFACELESS_MESA: u32 = 0x31DD;
        const EGL_OPENGL_ES_API: u32 = 0x30A0;
        const EGL_CONTEXT_CLIENT_VERSION: i32 = 0x3098;
        const EGL_NONE: i32 = 0x3038;
        const GL_RENDERER: u32 = 0x1F01;
        unsafe {
            let open = |name: &CStr| libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            let egl = open(c"libEGL.so.1");
            if egl.is_null() {
                return None;
            }
            let sym = |lib: *mut c_void, name: &CStr| -> *mut c_void { libc::dlsym(lib, name.as_ptr()) };
            let get_proc_ptr = sym(egl, c"eglGetProcAddress");
            if get_proc_ptr.is_null() {
                return None;
            }
            let get_proc: unsafe extern "C" fn(*const c_char) -> *mut c_void = std::mem::transmute(get_proc_ptr);
            let find = |name: &CStr| -> *mut c_void {
                let p = sym(egl, name);
                if p.is_null() { get_proc(name.as_ptr()) } else { p }
            };
            let mut gpd = get_proc(c"eglGetPlatformDisplayEXT".as_ptr());
            if gpd.is_null() {
                gpd = find(c"eglGetPlatformDisplay");
            }
            let (init, bind, create, current, terminate) =
                (find(c"eglInitialize"), find(c"eglBindAPI"), find(c"eglCreateContext"), find(c"eglMakeCurrent"), find(c"eglTerminate"));
            if [gpd, init, bind, create, current, terminate].iter().any(|p| p.is_null()) {
                return None;
            }
            let gpd: unsafe extern "C" fn(u32, *mut c_void, *const isize) -> Display = std::mem::transmute(gpd);
            let init: unsafe extern "C" fn(Display, *mut i32, *mut i32) -> u32 = std::mem::transmute(init);
            let bind: unsafe extern "C" fn(u32) -> u32 = std::mem::transmute(bind);
            let create: unsafe extern "C" fn(Display, *mut c_void, *mut c_void, *const i32) -> *mut c_void = std::mem::transmute(create);
            let current: unsafe extern "C" fn(Display, *mut c_void, *mut c_void, *mut c_void) -> u32 = std::mem::transmute(current);
            let terminate: unsafe extern "C" fn(Display) -> u32 = std::mem::transmute(terminate);
            let dpy = gpd(EGL_PLATFORM_SURFACELESS_MESA, std::ptr::null_mut(), std::ptr::null());
            let (mut major, mut minor) = (0, 0);
            if dpy.is_null() || init(dpy, &mut major, &mut minor) == 0 {
                return None;
            }
            let attrs = [EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE];
            // No config (EGL_KHR_no_config_context) and no surface (EGL_KHR_surfaceless_context): Mesa has both.
            let ctx = if bind(EGL_OPENGL_ES_API) != 0 { create(dpy, std::ptr::null_mut(), std::ptr::null_mut(), attrs.as_ptr()) } else { std::ptr::null_mut() };
            let mut out = None;
            if !ctx.is_null() && current(dpy, std::ptr::null_mut(), std::ptr::null_mut(), ctx) != 0 {
                let mut gs = get_proc(c"glGetString".as_ptr());
                if gs.is_null() {
                    let gles = open(c"libGLESv2.so.2");
                    if !gles.is_null() {
                        gs = sym(gles, c"glGetString");
                    }
                }
                if !gs.is_null() {
                    let gs: unsafe extern "C" fn(u32) -> *const c_char = std::mem::transmute(gs);
                    let r = gs(GL_RENDERER);
                    if !r.is_null() {
                        out = Some(CStr::from_ptr(r).to_string_lossy().trim().to_string()).filter(|s| !s.is_empty());
                    }
                }
                current(dpy, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
            }
            terminate(dpy);
            out
        }
    }

    /// The machine and its GPU's driver, for the log: what a crash was on.
    fn graphics() -> String {
        let mut out = Vec::new();
        if let Ok(c) = std::fs::read("/proc/device-tree/compatible") {
            let c = String::from_utf8_lossy(&c).replace('\0', " ");
            out.push(c.trim().to_string());
        }
        if let Ok(dir) = std::fs::read_dir("/sys/class/drm") {
            let mut drivers: Vec<String> = dir
                .flatten()
                .filter_map(|e| std::fs::read_link(e.path().join("device/driver")).ok())
                .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
                .collect();
            drivers.sort();
            drivers.dedup();
            out.push(format!("drm drivers: {}", if drivers.is_empty() { "none".into() } else { drivers.join(", ") }));
        }
        for var in ["WAYLAND_DISPLAY", "XDG_CURRENT_DESKTOP", "WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE", "WEBKIT_SKIA_ENABLE_CPU_RENDERING"] {
            if let Ok(v) = std::env::var(var) {
                out.push(format!("{var}={v}"));
            }
        }
        out.join("; ")
    }

    pub fn webview(win: &tauri::WebviewWindow) {
        use tauri::Manager;
        let handle = win.app_handle().clone();
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::{SettingsExt, UserContentManagerExt, WebViewExt};
            let view = wv.inner();
            let Some(s) = WebViewExt::settings(&view) else { return };
            // Kept after crashes: drawn without compositing.
            if super::safe_rendering().is_some() {
                s.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Never);
            }
            // The microphone (dictation): WebKitGTK has it off unless asked,
            // and denies it unless the app answers its permission request
            // (main.rs, on_permission_request).
            s.set_enable_media_stream(true);
            s.set_enable_mediasource(true);
            s.set_media_playback_requires_user_gesture(false);
            // What the server sees it as (its logs, dictation's device).
            let ua = s.user_agent().map(|u| u.to_string()).unwrap_or_default();
            if !ua.contains(" Amarchy/") {
                s.set_user_agent(Some(&format!("{ua} Amarchy/{}", env!("CARGO_PKG_VERSION"))));
            }
            s.set_enable_developer_extras(cfg!(debug_assertions) || std::env::var_os("AMARCHY_DESKTOP_DEVTOOLS").is_some());
            #[cfg(feature = "test-hooks")]
            if std::env::var_os("AMARCHY_DESKTOP_MOCK_MIC").is_some() {
                s.set_enable_mock_capture_devices(true);
            }
            // The sounds its page asks the app to play (sound.rs), when it
            // can't play them itself: window.webkit.messageHandlers.amarchySound.
            if let Some(ucm) = view.user_content_manager() {
                ucm.register_script_message_handler("amarchySound");
                let h = handle.clone();
                ucm.connect_script_message_received(Some("amarchySound"), move |_, r| {
                    if let Some(v) = r.js_value() {
                        crate::sound::asked(&h, &v.to_string());
                    }
                });
            }
            media_script(&view);
            page_errors(&view);
        });
        load_failures(win);
        process_ends(win);
    }

    /// What goes wrong in its page, in its log: an error nothing caught (a
    /// click whose handler threw), a promise nothing caught, console.error.
    /// Before the page's own scripts, each page it loads; at most 60 lines a
    /// minute, so a page throwing in a loop can't fill it.
    const PAGE_ERRORS: &str = r#"(() => {
  if (window.__amarchyLog) return;
  window.__amarchyLog = true;
  const post = (kind, what) => {
    try { window.webkit.messageHandlers.amarchyLog.postMessage(`${kind}: ${String(what).slice(0, 4000)}`); } catch (e) { /* not the app's */ }
  };
  const words = (x) => (x && x.stack) ? `${x.name || "Error"}: ${x.message}\n${x.stack}` : (x && typeof x === "object") ? (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })() : String(x);
  addEventListener("error", (e) => {
    if (e.target && e.target !== window && !(e instanceof ErrorEvent)) return;   // a picture or a script that didn't load: not the page's code
    post("error", e.error ? words(e.error) : `${e.message} (${e.filename}:${e.lineno}:${e.colno})`);
  }, true);
  addEventListener("unhandledrejection", (e) => post("a promise nothing caught", words(e.reason)));
  const said = console.error.bind(console);
  console.error = (...a) => {
    // Tauri's own complaint about a message to the app it couldn't read
    // (wry hears every page message, this one's and amarchySound's too, as
    // its IPC): not the page's error, and relaying it would make another.
    if (a.length === 1 && typeof a[0] === "string" && a[0].startsWith("JSON error: ")) return said(...a);
    const from = (new Error().stack || "").split("\n").slice(1, 4).join("\n");
    post("console.error", a.map(words).join(" ") + (from ? `\n${from}` : ""));
    said(...a);
  };
})();"#;

    /// Its page's errors (PAGE_ERRORS) heard and written down, as "page: …".
    fn page_errors(view: &webkit2gtk::WebView) {
        use webkit2gtk::{UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime, WebViewExt};
        let Some(ucm) = view.user_content_manager() else { return };
        ucm.register_script_message_handler("amarchyLog");
        let budget = std::cell::Cell::new((std::time::Instant::now(), 0u32));
        ucm.connect_script_message_received(Some("amarchyLog"), move |_, r| {
            let (since, n) = budget.get();
            let (since, n) = if since.elapsed() > Duration::from_secs(60) { (std::time::Instant::now(), 0) } else { (since, n) };
            budget.set((since, n + 1));
            if n == 60 {
                log::warn!("page: more errors this minute, not written down");
            }
            if n >= 60 {
                return;
            }
            if let Some(v) = r.js_value() {
                log::warn!("page: {}", v.to_string().replace('\n', "\n    "));
            }
        });
        ucm.add_script(&UserScript::new(PAGE_ERRORS, UserContentInjectedFrames::TopFrame, UserScriptInjectionTime::Start, &[], &[]));
    }

    thread_local! {
        /// The page's script of what this computer lacks (sound.rs), as added.
        static MEDIA_SCRIPT: RefCell<Option<webkit2gtk::UserScript>> = const { RefCell::new(None) };
    }

    /// What this computer lacks, told to each page it loads before the
    /// page's own scripts (and no media, when its sounds are the app's).
    fn media_script(view: &webkit2gtk::WebView) {
        use webkit2gtk::{UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime, WebViewExt};
        let Some(ucm) = view.user_content_manager() else { return };
        MEDIA_SCRIPT.with(|kept| {
            if let Some(old) = kept.borrow_mut().take() {
                ucm.remove_script(&old);
            }
            let Some(l) = crate::sound::lacks() else { return };
            let script = UserScript::new(
                &crate::sound::page_script(&l),
                UserContentInjectedFrames::AllFrames,
                UserScriptInjectionTime::Start,
                &[],
                &[],
            );
            ucm.add_script(&script);
            *kept.borrow_mut() = Some(script);
        });
    }

    /// Its page's process ended (a crash, out of memory): it's said in the
    /// log with why (what it wrote last), and the page comes back
    /// (crate::web_died: unless it keeps crashing).
    fn process_ends(win: &tauri::WebviewWindow) {
        use tauri::Manager;
        let handle = win.app_handle().clone();
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::{WebProcessTerminationReason, WebViewExt};
            wv.inner().connect_web_process_terminated(move |view, reason| {
                let why = match reason {
                    WebProcessTerminationReason::Crashed => crashed(view),
                    WebProcessTerminationReason::ExceededMemoryLimit => "its page's process ran out of memory".to_string(),
                    WebProcessTerminationReason::TerminatedByApi => return,
                    _ => "its page's process ended".to_string(),
                };
                // Not inside WebKit's signal: what it does asks the window
                // things (its address), which answers once the signal is over.
                let h = handle.clone();
                std::thread::spawn(move || crate::web_died(&h, &why));
            });
        });
    }

    /// Why its page's process crashed, by what it wrote last: GStreamer's
    /// words (a sound or a video: no media from now on, the app plays its
    /// sounds), or no sign why (twice in ten minutes: the safe way).
    fn crashed(view: &webkit2gtk::WebView) -> String {
        use webkit2gtk::{SettingsExt, WebViewExt};
        // (Its core dumped first, which can take a while: a minute's worth.)
        let said = crate::journal::said_lately(Duration::from_secs(60));
        let gst: Vec<&String> = said.iter().filter(|l| crate::sound::gstreamer_said(l)).collect();
        if !gst.is_empty() {
            log::warn!("its page's process crashed playing a sound or a video; GStreamer said last: {}", super::last_words(&gst, 3));
            if crate::sound::crashed() {
                media_script(view);
                log::warn!("its page loads no media from now on, and the app plays its sounds itself (sound.rs); the GPU isn't why");
            }
            return "its page's process crashed playing a sound".into();
        }
        let all: Vec<&String> = said.iter().collect();
        log::warn!(
            "its page's process crashed, with no sign why{}",
            if all.is_empty() { " (it said nothing in the last minute)".to_string() } else { format!("; it said last: {}", super::last_words(&all, 3)) }
        );
        if super::unexplained_again() && super::safe_rendering().is_none() {
            let why = "its page's process crashed twice in ten minutes with no sign why";
            super::keep_safe_rendering(why);
            if let Some(s) = WebViewExt::settings(view) {
                s.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Never);
            }
            log::warn!("{why}: drawing the safe way from now on (no GPU compositing), in case it's the GPU; AMARCHY_DESKTOP_GPU=1 tries it again");
        }
        "its page's process crashed".into()
    }

    /// A page that can't load (the server away, no network): the window's
    /// own page says so, with Retry, instead of WebKit's error.
    fn load_failures(win: &tauri::WebviewWindow) {
        use tauri::Manager;
        let handle = win.app_handle().clone();
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::WebViewExt;
            wv.inner().connect_load_failed(move |_, _, uri, err| {
                // Stopped on purpose (a new address, a download): not a failure.
                if err.matches(webkit2gtk::NetworkError::Cancelled) || err.matches(webkit2gtk::PolicyError::FrameLoadInterruptedByPolicyChange) {
                    return false;
                }
                crate::load_failed(&handle, uri, &err.to_string());
                true
            });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_gpu() {
        assert!(software_renderer("llvmpipe (LLVM 20.1.8, 256 bits)"));
        assert!(software_renderer("zink Vulkan 1.3(llvmpipe (LLVM 19.1.7, 256 bits) (MESA_LLVMPIPE))"));
        assert!(software_renderer("softpipe") && software_renderer("SwiftShader Device (Subzero)"));
        assert!(!software_renderer("Apple M2 Pro (G14S B1)") && !software_renderer("AMD Radeon 780M (radeonsi, gfx1103, LLVM 19.1.7)"));
        assert!(no_gpu_why(Some("llvmpipe (LLVM 20.1.8, 256 bits)"), true).is_some_and(|w| w.contains("llvmpipe")));
        assert_eq!(no_gpu_why(Some("Mesa Intel(R) Graphics (ADL GT2)"), true), None);
        // EGL didn't say: no render node at all is no GPU; one is, as far as anyone can tell.
        assert!(no_gpu_why(None, false).is_some());
        assert_eq!(no_gpu_why(None, true), None);
    }
}
