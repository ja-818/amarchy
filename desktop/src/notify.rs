// The desktop app's notifications (the contract's "Its notifications"): it
// follows GET /api/notices of the amarchy it opens, window closed or not,
// and shows each notice natively, with its buttons (Allow, Deny, a
// question's answers, a done reply's choices such as Ship it), doing what a
// button says as the app's page would; a click opens the window on that
// chat (at its card when it asks); the chat's chime rings.

use std::collections::HashMap;
use std::io::BufRead;
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager, Url};

use crate::target::Target;
use crate::Shell;

/// One notice, as GET /api/notices sends it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Notice {
    pub id: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub ask: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub urgent: bool,
    #[serde(default)]
    pub sound: Option<String>,
    #[serde(default)]
    pub waiting: Option<u64>,
    #[serde(default)]
    pub actions: Vec<Action>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Action {
    pub label: String,
    pub path: String,
    pub body: serde_json::Value,
}

/// What notify keeps between notices: the last one seen (to pick up where
/// it was after a reconnect), and each tag's notification (a new one
/// replaces it, as a phone's does).
#[derive(Default)]
pub struct Notifier {
    last: Mutex<u64>,
    shown: Mutex<HashMap<String, u32>>,
    /// The local cookie, for this machine's amarchy ("name=value").
    pub cookie: Mutex<Option<String>>,
}

/// Follows the notices of whatever the window opens, for as long as the
/// app runs: a new target, a server gone and back, it follows along.
pub fn follow(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut wait = 1;
        loop {
            let target = app.state::<Shell>().target.lock().unwrap().clone();
            let Some(t) = target else {
                std::thread::sleep(Duration::from_secs(1));
                continue;
            };
            match stream(&app, &t) {
                Ok(()) => wait = 1,
                Err(e) => {
                    log::debug!("notices: {e}");
                    wait = (wait * 2).min(30);
                }
            }
            std::thread::sleep(Duration::from_secs(wait));
        }
    });
}

fn agent(read: Option<Duration>) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(10)))
        // A stream comes again every few minutes (picking up where it was):
        // a connection gone dead without a word ends that way too.
        .timeout_recv_body(read)
        .http_status_as_error(false)
        .build()
        .into()
}

/// Auth for a call to target t: this machine's needs its cookie.
fn authed<B>(req: ureq::RequestBuilder<B>, app: &AppHandle, t: &Target) -> ureq::RequestBuilder<B> {
    match t {
        Target::Local { .. } => match app.state::<Notifier>().cookie.lock().unwrap().clone() {
            Some(c) => req.header("Cookie", c),
            None => req,
        },
        Target::Remote { .. } => req,
    }
}

/// One connection to GET /api/notices, until it ends or the target changes.
fn stream(app: &AppHandle, t: &Target) -> Result<(), String> {
    let origin = t.origin();
    let last = *app.state::<Notifier>().last.lock().unwrap();
    let mut url = origin.join("api/notices").map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("plain", "1");
    if last > 0 {
        url.query_pairs_mut().append_pair("after", &last.to_string());
    }
    let req = authed(agent(Some(Duration::from_secs(300))).get(url.as_str()), app, t)
        .header("Accept", "text/event-stream");
    let res = req.call().map_err(|e| e.to_string())?;
    if res.status() != 200 {
        return Err(format!("{} answered {}", origin, res.status()));
    }
    let reader = std::io::BufReader::new(res.into_body().into_reader());
    let (mut event, mut data) = (String::new(), String::new());
    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if app.state::<Shell>().target.lock().unwrap().as_ref() != Some(t) {
            return Ok(()); // the window opens another one now
        }
        if line.is_empty() {
            if event == "notice" {
                if let Ok(n) = serde_json::from_str::<Notice>(&data) {
                    let notifier = app.state::<Notifier>();
                    let mut last = notifier.last.lock().unwrap();
                    if n.id > *last {
                        *last = n.id;
                        drop(last);
                        show(app, t, n);
                    }
                }
            }
            event.clear();
            data.clear();
        } else if let Some(v) = line.strip_prefix("event:") {
            event = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(v.strip_prefix(' ').unwrap_or(v));
        }
    }
    Ok(())
}

/// A notice on the screen, its chime rung, the tray's count.
fn show(app: &AppHandle, t: &Target, n: Notice) {
    if let Some(sound) = n.sound.as_deref().filter(|s| !s.is_empty()) {
        ring(app, sound);
    }
    if let Some(waiting) = n.waiting {
        crate::tray::waiting(app, waiting);
    }
    let icon = n.icon.as_deref().and_then(|p| picture(app, t, p));
    // Shown here, in order (a chat's next one takes its last one's place),
    // then waited on (a button, a click, or closed) off the stream's thread.
    native(app, t, n, icon);
}

#[cfg(all(unix, not(target_os = "macos")))]
fn native(app: &AppHandle, t: &Target, n: Notice, icon: Option<std::path::PathBuf>) {
    use notify_rust::{Hint, Notification, Urgency};
    let notifier = app.state::<Notifier>();
    let mut note = Notification::new();
    note.appname("Amarchy")
        .summary(&n.title)
        .body(&n.body)
        .hint(Hint::DesktopEntry("amarchy".into()))
        .urgency(if n.urgent { Urgency::Critical } else { Urgency::Normal })
        .action("default", "Open");
    match &icon {
        Some(p) => {
            note.image_path(&p.to_string_lossy());
        }
        None => {
            note.icon("amarchy");
        }
    }
    for (i, a) in n.actions.iter().take(3).enumerate() {
        note.action(&format!("a{i}"), &a.label);
    }
    if let Some(tag) = &n.tag {
        if let Some(id) = notifier.shown.lock().unwrap().get(tag) {
            note.id(*id);
        }
    }
    let handle = match note.show() {
        Ok(h) => h,
        Err(e) => {
            log::warn!("couldn't show a notification: {e}");
            return;
        }
    };
    if let Some(tag) = &n.tag {
        notifier.shown.lock().unwrap().insert(tag.clone(), handle.id());
    }
    let (app, t) = (app.clone(), t.clone());
    std::thread::spawn(move || handle.wait_for_action(move |action| {
        if let Some(tag) = &n.tag {
            app.state::<Notifier>().shown.lock().unwrap().remove(tag);
        }
        match action {
            "default" => open(&app, &n),
            "__closed" => {}
            a => {
                if let Some(act) = a.strip_prefix('a').and_then(|i| i.parse::<usize>().ok()).and_then(|i| n.actions.get(i)) {
                    if let Err(why) = act_on(&app, &t, act) {
                        failed(&app, &n, act, &why);
                    }
                }
            }
        }
    }));
}

// macOS and Windows: the notice, without its buttons yet (a click opens
// the app where the system lets it).
#[cfg(not(all(unix, not(target_os = "macos"))))]
fn native(_app: &AppHandle, _t: &Target, n: Notice, _icon: Option<std::path::PathBuf>) {
    let _ = notify_rust::Notification::new().appname("Amarchy").summary(&n.title).body(&n.body).show();
}

/// A button: its POST, as the app's own page would make it.
pub fn act_on(app: &AppHandle, t: &Target, a: &Action) -> Result<(), String> {
    if !a.path.starts_with("/api/") || a.path.contains("..") {
        return Err("not one of amarchy's".into());
    }
    let origin = t.origin();
    let url = origin.join(a.path.trim_start_matches('/')).map_err(|e| e.to_string())?;
    let own = origin.origin().ascii_serialization();
    let res = authed(agent(Some(Duration::from_secs(30))).post(url.as_str()), app, t)
        .header("Origin", &own)
        .header("Content-Type", "application/json")
        .send(serde_json::to_vec(&a.body).unwrap_or_default())
        .map_err(|e| e.to_string())?;
    if res.status().is_success() {
        return Ok(());
    }
    let status = res.status();
    let said = res
        .into_body()
        .read_to_string()
        .ok()
        .and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok())
        .and_then(|v| v["error"].as_str().map(str::to_string));
    Err(said.unwrap_or_else(|| format!("amarchy answered {status}")))
}

/// A button that didn't go: said, with Open.
fn failed(app: &AppHandle, n: &Notice, a: &Action, why: &str) {
    let note = Notice {
        id: n.id,
        title: format!("{} didn't go", a.label),
        body: format!("{}: {why}", n.title),
        tag: n.tag.clone(),
        url: n.url.clone(),
        ask: n.ask.clone(),
        ..Default::default()
    };
    let t = app.state::<Shell>().target.lock().unwrap().clone();
    if let Some(t) = t {
        native(app, &t, note, None);
    }
}

/// A click: the window, on that chat (at its card when it asks).
fn open(app: &AppHandle, n: &Notice) {
    let hash = n
        .url
        .as_deref()
        .and_then(|u| u.split_once('#').map(|(_, h)| format!("#{h}")))
        .filter(|h| h.starts_with("#/"));
    crate::open_route(app, hash.as_deref(), n.ask.as_deref());
}

/// The chat's chime, rung by the app's page (its playSound), window closed or not.
fn ring(app: &AppHandle, sound: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let src = serde_json::to_string(&format!("/sound/{}", urlencode(sound))).unwrap();
        let _ = w.eval(format!("if (typeof playSound === 'function') playSound({src});"));
    }
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20")
}

/// A notice's picture (an agent's), fetched once and kept.
fn picture(app: &AppHandle, t: &Target, path: &str) -> Option<std::path::PathBuf> {
    if !path.starts_with('/') || path.contains("..") {
        return None;
    }
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (t.origin().as_str(), path).hash(&mut h);
    let dir = app.path().app_cache_dir().ok()?.join("pictures");
    let file = dir.join(format!("{:016x}.png", h.finish()));
    if file.is_file() {
        return Some(file);
    }
    let url: Url = t.origin().join(path.trim_start_matches('/')).ok()?;
    let res = authed(agent(Some(Duration::from_secs(20))).get(url.as_str()), app, t).call().ok()?;
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.into_body().with_config().limit(4_000_000).read_to_vec().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(&file, bytes).ok()?;
    Some(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_read() {
        let n: Notice = serde_json::from_str(
            r#"{"id": 7, "title": "Fix the build", "body": "Allow it?", "tag": "proj-a", "url": "/#/s/proj-a",
                "ask": "proj-a", "sound": "kalimba", "waiting": 2, "extra": 1,
                "actions": [{"label": "Allow", "path": "/api/session/proj-a/answer", "body": {"request_id": "r", "choice": "allow"}}]}"#,
        )
        .unwrap();
        assert_eq!((n.id, n.actions.len(), n.actions[0].label.as_str()), (7, 1, "Allow"));
        let bare: Notice = serde_json::from_str(r#"{"id": 1, "title": "Amarchy"}"#).unwrap();
        assert!(bare.actions.is_empty() && bare.url.is_none());
        assert_eq!(urlencode("my chime.mp3"), "my%20chime.mp3");
    }
}
