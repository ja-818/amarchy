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

/// The window's way to the tailnet: through amarchy's own node's proxy
/// (Some), or straight (None). Never for this computer's own addresses.
pub fn proxy(win: &tauri::WebviewWindow, url: Option<&str>) {
    #[cfg(target_os = "linux")]
    linux::proxy(win, url);
    #[cfg(not(target_os = "linux"))]
    let _ = (win, url);
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
        log::info!("graphics: {}", graphics());
        if let Some(why) = super::safe_rendering() {
            log::info!("drawing the safe way (no GPU compositing) since {why}; AMARCHY_DESKTOP_GPU=1 tries the GPU again");
        }
        // What its page can play here (GStreamer's plugins), before the window.
        crate::sound::check();
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
        for var in ["WAYLAND_DISPLAY", "XDG_CURRENT_DESKTOP", "WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE"] {
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
        });
        load_failures(win);
        process_ends(win);
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
