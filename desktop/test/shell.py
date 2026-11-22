# Drives the real desktop app for its tests: amarchy-desktop (built with
# --features test-hooks) in an X server of its own (Xvfb), with real keys
# and clicks (xdotool), JavaScript run in its window, screenshots of the
# screen, and the memory it takes.
#
#   from shell import Shell
#   with Shell(url, size=(1280, 800)) as w:
#       w.wait("document.querySelector('#look')")
#       w.shot("/tmp/board.png")

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get("AMARCHY_DESKTOP_BIN") or ROOT / "desktop/target/debug/amarchy-desktop")


def free_display():
    for n in range(80, 200):
        if not Path(f"/tmp/.X11-unix/X{n}").exists() and not Path(f"/tmp/.X{n}-lock").exists():
            return n
    raise RuntimeError("no free X display")


class Shell:
    def __init__(self, url, size=(1280, 800), env=None, args=(), home=None, visible=True, sized=True, screen=None):
        self.url, self.size, self.extra_env, self.args = url, size, env or {}, list(args)
        self.home, self.visible, self.sized, self.screen = home, visible, sized, screen
        self.results, self.lines, self.n = {}, [], 0
        self.cond = threading.Condition()

    def __enter__(self):
        self.display = free_display()
        w, h = self.size
        sw, sh = self.screen or self.size
        self.xvfb = subprocess.Popen(["Xvfb", f":{self.display}", "-screen", "0", f"{sw}x{sh}x24", "-nolisten", "tcp"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if Path(f"/tmp/.X11-unix/X{self.display}").exists():
                break
            time.sleep(0.1)
        # A session bus of its own (the single instance is found on it), so
        # a second start (again()) reaches this one and nothing else.
        self.bus = subprocess.Popen(["dbus-daemon", "--session", "--nofork", "--print-address=1"],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                    env={**os.environ, "DISPLAY": f":{self.display}"})
        address = self.bus.stdout.readline().strip()
        env = {**os.environ, "DISPLAY": f":{self.display}", "GDK_BACKEND": "x11", "NO_AT_BRIDGE": "1",
               "DBUS_SESSION_BUS_ADDRESS": address, **self.extra_env}
        env.pop("WAYLAND_DISPLAY", None)
        if self.home:
            env.update(HOME=self.home, XDG_CONFIG_HOME=f"{self.home}/.config", XDG_DATA_HOME=f"{self.home}/.local/share",
                       XDG_STATE_HOME=f"{self.home}/.local/state", XDG_CACHE_HOME=f"{self.home}/.cache")
        self.env = env
        cmd = [str(BIN), *(["--url", self.url] if self.url else []), *self.args]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                     env=env, text=True, bufsize=1)
        threading.Thread(target=self._read, daemon=True).start()
        if self.visible:
            self.window = self._find_window()
            if self.sized:
                self.resize(w, h)
        else:
            self.window = None
        return self

    def again(self, *args, timeout=15):
        """amarchy-desktop started a second time, as a key or a link would:
        what it printed and how it ended (it hands its arguments over)."""
        r = subprocess.run([str(BIN), *args], env=self.env, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout + r.stderr

    def do(self, what, timeout=10):
        """What the shell itself does or is: close, url, visible, size."""
        self.n += 1
        rid = str(self.n)
        self.proc.stdin.write(json.dumps({"id": rid, "do": what}) + "\n")
        self.proc.stdin.flush()
        end = time.time() + timeout
        with self.cond:
            while rid not in self.results:
                left = end - time.time()
                if left <= 0:
                    raise TimeoutError(what)
                self.cond.wait(left)
            return json.loads(self.results.pop(rid))

    def __exit__(self, *exc):
        self.close()

    def close(self):
        if getattr(self, "proc", None) and self.proc.poll() is None:
            for p in self.tree():
                try:
                    os.kill(p, 15)
                except OSError:
                    pass
            try:
                self.proc.wait(5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        if getattr(self, "bus", None):
            for p in self.tree(self.bus.pid)[1:]:      # what it started (the portals)
                try:
                    os.kill(p, 15)
                except OSError:
                    pass
            self.bus.terminate()
            self.bus.wait()
        if getattr(self, "xvfb", None):
            self.xvfb.terminate()
            self.xvfb.wait()

    def _read(self):
        for line in self.proc.stdout:
            line = line.rstrip("\n")
            with self.cond:
                if line.startswith("@@"):
                    rid, _, value = line[2:].partition(" ")
                    self.results[rid] = value
                else:
                    self.lines.append(line)
                self.cond.notify_all()

    def log(self):
        with self.cond:
            return list(self.lines)

    def xdo(self, *args):
        return subprocess.run(["xdotool", *map(str, args)], env=self.env, capture_output=True, text=True).stdout.strip()

    def _find_window(self, timeout=30):
        end = time.time() + timeout
        while time.time() < end:
            ids = self.xdo("search", "--onlyvisible", "--name", "Amarchy").split()
            if ids:
                return ids[0]
            if self.proc.poll() is not None:
                raise RuntimeError("the app ended: " + "\n".join(self.lines[-20:]))
            time.sleep(0.2)
        raise RuntimeError("its window never showed: " + "\n".join(self.lines[-20:]))

    def resize(self, w, h):
        self.xdo("windowmove", self.window, 0, 0)
        self.xdo("windowsize", self.window, w, h)
        time.sleep(0.3)

    # ---- JavaScript in its window

    def js(self, code, timeout=15):
        """The value of an expression in the page (JSON-able), or of an async
        function's body (await inside) when it holds an await."""
        self.n += 1
        rid = str(self.n)
        if "await " in code:
            slot = f"window.__amarchyTest = window.__amarchyTest || {{}}"
            run = (f"{slot}; window.__amarchyTest[{rid}] = undefined; (async () => {{ {code} }})()"
                   f".then(v => window.__amarchyTest[{rid}] = {{v: v === undefined ? null : v}},"
                   f" e => window.__amarchyTest[{rid}] = {{e: String(e && e.stack || e)}}); 0")
            self._eval(rid + "s", run, timeout)
            end = time.time() + timeout
            while time.time() < end:
                got = self._eval(rid + "p", f"window.__amarchyTest[{rid}] === undefined ? '__pending' : window.__amarchyTest[{rid}]", timeout)
                if got != "__pending":
                    if isinstance(got, dict) and "e" in got:
                        raise RuntimeError(got["e"])
                    return got.get("v") if isinstance(got, dict) else got
                time.sleep(0.1)
            raise TimeoutError(code[:200])
        return self._eval(rid, code, timeout)

    def _eval(self, rid, code, timeout):
        self.proc.stdin.write(json.dumps({"id": rid, "js": code}) + "\n")
        self.proc.stdin.flush()
        end = time.time() + timeout
        with self.cond:
            while rid not in self.results:
                left = end - time.time()
                if left <= 0:
                    raise TimeoutError(code[:200])
                self.cond.wait(left)
            raw = self.results.pop(rid)
        try:
            return json.loads(raw) if raw else None
        except ValueError:
            return raw

    def wait(self, code, timeout=20, every=0.2):
        end = time.time() + timeout
        last = None
        while time.time() < end:
            try:
                last = self.js(code)
            except (TimeoutError, RuntimeError) as e:
                last = str(e)
            if last and last is not True or last is True:
                if last:
                    return last
            time.sleep(every)
        raise TimeoutError(f"{code[:160]} (last: {str(last)[:200]})")

    # ---- real input

    # Real input (XTEST), as a keyboard and a mouse give it: GTK ignores
    # what's sent to a window (xdotool's --window), so the window is focused
    # first and gets what the screen gets.
    def focus(self):
        self.xdo("windowfocus", "--sync", self.window)

    def key(self, *keys):
        self.focus()
        self.xdo("key", "--clearmodifiers", *keys)

    def type(self, text, delay=12):
        self.focus()
        self.xdo("type", "--delay", delay, text)

    def click(self, x, y, button=1):
        self.xdo("mousemove", "--window", self.window, int(x), int(y), "click", button)

    def click_el(self, selector, button=1):
        r = self.js(f"(() => {{ const e = document.querySelector({json.dumps(selector)}); if (!e) return null;"
                    f" const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }})()")
        if not r:
            raise RuntimeError(f"no {selector}")
        self.click(r[0], r[1], button)

    def scroll(self, x, y, down=True, times=1):
        self.xdo("mousemove", "--window", self.window, int(x), int(y))
        for _ in range(times):
            self.xdo("click", 5 if down else 4)

    def clipboard(self, data, kind="text/plain"):
        """What's copied on this screen (xclip), for a paste."""
        p = subprocess.Popen(["xclip", "-selection", "clipboard", "-t", kind, "-i"], stdin=subprocess.PIPE, env=self.env)
        p.stdin.write(data if isinstance(data, bytes) else data.encode())
        p.stdin.close()
        time.sleep(0.3)
        return p

    def shot(self, path):
        subprocess.run(["import", "-window", "root", str(path)], env=self.env, check=True)
        return path

    # ---- the memory it takes

    def tree(self, root=None):
        """Its processes (the shell, WebKit's web and network processes)."""
        out = subprocess.run(["ps", "-e", "-o", "pid=,ppid="], capture_output=True, text=True).stdout.split("\n")
        kids = {}
        for line in out:
            if line.strip():
                pid, ppid = map(int, line.split())
                kids.setdefault(ppid, []).append(pid)
        seen, todo = [], [root or self.proc.pid]
        while todo:
            p = todo.pop()
            seen.append(p)
            todo += kids.get(p, [])
        return seen

    def memory(self):
        """{process name: MB} by proportional set size (PSS: shared pages split
        between the processes that share them), and the total."""
        out = {}
        for p in self.tree():
            try:
                name = Path(f"/proc/{p}/comm").read_text().strip()
                pss = next(int(l.split()[1]) for l in Path(f"/proc/{p}/smaps_rollup").read_text().splitlines()
                           if l.startswith("Pss:"))
            except (OSError, StopIteration):
                continue
            if name in ("xdg-desktop-por", "xdg-document-po", "xdg-permission-"):
                continue
            out[name] = out.get(name, 0) + pss / 1024
        out["total"] = sum(out.values())
        return {k: round(v) for k, v in out.items()}


def need(*tools):
    missing = [t for t in tools if not shutil.which(t)]
    if missing:
        raise SystemExit(f"Needs {', '.join(missing)}")
