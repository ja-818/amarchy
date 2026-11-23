// What each system needs before the window, and of its web view.

/// Before anything starts (no threads yet: the environment is set here).
pub fn prepare() {
    #[cfg(target_os = "linux")]
    linux::prepare();
}

// ---- safe rendering, after its page's process crashed
//
// A web process that crashes is most often the graphics path (a new or
// experimental GPU driver: Apple Silicon's, NVIDIA's). After one crash the
// desktop app draws without the GPU's DMA-BUF and compositing, from then on
// (rendering.json); AMARCHY_DESKTOP_GPU=1 tries the GPU again.

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
    let _ = std::fs::write(&f, serde_json::json!({ "safe": true, "why": why }).to_string() + "\n");
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
    use std::os::unix::net::UnixStream;
    use std::path::Path;

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
        log::info!("graphics: {}", graphics());
        // Its page crashed before: drawn the safe way (no DMA-BUF, no compositing).
        if let Some(why) = super::safe_rendering() {
            log::info!("drawing the safe way (no GPU compositing) since {why}; AMARCHY_DESKTOP_GPU=1 tries the GPU again");
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
        let _ = win.with_webview(|wv| {
            use webkit2gtk::{SettingsExt, WebViewExt};
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
        });
        load_failures(win);
        process_ends(win);
    }

    /// Its page's process ended (a crash, out of memory): it's said in the
    /// log, a crash makes it draw the safe way from now on, and the page
    /// comes back (crate::web_died: unless it keeps crashing).
    fn process_ends(win: &tauri::WebviewWindow) {
        use tauri::Manager;
        let handle = win.app_handle().clone();
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::{SettingsExt, WebProcessTerminationReason, WebViewExt};
            wv.inner().connect_web_process_terminated(move |view, reason| {
                let why = match reason {
                    WebProcessTerminationReason::Crashed => "its page's process crashed",
                    WebProcessTerminationReason::ExceededMemoryLimit => "its page's process ran out of memory",
                    WebProcessTerminationReason::TerminatedByApi => return,
                    _ => "its page's process ended",
                };
                if reason == WebProcessTerminationReason::Crashed && super::safe_rendering().is_none() {
                    super::keep_safe_rendering(why);
                    if let Some(s) = WebViewExt::settings(view) {
                        s.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Never);
                    }
                    log::warn!("{why}: drawing the safe way from now on (no GPU compositing)");
                }
                // Not inside WebKit's signal: what it does asks the window
                // things (its address), which answers once the signal is over.
                let (h, why) = (handle.clone(), why.to_string());
                std::thread::spawn(move || crate::web_died(&h, &why));
            });
        });
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
