// What the window opens: an amarchy app server, this machine's or another's
// (docs/plan-omarchy-and-machines.md, "The desktop app: how it's opened,
// what it opens"), found through amarchy's own CLI so this app never reads
// amarchy's files but the two it's meant to (the local key, the host's port).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::links::Link;

/// An amarchy app server to open.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    /// This machine's, straight on 127.0.0.1 with the local key.
    Local { port: u16, machine: String },
    /// A server's address (through Tailscale), or one given by hand.
    Remote { url: Url, machine: String },
}

impl Target {
    /// Where its pages come from: what the window may go to.
    pub fn origin(&self) -> Url {
        match self {
            Target::Local { port, .. } => Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap(),
            Target::Remote { url, .. } => {
                let mut u = url.clone();
                u.set_path("/");
                u.set_query(None);
                u.set_fragment(None);
                u
            }
        }
    }

    /// The machine it is (its name), for a chat's link.
    pub fn machine(&self) -> &str {
        match self {
            Target::Local { machine, .. } | Target::Remote { machine, .. } => machine,
        }
    }

    /// What to say it is, in the window's own pages.
    pub fn label(&self) -> String {
        match self {
            Target::Local { .. } => "this computer's amarchy".into(),
            Target::Remote { url, .. } => url.host_str().unwrap_or("amarchy").to_string(),
        }
    }

    /// The address to open it at: the app, or a chat's view of it (a link).
    /// This machine's needs its cookie first (local_cookie).
    pub fn open_url(&self, link: Option<&Link>) -> Url {
        let hash = link.map(|l| l.hash(self.machine()));
        let mut u = match self {
            Target::Local { .. } => self.origin(),
            Target::Remote { url, .. } => url.clone(),
        };
        if let Some(h) = hash {
            u.set_fragment(Some(h.trim_start_matches('#')));
        }
        u
    }
}

/// This machine's amarchy lets the desktop app in with a cookie: asked for
/// here, with the local key (GET /local?key=, the contract's "Who may
/// call"), and handed to the web view, so the key is never in an address
/// the web view keeps. SameSite=Lax rather than the server's Strict: WebKit
/// counts the window's first load as coming from another site (its own
/// page, tauri://), and holds a Strict cookie back from it. Lax only adds
/// top-level loads from elsewhere, and this web view shows nothing else
/// (any other site goes to the browser); writes still need amarchy's Origin.
pub fn local_cookie(port: u16) -> Result<tauri::webview::Cookie<'static>, String> {
    use tauri::webview::cookie::{time, Cookie, SameSite};
    let key = local_key()?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .max_redirects(0)
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    let res = agent
        .get(&format!("http://127.0.0.1:{port}/local"))
        .query("key", &key)
        .call()
        .map_err(|e| format!("this computer's amarchy didn't answer: {e}"))?;
    let set = res
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find(|v| v.starts_with("amarchy_local_"))
        .map(str::to_string);
    let Some(set) = set else {
        return Err(match res.status().as_u16() {
            403 => "this computer's amarchy didn't take its local key (is it this user's?)".into(),
            code => format!("this computer's amarchy answered {code} to its local key"),
        });
    };
    let parsed = Cookie::parse(set).map_err(|e| format!("its cookie: {e}"))?;
    let mut c = Cookie::build((parsed.name().to_string(), parsed.value().to_string()))
        .domain("127.0.0.1")
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax);
    if let Some(age) = parsed.max_age() {
        c = c.max_age(time::Duration::seconds(age.whole_seconds()));
    }
    Ok(c.build())
}

/// What looking for one came to.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Found {
    /// Open it; `said`: what to say once (paired with a machine just found).
    Open {
        #[serde(skip)]
        target: Target,
        said: Option<String>,
    },
    /// Several of yours answer: which one (asked once).
    Choose { machines: Vec<Candidate> },
    /// None: why, in words.
    Nothing { why: String },
    /// This computer reaches the tailnet through amarchy's own Tailscale
    /// node, which waits for a sign-in.
    #[serde(rename = "signin")]
    SignIn { words: String },
}

/// A machine of yours on the tailnet that answers as amarchy, not paired yet
/// (`amarchy machines found --json`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Candidate {
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub update: Option<String>,
}

/// A row of `amarchy machines --json`: this machine first (`me`), then the
/// paired ones.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Machine {
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub me: bool,
    #[serde(default)]
    pub state: Option<String>,
    /// On the `me` row: its app shows other machines' chats (their routes,
    /// <machine>:<id>), so a board with paired machines is worth opening.
    #[serde(default)]
    pub merges: bool,
}

/// The desktop app's own settings (~/.config/amarchy/desktop.json): the
/// address set by hand (`--server`).
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Settings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

fn xdg(var: &str, fallback: &str) -> PathBuf {
    match std::env::var_os(var) {
        Some(v) if Path::new(&v).is_absolute() => PathBuf::from(v),
        _ => home().join(fallback),
    }
}

pub fn config_dir() -> PathBuf {
    xdg("XDG_CONFIG_HOME", ".config").join("amarchy")
}

pub fn state_dir() -> PathBuf {
    xdg("XDG_STATE_HOME", ".local/state").join("amarchy")
}

pub fn settings_file() -> PathBuf {
    config_dir().join("desktop.json")
}

pub fn read_settings() -> Settings {
    std::fs::read_to_string(settings_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_settings(s: &Settings) -> std::io::Result<()> {
    let f = settings_file();
    std::fs::create_dir_all(f.parent().unwrap())?;
    let tmp = f.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(s).unwrap() + "\n")?;
    std::fs::rename(tmp, f)
}

/// An address typed or given: https:// when it says none; a bare name is
/// left to the caller (it may be a machine to pair).
pub fn parse_address(raw: &str) -> Result<Url, String> {
    let raw = raw.trim();
    let with = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    let u = Url::parse(&with).map_err(|_| format!("{raw} isn't an address"))?;
    if !matches!(u.scheme(), "http" | "https") || u.host_str().is_none() {
        return Err(format!("{raw} isn't an address"));
    }
    Ok(u)
}

/// A server's address as a target: its machine is its name on the tailnet
/// (the address's first label), unless told; unknown for a bare IP address
/// (then a chat's link opens by id there).
pub fn remote(url: Url, machine: Option<String>) -> Target {
    let machine = machine.unwrap_or_else(|| match url.host() {
        Some(url::Host::Domain(d)) => d.split('.').next().unwrap_or("").to_string(),
        _ => String::new(),
    });
    Target::Remote { url, machine }
}

/// This machine's app server port: AMARCHY_HOST_APP_PORT, else APP_PORT= in
/// ~/.config/amarchy/host, else 7397 (as bin/amarchy's host_setting).
pub fn app_port() -> u16 {
    let setting = std::env::var("AMARCHY_HOST_APP_PORT").ok().or_else(|| {
        std::fs::read_to_string(config_dir().join("host")).ok().and_then(|text| {
            text.lines().find_map(|line| {
                let (k, v) = line.split_once('=')?;
                (k.trim() == "APP_PORT").then(|| v.trim().to_string())
            })
        })
    });
    setting.and_then(|v| v.parse().ok()).filter(|p| *p > 0).unwrap_or(7397)
}

/// The local key (STATE/app/local.key), never logged or put on a command line.
pub fn local_key() -> Result<String, String> {
    let f = state_dir().join("app/local.key");
    let key = std::fs::read_to_string(&f).map_err(|_| "this computer's amarchy has no local key yet".to_string())?;
    let key = key.trim().to_string();
    if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("this computer's amarchy local key isn't readable".into());
    }
    Ok(key)
}

/// Whether this machine's app server answers.
pub fn local_answers(port: u16) -> bool {
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// amarchy's CLI: on the PATH, else where install.sh links it.
pub fn amarchy_cli() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("AMARCHY_CLI") {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join("amarchy");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    let p = home().join(".local/bin/amarchy");
    p.is_file().then_some(p)
}

/// amarchy's CLI, run: its output when it succeeded, else what it said.
pub fn amarchy(cli: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cli)
        .args(args)
        .env_remove("AMARCHY_SESSION")
        .output()
        .map_err(|e| format!("couldn't run amarchy: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let said = if said.is_empty() { String::from_utf8_lossy(&out.stdout).trim().to_string() } else { said };
        Err(if said.is_empty() { format!("amarchy {} failed", args.join(" ")) } else { said })
    }
}

fn json<T: for<'de> Deserialize<'de>>(cli: &Path, args: &[&str]) -> Option<T> {
    amarchy(cli, args).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// What the machine's amarchy says about itself and its peers.
pub struct Here {
    pub chats: usize,
    pub machines: Vec<Machine>,
}

pub fn here(cli: &Path) -> Here {
    let chats = json::<Vec<serde_json::Value>>(cli, &["list", "--compact"]).map(|v| v.len()).unwrap_or(0);
    let machines = json::<Vec<Machine>>(cli, &["machines", "--json"]).unwrap_or_default();
    Here { chats, machines }
}

/// What the window opens (the contract's order): the address it was given;
/// this machine's amarchy when its board has something and its server
/// answers; the first paired machine that's on; the address set by hand;
/// one found on the tailnet (paired then). `pair`: whether a single machine
/// found may be paired now (not while only checking).
pub fn find(given: Option<Url>, pair: bool) -> Found {
    if let Some(url) = given {
        return Found::Open { target: remote(url, None), said: None };
    }
    let cli = amarchy_cli();
    let here = cli.as_deref().map(here);
    if let Some(h) = &here {
        let me = h.machines.iter().find(|m| m.me);
        let port = app_port();
        let merged = me.map(|m| m.merges).unwrap_or(false) && h.machines.iter().any(|m| !m.me);
        if (h.chats > 0 || merged) && local_answers(port) && local_key().is_ok() {
            let machine = me.map(|m| m.name.clone()).unwrap_or_else(hostname);
            return Found::Open { target: Target::Local { port, machine }, said: None };
        }
        // Further than this machine is the tailnet: through amarchy's own
        // node when it's this computer's Tailscale, signed in first.
        if let Some(node) = crate::tailnet::node() {
            if node.needs_sign_in() {
                return Found::SignIn { words: node.words };
            }
        }
        if let Some(m) = h.machines.iter().find(|m| !m.me && m.state.as_deref() == Some("on")) {
            if let Some(url) = m.url.as_deref().and_then(|u| Url::parse(u).ok()) {
                return Found::Open { target: remote(url, Some(m.name.clone())), said: None };
            }
        }
    }
    if let Some(server) = read_settings().server {
        if let Ok(url) = parse_address(&server) {
            return Found::Open { target: remote(url, None), said: None };
        }
    }
    // A paired one that's off is still yours: opened (its page says it's
    // away, or the app as it was kept) rather than looking elsewhere.
    if let Some(h) = &here {
        if let Some(m) = h.machines.iter().find(|m| !m.me && m.url.is_some()) {
            if let Ok(url) = Url::parse(m.url.as_deref().unwrap()) {
                return Found::Open { target: remote(url, Some(m.name.clone())), said: None };
            }
        }
    }
    let Some(cli) = cli else {
        return Found::Nothing {
            why: "amarchy isn't installed on this computer, so it can't look for your amarchy on your tailnet.".into(),
        };
    };
    let found: Vec<Candidate> = match amarchy(&cli, &["machines", "found", "--json"]) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(said) => return Found::Nothing { why: tailnet_why(&said) },
    };
    let usable: Vec<Candidate> = found.iter().filter(|c| c.update.is_none()).cloned().collect();
    match usable.len() {
        0 => Found::Nothing {
            why: match found.first() {
                Some(c) => format!(
                    "{} answers, but on another version of amarchy: {}",
                    c.label.as_deref().unwrap_or(&c.name),
                    c.update.as_deref().unwrap_or("update it")
                ),
                None => "No amarchy of yours answers on your tailnet.".into(),
            },
        },
        1 if pair => match pair_with(&cli, &usable[0]) {
            Ok(target) => Found::Open {
                said: Some(format!("Paired with {}.", usable[0].label.as_deref().unwrap_or(&usable[0].name))),
                target,
            },
            Err(why) => Found::Nothing { why },
        },
        _ => Found::Choose { machines: usable },
    }
}

/// Pair with a machine found (amarchy machines add), and open it.
pub fn pair_with(cli: &Path, c: &Candidate) -> Result<Target, String> {
    amarchy(cli, &["machines", "add", &c.name])?;
    let url = c
        .url
        .as_deref()
        .and_then(|u| Url::parse(u).ok())
        .or_else(|| {
            json::<Vec<Machine>>(cli, &["machines", "--json"])?
                .into_iter()
                .find(|m| m.name == c.name)
                .and_then(|m| m.url)
                .and_then(|u| Url::parse(&u).ok())
        })
        .ok_or_else(|| format!("Paired with {}, but it has no address.", c.name))?;
    Ok(remote(url, Some(c.name.clone())))
}

/// Why looking on the tailnet didn't work, in words.
fn tailnet_why(said: &str) -> String {
    let tailscale = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join("tailscale").is_file()))
        .unwrap_or(false);
    if !tailscale {
        "Tailscale isn't installed on this computer: your amarchy is on your tailnet, so this computer needs it too.".into()
    } else {
        format!("Couldn't look for your amarchy on your tailnet: {said}")
    }
}

pub fn hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname")
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOSTNAME").ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::links::Link;

    #[test]
    fn remote_targets_open_chats_by_hash() {
        let t = remote(Url::parse("https://amarchy.tail.ts.net/").unwrap(), None);
        assert_eq!(t.machine(), "amarchy");
        assert_eq!(t.origin().as_str(), "https://amarchy.tail.ts.net/");
        let own = Link::parse("amarchy://chat/amarchy/web-fix").unwrap();
        assert_eq!(t.open_url(Some(&own)).as_str(), "https://amarchy.tail.ts.net/#/s/web-fix");
        let other = Link::parse("amarchy://chat/omarchy/dots-theme").unwrap();
        assert_eq!(t.open_url(Some(&other)).as_str(), "https://amarchy.tail.ts.net/#/s/omarchy:dots-theme");
        assert_eq!(t.open_url(None).as_str(), "https://amarchy.tail.ts.net/");
        let local = Target::Local { port: 7397, machine: "omarchy".into() };
        assert_eq!(local.open_url(Some(&Link::parse("amarchy://chat/omarchy/x").unwrap())).as_str(), "http://127.0.0.1:7397/#/s/x");
    }

    #[test]
    fn addresses() {
        assert_eq!(parse_address("amarchy.tail.ts.net").unwrap().as_str(), "https://amarchy.tail.ts.net/");
        assert_eq!(parse_address(" http://127.0.0.1:7397 ").unwrap().as_str(), "http://127.0.0.1:7397/");
        assert!(parse_address("ftp://x").is_err());
        assert!(parse_address("").is_err());
        assert_eq!(remote(Url::parse("http://127.0.0.1:7397/").unwrap(), None).machine(), "");
    }
}
