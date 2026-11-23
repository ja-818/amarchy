// The desktop app's log: ~/.local/state/amarchy/desktop/desktop.log (the
// last 2 MB, then desktop.log.1), readable without a terminal open. What it
// says itself, and everything written to its stderr (GTK's and WebKit's
// warnings, a panic), still sent on to where stderr went (a terminal, the
// journal). The last lines on stderr are kept at hand too: what its page's
// process said before it crashed says why (platform.rs).

use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const KEEP: u64 = 2_000_000;
const LATELY: usize = 200;

/// The last lines on stderr, and when each came.
static SAID: Mutex<VecDeque<(Instant, String)>> = Mutex::new(VecDeque::new());

/// What was written to stderr in the last `within` (GTK, WebKit, GStreamer), oldest first.
pub fn said_lately(within: Duration) -> Vec<String> {
    let said = SAID.lock().unwrap_or_else(|e| e.into_inner());
    said.iter().filter(|(at, _)| at.elapsed() <= within).map(|(_, l)| l.clone()).collect()
}

fn heard(line: &str) {
    let mut said = SAID.lock().unwrap_or_else(|e| e.into_inner());
    if said.len() == LATELY {
        said.pop_front();
    }
    said.push_back((Instant::now(), line.to_string()));
}

pub fn file() -> PathBuf {
    crate::target::state_dir().join("desktop/desktop.log")
}

struct Journal {
    out: Mutex<Option<File>>,
}

static JOURNAL: Journal = Journal { out: Mutex::new(None) };

fn open() -> Option<File> {
    let f = file();
    std::fs::create_dir_all(f.parent()?).ok()?;
    if std::fs::metadata(&f).map(|m| m.len() > KEEP).unwrap_or(false) {
        let _ = std::fs::rename(&f, f.with_extension("log.1"));
    }
    OpenOptions::new().create(true).append(true).open(&f).ok()
}

/// A line in the log, with when (UTC).
fn write(line: &str) {
    let mut out = JOURNAL.out.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(f) = out.as_mut() {
        let _ = writeln!(f, "{} {line}", now());
        if f.metadata().map(|m| m.len() > KEEP).unwrap_or(false) {
            *out = open();
        }
    }
}

/// 2026-11-23T00:12:01Z, without a date library.
fn now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (days, rest) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil from days (Howard Hinnant's).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

struct Logger;

impl log::Log for Logger {
    fn enabled(&self, m: &log::Metadata) -> bool {
        m.level() <= log::Level::Info || (m.level() <= log::Level::Debug && m.target().starts_with("amarchy_desktop"))
    }

    fn log(&self, r: &log::Record) {
        if !self.enabled(r.metadata()) {
            return;
        }
        // Ours, and Tauri's and its plugins' warnings; not every crate's chatter.
        if !r.target().starts_with("amarchy_desktop") && r.level() > log::Level::Warn {
            return;
        }
        let line = format!("{} {}: {}", r.level(), r.target(), r.args());
        write(&line);
        // Where stderr went (a terminal), only what's wrong.
        if r.level() <= log::Level::Warn {
            if let Some(e) = STDERR.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                let _ = writeln!(e, "amarchy-desktop: {line}");
            }
        }
    }

    fn flush(&self) {}
}

/// Where stderr went before it was taken in (a terminal, the journal).
static STDERR: Mutex<Option<File>> = Mutex::new(None);

/// For a process it starts in its place (--restart, the watchdog's): the
/// stderr this one was given, so its words go where these went, never into
/// this one's pipe, which ends with it.
pub fn stderr_for_child() -> Option<std::process::Stdio> {
    let e = STDERR.lock().unwrap_or_else(|e| e.into_inner());
    e.as_ref().and_then(|f| f.try_clone().ok()).map(std::process::Stdio::from)
}

/// The log, from now on; its first line says which build, and where it runs.
pub fn start() {
    *JOURNAL.out.lock().unwrap() = open();
    #[cfg(unix)]
    take_stderr();
    let _ = log::set_logger(&Logger);
    log::set_max_level(log::LevelFilter::Debug);
    std::panic::set_hook(Box::new(|info| {
        let place = info.location().map(|l| format!(" at {}:{}", l.file(), l.line())).unwrap_or_default();
        let what = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_default();
        write(&format!("ERROR panic{place}: {what}"));
    }));
    log::info!(
        "amarchy-desktop {} started (pid {}, {} {}): {:?}",
        env!("CARGO_PKG_VERSION"),
        std::process::id(),
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::env::args().skip(1).collect::<Vec<_>>()
    );
}

/// Everything written to stderr (GTK, WebKit, GStreamer) into the log too,
/// line by line, and on to where it went before.
#[cfg(unix)]
fn take_stderr() {
    use std::io::{BufRead, BufReader};
    use std::os::fd::FromRawFd;
    let mut fds = [0; 2];
    // SAFETY: plain POSIX calls on file descriptors this process owns.
    unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return;
        }
        // The pipe's ends and where stderr went stay this process's own
        // (close-on-exec): what it starts gets fd 2 alone. A new build it
        // starts (--restart) holding the read end would write into a pipe
        // nobody reads once this one ends, and hang when it's full.
        let saved = libc::dup(2);
        for fd in [fds[0], fds[1], saved] {
            libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC);
        }
        if saved < 0 || libc::dup2(fds[1], 2) < 0 {
            return;
        }
        libc::close(fds[1]);
        *STDERR.lock().unwrap() = Some(File::from_raw_fd(saved));
        let read = File::from_raw_fd(fds[0]);
        std::thread::spawn(move || {
            for line in BufReader::new(read).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                write(&format!("stderr {line}"));
                heard(&line);
                if let Some(e) = STDERR.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                    let _ = writeln!(e, "{line}");
                }
            }
        });
        let _ = std::io::stderr().flush();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn said_lately() {
        super::heard("GStreamer element autoaudiosink not found. Please install it");
        let said = super::said_lately(std::time::Duration::from_secs(5));
        assert_eq!(said.last().map(String::as_str), Some("GStreamer element autoaudiosink not found. Please install it"));
        for i in 0..super::LATELY + 5 {
            super::heard(&format!("line {i}"));
        }
        assert_eq!(super::said_lately(std::time::Duration::from_secs(5)).len(), super::LATELY);
    }

    #[test]
    fn when() {
        let t = super::now();
        assert_eq!(t.len(), 20);
        assert!(t.starts_with("20") && t.ends_with('Z') && &t[10..11] == "T");
    }
}
