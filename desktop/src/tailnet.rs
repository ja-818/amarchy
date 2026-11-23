// amarchy's own Tailscale node, from the desktop app's side (the contract's
// "Tailscale inside the apps"): on a computer without the system's
// Tailscale, its window, notices and buttons reach a server on the tailnet
// through the node's proxy, and its own page signs the node in.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::Deserialize;

pub fn dir() -> PathBuf {
    crate::target::state_dir().join("tailnet")
}

/// amarchy-tailnet, where install.sh puts it (or on the PATH).
pub fn bin() -> Option<PathBuf> {
    let p = crate::target::home().join(".local/bin/amarchy-tailnet");
    if p.is_file() {
        return Some(p);
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).map(|d| d.join("amarchy-tailnet")).find(|p| p.is_file())
    })
}

/// TAILSCALE=own in amarchy's host settings: its own node even beside the system's.
fn own_by_setting() -> bool {
    if let Ok(v) = std::env::var("AMARCHY_HOST_TAILSCALE") {
        return v.eq_ignore_ascii_case("own");
    }
    std::fs::read_to_string(crate::target::config_dir().join("host"))
        .map(|t| {
            t.lines().any(|l| {
                l.split_once('=').map(|(k, v)| k.trim() == "TAILSCALE" && v.trim().eq_ignore_ascii_case("own")).unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Whether the system's Tailscale answers (its daemon, signed in or not).
pub fn system_answers() -> bool {
    if own_by_setting() {
        return false;
    }
    let Ok(out) = run_timeout(Command::new("tailscale").args(["status", "--json"]), Duration::from_secs(5)) else {
        return false;
    };
    serde_json::from_slice::<serde_json::Value>(&out)
        .ok()
        .and_then(|v| v["BackendState"].as_str().map(|s| !s.is_empty()))
        .unwrap_or(false)
}

fn run_timeout(cmd: &mut Command, wait: Duration) -> Result<Vec<u8>, String> {
    let child = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(wait) {
        Ok(Ok(out)) => Ok(out.stdout),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("it didn't answer".into()),
    }
}

/// What `amarchy-tailnet status --json` says.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct NodeStatus {
    #[serde(default)]
    pub running: bool,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub words: String,
    #[serde(default)]
    pub auth_url: Option<String>,
}

impl NodeStatus {
    pub fn needs_sign_in(&self) -> bool {
        self.running && (self.state == "NeedsLogin" || self.auth_url.is_some())
    }
    pub fn on(&self) -> bool {
        self.running && self.state == "Running"
    }
}

/// amarchy's own node, when it's this computer's Tailscale: where it stands.
/// None when the computer has the system's, or no node of amarchy's.
pub fn node() -> Option<NodeStatus> {
    let bin = bin()?;
    if !dir().join("tailscaled.sock").exists() || system_answers() {
        return None;
    }
    let out = run_timeout(Command::new(bin).args(["status", "--json"]), Duration::from_secs(10)).ok()?;
    serde_json::from_slice(&out).ok()
}

/// The node's proxy ("http://amarchy:<secret>@127.0.0.1:<port>"), when this
/// computer reaches the tailnet through it.
pub fn proxy() -> Option<String> {
    let text = std::fs::read_to_string(dir().join("proxy.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let url = v["url"].as_str()?.to_string();
    if !dir().join("tailscaled.sock").exists() || system_answers() {
        return None;
    }
    Some(url)
}

/// Whether a host is the tailnet's (a name under .ts.net, or its addresses).
pub fn on_tailnet(host: &str) -> bool {
    let h = host.trim_matches(['[', ']']).trim_end_matches('.').to_ascii_lowercase();
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                let o = v4.octets();
                o[0] == 100 && (64..128).contains(&o[1])
            }
            std::net::IpAddr::V6(v6) => {
                let s = v6.segments();
                s[0] == 0xfd7a && s[1] == 0x115c && s[2] == 0xa1e0
            }
        };
    }
    h.ends_with(".ts.net")
}

/// The proxy for reaching url, if it's on the tailnet and this computer
/// reaches the tailnet through amarchy's own node.
pub fn proxy_for(url: &url::Url) -> Option<String> {
    url.host_str().filter(|h| on_tailnet(h)).and_then(|_| proxy())
}

/// Tailscale's sign-in page for the node (to open in a browser); None when
/// it's signed in already.
pub fn login_url() -> Result<Option<String>, String> {
    let bin = bin().ok_or("amarchy's own Tailscale node isn't installed")?;
    let out = run_timeout(Command::new(bin).args(["login", "--no-open"]), Duration::from_secs(70))?;
    let text = String::from_utf8_lossy(&out);
    let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    if line.starts_with("https://") || line.starts_with("http://") {
        Ok(Some(line.to_string()))
    } else if line.starts_with("Signed in") {
        Ok(None)
    } else {
        Err(format!("amarchy-tailnet login said: {line}"))
    }
}

#[cfg(test)]
mod tests {
    use super::on_tailnet;

    #[test]
    fn tailnet_hosts() {
        for (h, want) in [
            ("amarchy.tail1234.ts.net", true),
            ("AMARCHY.tail1234.TS.NET.", true),
            ("100.71.198.126", true),
            ("[fd7a:115c:a1e0::1]", true),
            ("127.0.0.1", false),
            ("100.128.0.1", false),
            ("example.com", false),
            ("ts.net.example.com", false),
        ] {
            assert_eq!(on_tailnet(h), want, "{h}");
        }
    }
}
