// A chat's link, amarchy://chat/<machine>/<id> (the contract's "A chat's
// link"): what the bar widget, the Hyprland key, the Omarchy menu and a
// notification open the app on.

/// A chat to open.
#[derive(Clone, Debug, PartialEq)]
pub struct Link {
    pub machine: String,
    pub id: String,
}

fn ok_part(s: &str, most: usize) -> bool {
    !s.is_empty() && s.len() <= most && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

impl Link {
    /// amarchy://chat/<machine>/<id>, or None for anything else.
    pub fn parse(raw: &str) -> Option<Link> {
        let rest = raw.trim().strip_prefix("amarchy://")?;
        let rest = rest.split(['?', '#']).next().unwrap_or("").trim_end_matches('/');
        let mut parts = rest.split('/');
        if parts.next()? != "chat" {
            return None;
        }
        let machine = parts.next()?.to_string();
        let id = parts.next()?.to_string();
        if parts.next().is_some() || !ok_part(&machine, 63) || !ok_part(&id, 120) {
            return None;
        }
        Some(Link { machine, id })
    }

    /// The app's route to it, from a server that is `here`: its own chat by
    /// id, another machine's by <machine>:<id>.
    pub fn hash(&self, here: &str) -> String {
        if self.machine == here || here.is_empty() {
            format!("#/s/{}", self.id)
        } else {
            format!("#/s/{}:{}", self.machine, self.id)
        }
    }

    /// The first link among a command line's arguments.
    pub fn from_args<S: AsRef<str>>(args: &[S]) -> Option<Link> {
        args.iter().find_map(|a| Link::parse(a.as_ref()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chat_links() {
        assert_eq!(
            Link::parse("amarchy://chat/amarchy/web-fix"),
            Some(Link { machine: "amarchy".into(), id: "web-fix".into() })
        );
        assert_eq!(Link::parse("amarchy://chat/omarchy/a.b_c-1/").map(|l| l.id), Some("a.b_c-1".into()));
        assert_eq!(Link::parse("amarchy://chat/omarchy/x?from=bar").map(|l| l.id), Some("x".into()));
        for bad in [
            "amarchy://chat/omarchy",
            "amarchy://chat//x",
            "amarchy://other/a/b",
            "https://chat/a/b",
            "amarchy://chat/a/b/c",
            "amarchy://chat/a/%2e%2e",
            "amarchy://chat/a/b c",
            "amarchy://chat/a/'><script>",
        ] {
            assert_eq!(Link::parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn routes() {
        let l = Link::parse("amarchy://chat/omarchy/dots").unwrap();
        assert_eq!(l.hash("omarchy"), "#/s/dots");
        assert_eq!(l.hash("amarchy"), "#/s/omarchy:dots");
        assert_eq!(Link::from_args(&["amarchy-desktop", "--hidden", "amarchy://chat/m/i"]).unwrap().id, "i");
    }
}
