// The desktop app's log: ~/.local/state/amarchy/desktop/desktop.log (the
// last 2 MB, then desktop.log.1), readable without a terminal open. What it
// says itself, and everything written to its stderr (GTK's and WebKit's
// warnings, a panic), still sent on to where stderr went (a terminal, the
// journal). The last lines on stderr are kept at hand too: what its page's
// process said before it crashed says why (platform.rs).
//
// Where stderr went never holds it up: a line goes on only when it can be
// taken at once (a pipe nobody reads fills, then would block every line, the
// app with it). A start in another's place (--restart, the watchdog) gets
// the stderr that one was given (AMARCHY_DESKTOP_STDERR=given says so). One
// handed a build's own pipe instead (builds before 2026-11-22 22:48 did:
// nobody reads it once that one ends) writes to the journal itself, as it
// was before, through a stream of its own.

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
                forward(e, &format!("amarchy-desktop: {line}"));
            }
        }
    }

    fn flush(&self) {}
}

/// Where stderr went before it was taken in (a terminal, the journal).
static STDERR: Mutex<Option<File>> = Mutex::new(None);

/// A line on to where stderr went, only if it takes it at once: never
/// waiting on it (a pipe nobody reads, full). Long lines cut (they're whole in
/// the log): a pipe takes up to 4 KB at once, whole.
fn forward(e: &mut File, line: &str) {
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        let mut p = libc::pollfd { fd: e.as_raw_fd(), events: libc::POLLOUT, revents: 0 };
        // SAFETY: one pollfd on a descriptor this process owns, no wait.
        if unsafe { libc::poll(&mut p, 1, 0) } != 1 || p.revents & libc::POLLOUT == 0 {
            return;
        }
    }
    let mut cut = line.len().min(2000);
    while !line.is_char_boundary(cut) {
        cut -= 1;
    }
    let _ = e.write_all(format!("{}\n", &line[..cut]).as_bytes());
}

/// A stream of its own into the journal (systemd's stdout protocol, as a
/// service's stderr is): its identifier, no unit, warning, no level prefix,
/// nowhere else. None without systemd's journal.
#[cfg(unix)]
fn journal_stream() -> Option<File> {
    use std::os::unix::net::UnixStream;
    let mut s = UnixStream::connect("/run/systemd/journal/stdout").ok()?;
    s.write_all(b"amarchy-desktop\n\n4\n0\n0\n0\n0\n").ok()?;
    let _ = s.shutdown(std::net::Shutdown::Read);
    Some(File::from(std::os::fd::OwnedFd::from(s)))
}

/// Whether stderr (fd) is a pipe a build before this one handed over in its
/// place, its own, that nobody reads once it ends: started in another's place
/// (relaunched), not told the stderr is the one that one was given, and a pipe.
#[cfg(unix)]
fn handed_its_pipe(fd: i32, relaunched: bool) -> bool {
    if !relaunched || std::env::var("AMARCHY_DESKTOP_STDERR").is_ok_and(|v| v == "given") {
        return false;
    }
    // SAFETY: fstat on a descriptor this process owns, into a zeroed struct.
    unsafe {
        let mut st: libc::stat = std::mem::zeroed();
        libc::fstat(fd, &mut st) == 0 && (st.st_mode & libc::S_IFMT) == libc::S_IFIFO
    }
}

/// For a process it starts in its place (--restart, the watchdog's): the
/// stderr this one was given, so its words go where these went, never into
/// this one's pipe, which ends with it.
/// (The starter says so: AMARCHY_DESKTOP_STDERR=given, with it.)
pub fn stderr_for_child() -> Option<std::process::Stdio> {
    let e = STDERR.lock().unwrap_or_else(|e| e.into_inner());
    e.as_ref().and_then(|f| f.try_clone().ok()).map(std::process::Stdio::from)
}

/// The log, from now on; its first line says which build, and where it runs.
/// relaunched: started in another's place (--after).
pub fn start(relaunched: bool) {
    *JOURNAL.out.lock().unwrap() = open();
    #[cfg(unix)]
    let rewired = take_stderr(relaunched);
    #[cfg(not(unix))]
    let _ = relaunched;
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
    #[cfg(unix)]
    if let Some(how) = rewired {
        log::info!("{how}");
    }
}

/// Everything written to stderr (GTK, WebKit, GStreamer) into the log too,
/// line by line, and on to where it went before.
/// What it says of where stderr goes, when it's not where it came (a pipe
/// handed over by a build before this one: the journal instead).
#[cfg(unix)]
fn take_stderr(relaunched: bool) -> Option<String> {
    use std::io::{BufRead, BufReader};
    use std::os::fd::FromRawFd;
    let mut fds = [0; 2];
    let mut said = None;
    // SAFETY: plain POSIX calls on file descriptors this process owns.
    unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return None;
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
            return None;
        }
        libc::close(fds[1]);
        let mut to = File::from_raw_fd(saved);
        if handed_its_pipe(saved, relaunched) {
            match journal_stream() {
                Some(j) => {
                    to = j;
                    said = Some("its stderr was the pipe of the build before it, which nobody reads now: it writes to the journal itself".to_string());
                }
                None => said = Some("its stderr was the pipe of the build before it, which nobody reads now: only its log has it".to_string()),
            }
        }
        *STDERR.lock().unwrap() = Some(to);
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
                    forward(e, &line);
                }
            }
        });
        let _ = std::io::stderr().flush();
    }
    said
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

    // 200 KB on to a pipe nobody reads (it holds 64 KB): never held up.
    #[cfg(unix)]
    #[test]
    fn never_held_up() {
        use std::os::fd::FromRawFd;
        let mut fds = [0; 2];
        // SAFETY: a pipe of this test's own.
        let (read, mut write) = unsafe {
            assert_eq!(libc::pipe(fds.as_mut_ptr()), 0);
            (std::fs::File::from_raw_fd(fds[0]), std::fs::File::from_raw_fd(fds[1]))
        };
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for _ in 0..200 {
                super::forward(&mut write, &"x".repeat(1000));
            }
            let _ = tx.send(());
        });
        assert!(rx.recv_timeout(std::time::Duration::from_secs(5)).is_ok(), "forwarding waited on a full pipe");
        drop(read);
    }

    #[test]
    fn when() {
        let t = super::now();
        assert_eq!(t.len(), 20);
        assert!(t.starts_with("20") && t.ends_with('Z') && &t[10..11] == "T");
    }
}
