// What each system needs before the window, and of its web view.

/// Before anything starts (no threads yet: the environment is set here).
pub fn prepare() {
    #[cfg(target_os = "linux")]
    linux::prepare();
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

    pub fn webview(win: &tauri::WebviewWindow) {
        let _ = win.with_webview(|wv| {
            use webkit2gtk::{SettingsExt, WebViewExt};
            let view = wv.inner();
            let Some(s) = WebViewExt::settings(&view) else { return };
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
