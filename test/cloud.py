# A cloud machine in one click (docs/plan-omarchy-and-machines.md, track F),
# end to end on this machine with fake clouds (test/cloud_fakes.py: Hetzner,
# DigitalOcean and Hostinger with their real request and response shapes),
# a fake tailnet (a `tailscale status --json` the fakes write), and real
# amarchy app servers: alpha makes the cloud machines, and for each one a
# machine of its own plays the new VM's amarchy (its name, paired for real
# once it answers). No money, no real VM, nothing of the live host's.
#
#   - tokens: kept in secrets/cloud.env (0600), checked with the provider
#     first (a wrong one refused, saying so), never in a chat's secrets,
#     masked; the Tailscale key: an auth key, not an API token;
#     `amarchy secret ask NAME --cloud` from a chat: the card, kept there;
#   - each provider's regions and sizes, with its own prices (Hetzner's
#     IPv4 added, a deprecated type gone, the 8 GB floor recommended);
#   - making one (it spends money: refused without --yes), for each
#     provider: its setup (cloud-init's user data, valid for cloud-init's
#     own schema; Hostinger's script) carrying bootstrap.sh and its
#     settings; its steps (creating → booting → installing → tailnet →
#     pairing → paired) moved on by the provider, the tailnet, its reports
#     and its hello; the spent Tailscale key forgotten; paired both ways;
#   - Hostinger's payment taking a while (202): set up once it's paid;
#   - what fails, in words: a refused size, a limit reached, a key that
#     never joins the tailnet, a setup that fails (its log kept), a name
#     taken, a report with the wrong token;
#   - the board's rows: the cloud machine, its price, its sign-ins;
#   - removing one: refused while it has chats unless said, its chats'
#     move asked (and a move that can't be done stops it, nothing deleted),
#     then it leaves the tailnet, both unpair, it's deleted (Hostinger:
#     stopped, not renewed);
#   - signing in to Claude and GitHub on a machine, here and through the
#     pass-through (fake claude and gh with their real prompts).
#
#   python3 test/cloud.py        exits 0 when every check passed (about two minutes)

import http.client, json, os, re, shutil, signal, socket, stat, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = str(ROOT / "bin/amarchy")
TMP = Path(os.environ.get("TMPDIR") or Path.home() / ".cache")
TMP.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(Path(__file__).resolve().parent)); import homes      # (test/homes.py: its home gone with it, however it ends)
BASE = Path(homes.home("cloud", TMP))
USER = "tester@example.com"
TAILNET = BASE / "tailnet.json"

failed = []


def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}", flush=True)
    if not ok:
        failed.append(what)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def until(fn, limit=20, step=0.25):
    end = time.time() + limit
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


# ---- fakes: claude (the chat engine, and its sign-in), gh, tailscale

FAKE = BASE / "bin"
FAKE.mkdir()
sys.path.insert(0, str(ROOT / "test"))
import cloud_fakes  # noqa: E402
cloud_fakes.write_bins(FAKE)
TAILNET.write_text(json.dumps({"BackendState": "Running", "Peer": {}}))

FAKES_PORT = free_port()
fakes_log = open(BASE / "fakes.log", "w")
fakes = subprocess.Popen([sys.executable, str(ROOT / "test/cloud_fakes.py"), "--port", str(FAKES_PORT),
                          "--tailnet", str(TAILNET), "--slow", "1"], stdout=fakes_log, stderr=fakes_log)
FAKES = f"http://127.0.0.1:{FAKES_PORT}"
until(lambda: socket.create_connection(("127.0.0.1", FAKES_PORT), timeout=0.3).close() or True, 10)

REACH = {}      # a cloud machine's name -> the test machine playing its amarchy


class Machine:
    def __init__(self, name):
        self.name, self.port = name, free_port()
        self.home = BASE / name
        self.work = self.home / "Work"
        self.url = f"http://127.0.0.1:{self.port}"
        self.socket = f"amarchy-cloudtest-{os.getpid()}-{name}"
        self.env = {
            "HOME": str(self.home), "XDG_STATE_HOME": str(self.home / "state"), "XDG_CONFIG_HOME": str(self.home / "config"),
            "AMARCHY_WORK": str(self.work), "AMARCHY_TMUX": self.socket, "AMARCHY_HOST_NAME": name,
            "AMARCHY_HOST_APP_PORT": str(self.port), "AMARCHY_HOST_URL": self.url, "AMARCHY_HOST_APP_LINKS": "off",
            "AMARCHY_HOST_APP_USERS": USER, "AUTO_UPDATE": "off", "AMARCHY_PEER_SILENT": "6",
            "PATH": f"{FAKE}:/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8", "FAKE_TAILNET": str(TAILNET),
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", ""),
            "DBUS_SESSION_BUS_ADDRESS": os.environ.get("DBUS_SESSION_BUS_ADDRESS", ""),
            "SHELL": "/bin/bash", "TERM": "xterm-256color",
            "AMARCHY_CLOUD_NO_UNITS": "1", "AMARCHY_CLOUD_POLL": "0.5",
            "AMARCHY_CLOUD_LIMITS": json.dumps({"installing": 6, "booting": 20, "tailnet": 20, "pairing": 20}),
            "AMARCHY_CLOUD_API_HETZNER": f"{FAKES}/hetzner/v1", "AMARCHY_CLOUD_API_DIGITALOCEAN": f"{FAKES}/digitalocean/v2",
            "AMARCHY_CLOUD_API_HOSTINGER": f"{FAKES}/hostinger",
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
        }
        self.proc, self.jar = None, None
        repo = self.work / "proj"
        repo.mkdir(parents=True)
        git = lambda *a: subprocess.run(["git", *a], cwd=repo, capture_output=True, env=self.env)
        git("init", "-q", "-b", "main")
        (repo / "README.md").write_text(f"# {name}\n")
        git("add", ".")
        git("commit", "-q", "-m", "first")

    def reach(self):
        self.env["AMARCHY_CLOUD_REACH"] = json.dumps(REACH)

    def amarchy(self, *args, input=None, timeout=60, env_extra=None):
        self.reach()
        return subprocess.run([sys.executable, BIN, *args], env={**self.env, **(env_extra or {})}, capture_output=True,
                              text=True, input=input, timeout=timeout)

    def start(self):
        self.reach()
        self.log = open(self.home / "server.log", "a")
        self.proc = subprocess.Popen([sys.executable, BIN, "app", "serve"], env=self.env, stdout=self.log, stderr=self.log,
                                     stdin=subprocess.DEVNULL, start_new_session=True)
        until(lambda: socket.create_connection(("127.0.0.1", self.port), timeout=0.2).close() or True, 20)
        key = until(lambda: (self.home / "state/amarchy/app/local.key").read_text().strip(), 10)
        code, h, _ = self.ask("GET", f"/local?key={key}", cookie=False)
        self.jar = h.get("Set-Cookie", "").split(";")[0]
        return code == 303

    def stop(self):
        if self.proc and self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
        subprocess.run(["tmux", "-L", self.socket, "kill-server"], capture_output=True)
        subprocess.run(["tmux", "-L", f"{self.socket}-signin", "kill-server"], capture_output=True)

    def ask(self, method, path, body=None, headers=None, cookie=True, timeout=40):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        h = {"Host": f"127.0.0.1:{self.port}", **({"Cookie": self.jar} if cookie and self.jar else {})}
        if method == "POST":
            h.update({"Origin": self.url, "Content-Type": "application/json"})
        h.update(headers or {})
        c.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers=h)
        r = c.getresponse()
        out = r.read()
        c.close()
        try:
            return r.status, dict(r.getheaders()), json.loads(out or b"{}")
        except ValueError:
            return r.status, dict(r.getheaders()), {"raw": out[:200]}

    def cloud(self):
        try:
            return {r["name"]: r for r in json.loads((self.home / "config/amarchy/cloud.json").read_text())}
        except (OSError, ValueError):
            return {}

    def machines(self):
        try:
            return {m["name"]: m for m in json.loads((self.home / "config/amarchy/machines.json").read_text())}
        except (OSError, ValueError):
            return {}

    def board_machines(self):
        return {m["name"]: m for m in self.ask("GET", "/api/state")[2].get("machines") or []}


def fake_state():
    c = http.client.HTTPConnection("127.0.0.1", FAKES_PORT, timeout=10)
    c.request("GET", "/_fake/state")
    return json.loads(c.getresponse().read())


def fake_vm(name, fail):
    c = http.client.HTTPConnection("127.0.0.1", FAKES_PORT, timeout=10)
    c.request("POST", "/_fake/vm", body=json.dumps({"name": name, "fail": fail}), headers={"Content-Type": "application/json"})
    c.getresponse().read()


def vm_for(name):
    """A machine playing the cloud machine's amarchy: its name, its own
    state, cloud-self.json as bootstrap.sh writes it."""
    m = Machine(name)
    (m.home / "config/amarchy").mkdir(parents=True, exist_ok=True)
    (m.home / "config/amarchy/cloud-self.json").write_text(json.dumps({"provider": "x", "by": "alpha", "made": int(time.time())}))
    (m.home / "config/amarchy/icon").write_text("cloud\n")
    REACH[name] = m.url
    return m


alpha = Machine("alpha")
cloud = vm_for("cloud")         # (each named before alpha starts: its watchers are told where each is)
hg = vm_for("cloud-hg")
machines = [alpha, cloud, hg]
try:
    print("tokens")
    r = alpha.amarchy("machines", "cloud", "providers", "--json")
    d = json.loads(r.stdout)
    check([p["key"] for p in d["providers"]] == ["hetzner", "digitalocean", "hostinger"] and not any(p["connected"] for p in d["providers"])
          and d["tailscale_key"] is False, "three providers, none connected yet, no Tailscale key")
    r = alpha.amarchy("machines", "cloud", "token", "hetzner", input="wrong-token\n")
    check(r.returncode != 0 and "didn't take the token" in r.stderr and "console.hetzner.com" in r.stderr,
          "a wrong Hetzner token is refused, saying where to make one")
    r = alpha.amarchy("machines", "cloud", "token", "hetzner", input="good-hetzner\n")
    env = alpha.home / "config/amarchy/secrets/cloud.env"
    check(r.returncode == 0 and "never given to a chat" in r.stdout and env.exists()
          and stat.S_IMODE(env.stat().st_mode) == 0o600 and "HCLOUD_TOKEN='good-hetzner'" in env.read_text(),
          "the Hetzner token kept in secrets/cloud.env, 0600")
    r = alpha.amarchy("secret", "list", "--json")
    check("HCLOUD_TOKEN" not in r.stdout, "a cloud token isn't one of the projects' secrets (no chat gets it)")
    r = alpha.amarchy("machines", "cloud", "token", "tailscale", input="tskey-api-abc\n")
    check(r.returncode != 0 and "API token" in r.stderr, "a Tailscale API token is refused: an auth key is wanted")
    r = alpha.amarchy("machines", "cloud", "token", "tailscale", input="notakey\n")
    check(r.returncode != 0 and "tskey-" in r.stderr, "something that isn't a Tailscale key is refused")
    for p in ("digitalocean", "hostinger"):
        r = alpha.amarchy("machines", "cloud", "token", p, input=f"good-{p}\n")
        check(r.returncode == 0, f"the {p} token kept ({r.stdout.strip()[:90]})")

    print("regions and sizes, with their prices")
    r = alpha.amarchy("machines", "cloud", "regions", "hetzner", "--json")
    regions = json.loads(r.stdout)
    check([x["id"] for x in regions] == ["fsn1", "nbg1", "hel1", "ash"] and regions[0]["label"] == "Falkenstein, Germany",
          "Hetzner's locations, in words")
    sizes = {s["id"]: s for s in json.loads(alpha.amarchy("machines", "cloud", "sizes", "hetzner", "fsn1", "--json").stdout)}
    check("cx22" not in sizes and "cx11" not in sizes, "a deprecated type and one under 2 GB aren't offered")
    check(sizes.get("cx33", {}).get("monthly") == 5.99 and sizes["cx33"]["currency"] == "EUR" and sizes["cx33"]["recommended"]
          and not sizes["cx23"]["recommended"] and not sizes["cx23"]["enough"],
          "cx33 at €5.99 a month (with its IPv4), recommended: the cheapest with 8 GB")
    ash = {s["id"] for s in json.loads(alpha.amarchy("machines", "cloud", "sizes", "hetzner", "ash", "--json").stdout)}
    check("cax21" not in ash and "cx33" in ash, "a type that isn't in that location isn't offered there")
    do = {s["id"]: s for s in json.loads(alpha.amarchy("machines", "cloud", "sizes", "digitalocean", "nyc3", "--json").stdout)}
    check(do.get("s-4vcpu-8gb", {}).get("recommended") and do["s-4vcpu-8gb"]["monthly"] == 48 and "gpu-h100x1-80gb" not in do
          and "s-1vcpu-1gb" not in do, "DigitalOcean: s-4vcpu-8gb at $48 recommended; no GPU, nothing under 2 GB")
    do_regions = [x["id"] for x in json.loads(alpha.amarchy("machines", "cloud", "regions", "digitalocean", "--json").stdout)]
    check(do_regions == ["nyc3", "fra1"], "DigitalOcean: only the regions that take new droplets")
    kvm = {s["label"]: s for s in json.loads(alpha.amarchy("machines", "cloud", "sizes", "hostinger", "17", "--json").stdout)}
    check(kvm.get("KVM 2", {}).get("monthly") == 14.99 and kvm["KVM 2"]["recommended"] and kvm["KVM 2"]["memory_gb"] == 8
          and "first" in kvm["KVM 2"]["note"] and kvm["KVM 2"]["id"] == "hostingercom-vps-kvm2-usd-1m",
          "Hostinger: KVM 2 at $14.99 a month (its plan's 8 GB, the first month's price said), recommended")
    out = alpha.amarchy("machines", "cloud", "sizes", "hetzner", "fsn1").stdout
    check("€5.99/month\trecommended" in out and "(under 8 GB: fewer chats)" in out, "the CLI's list: prices, the 8 GB floor")

    print("making one: refused without a key or a yes")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hetzner", "--yes")
    check(r.returncode != 0 and "no Tailscale key" in r.stderr and "admin/settings/keys" in r.stderr,
          "no Tailscale key yet: refused, with Tailscale's Keys page")
    r = alpha.amarchy("machines", "cloud", "token", "tailscale", input="tskey-auth-kTEST-0123456789\n")
    check(r.returncode == 0, "a one-off Tailscale auth key kept")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hetzner")
    check(r.returncode != 0 and "spends money" in r.stderr and "--yes" in r.stderr and not alpha.cloud(),
          "without --yes (not in a terminal): refused, it spends money; nothing made")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hetzner", "--size", "cx53", "--yes")
    check(r.returncode != 0 and "limit is reached" in r.stderr and not alpha.cloud(),
          "Hetzner's limit reached: said so, nothing kept")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hetzner", "--name", "Alpha!", "--yes")
    check(r.returncode != 0 and "lowercase" in r.stderr, "a name that can't be a machine's: refused")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hetzner", "--name", "alpha", "--yes")
    check(r.returncode != 0 and "already" in r.stderr, "this machine's own name: refused")

    print("the app server")
    check(alpha.start(), "alpha's app")
    code, _, d = alpha.ask("GET", "/api/cloud")
    check(code == 200 and d["ready"] and d["name"] == "cloud" and [p["connected"] for p in d["providers"]] == [True, True, True]
          and d["tailscale_key"] and "good-hetzner" not in json.dumps(d) and "tskey-auth" not in json.dumps(d),
          "GET /api/cloud: the providers connected, the key there, a name to start with (never a token)")
    code, _, d = alpha.ask("GET", "/api/cloud/options?provider=hetzner&region=nbg1")
    check(code == 200 and any(s["id"] == "cx33" and s["recommended"] for s in d["sizes"]), "GET /api/cloud/options: a region's sizes")
    code, _, d = alpha.ask("GET", "/api/cloud/options?provider=nope")
    check(code == 409 and "provider" in d.get("error", ""), "an unknown provider: said so")

    print("Hetzner: made, set up, on the tailnet, paired")
    # Its amarchy answers once its app is on (as on a real one): started
    # when it reports that.
    import threading
    started = {}
    threading.Thread(target=lambda: until(lambda: "report:app" in (alpha.cloud().get("cloud", {}).get("steps") or {}), 40)
                     and started.update(ok=cloud.start()), daemon=True).start()
    alpha.reach()
    code, _, d = alpha.ask("POST", "/api/cloud", {"action": "create", "provider": "hetzner", "region": "fsn1", "size": "cx33", "name": "cloud"})
    check(code == 200 and d["machine"]["step"] == "booting" and d["machine"]["monthly"] == 5.99 and "report" not in d["machine"],
          f"created from the app: booting, €5.99 a month, no report token shown ({d.get('error') or ''})")
    fs = fake_state()
    srv = next(iter(fs["hetzner"].values()), {})
    ud = srv.get("user_data") or ""
    (BASE / "user-data.yaml").write_text(ud)
    check(srv.get("server_type", {}).get("name") == "cx33" and srv.get("image", {}).get("name") == "debian-13"
          and srv.get("labels") == {"amarchy": "cloud", "amarchy-by": "alpha"} and ud.startswith("#cloud-config"),
          "Hetzner got cx33, Debian 13, its labels, cloud-init's user data")
    check("TS_AUTH_KEY='tskey-auth-kTEST-0123456789'" in ud and f"REPORT_URL='{alpha.url}'" in ud and "REPORT_TOKEN='" in ud
          and "AMARCHY_REPO='https://" in ud and "AMARCHY_NAME='cloud'" in ud, "its settings: the key, where to report, the repo")
    check(not any(f"good-{x}" in ud for x in ("hetzner", "digitalocean", "hostinger")), "no provider token in its setup (it never leaves alpha)")
    found = re.search(r"REPORT_TOKEN='([^']+)'", ud)
    report_token = found.group(1) if found else ""
    import base64 as b64, gzip as gz
    packed = re.search(r"encoding: gz\+b64\n    content: (\S+)", ud)
    check(bool(packed) and gz.decompress(b64.b64decode(packed.group(1))).decode() == (ROOT / "cloud/bootstrap.sh").read_text(),
          "its setup carries cloud/bootstrap.sh as it is")
    if shutil.which("cloud-init"):
        r = subprocess.run(["cloud-init", "schema", "--config-file", str(BASE / "user-data.yaml")], capture_output=True, text=True)
        check(r.returncode == 0 and "Valid schema" in r.stdout + r.stderr, "cloud-init's own schema takes it")
    rec = until(lambda: alpha.cloud().get("cloud", {}).get("step") == "paired" and alpha.cloud()["cloud"], 40)
    check(started.get("ok"), "its amarchy came up once it said its app was on")
    check(bool(rec), f"paired, step by step ({(alpha.cloud().get('cloud') or {}).get('step')}: {(alpha.cloud().get('cloud') or {}).get('detail')})")
    rec = alpha.cloud().get("cloud") or {}
    steps = rec.get("steps") or {}
    check(all(s in steps for s in ("creating", "booting", "installing", "tailnet", "pairing", "paired")) and
          steps["creating"] <= steps["booting"] <= steps["installing"] <= steps["tailnet"] <= steps["pairing"] <= steps["paired"],
          "every step, in order")
    check(all(f"report:{s}" in steps for s in ("tailnet", "packages", "claude", "amarchy", "app")),
          f"its reports came (tailnet, packages, claude, amarchy, app: {sorted(steps)} {[x for x in fake_state()['log'] if 'report' in x][:8]})")
    check(rec.get("node") == "cloud.tail0000.ts.net" and rec.get("machine") == "cloud" and not rec.get("report"),
          "its node on the tailnet, the machine it is; its report token dropped once paired")
    code, _, _ = alpha.ask("POST", "/api/cloud/progress", {"name": "cloud", "step": "failed", "words": "x"},
                           headers={"Authorization": f"Bearer {report_token}", "Origin": ""})
    check(code == 403 and bool(report_token) and alpha.cloud()["cloud"]["step"] == "paired",
          "its token, dead once it's paired: a later report refused, nothing changed")
    for path in ("/api/cloud", "/api/peer/state", "/api/peer/pair"):
        code, _, _ = alpha.ask("POST" if path != "/api/peer/state" else "GET", path, {} if path != "/api/peer/state" else None,
                               headers={"Authorization": f"Bearer {report_token}", "X-Amarchy-Peer": "cloud", "Origin": ""}, cookie=False)
        check(code in (400, 403), f"its token opens nothing else ({path}: {code})")
    check("cloud" in alpha.machines() and "alpha" in cloud.machines()
          and alpha.machines()["cloud"]["key"] == cloud.machines()["alpha"]["key"], "paired both ways, one key")
    check("TAILSCALE_AUTH_KEY" not in env.read_text(), "the spent Tailscale key forgotten here")
    bm = until(lambda: (lambda b: b.get("cloud") if b.get("cloud", {}).get("on") else None)(alpha.board_machines()), 15) or {}
    check(bm.get("cloud", {}).get("provider_label") == "Hetzner Cloud" and bm["cloud"].get("monthly") == 5.99 and
          bm["cloud"].get("made_here") and bm.get("icon") == "cloud" and bm.get("claude") == "out" and bm.get("github") == "out",
          "on the board: its row says Hetzner, €5.99, its Claude and GitHub not signed in yet")
    me = alpha.board_machines().get("alpha", {})
    check(me.get("claude") == "out" and me.get("github") == "out" and me.get("cloud") is None, "this machine's own row: its sign-ins")

    print("signing in on the cloud machine, from alpha's app (the pass-through)")
    code, _, d = alpha.ask("GET", "/api/m/cloud/api/signin/claude")
    check(code == 200 and d.get("signed_in") is False and d.get("login") is None, "its Claude isn't signed in")
    code, _, d = alpha.ask("POST", "/api/m/cloud/api/signin/claude", {"do": "login"})
    check(code == 200 and str(d.get("url", "")).startswith("https://claude.com/cai/oauth/authorize"), f"Sign in: Anthropic's sign-in link ({code} {d})")
    code, _, d = alpha.ask("POST", "/api/m/cloud/api/signin/claude", {"do": "code", "code": "bad"})
    check(code == 409 and "didn't take the code" in d.get("error", ""), "a wrong code: said so")
    code, _, d = alpha.ask("POST", "/api/m/cloud/api/signin/claude", {"do": "login"})
    code, _, d = alpha.ask("POST", "/api/m/cloud/api/signin/claude", {"do": "code", "code": "good-code#state"})
    check(code == 200 and d.get("signed_in") and d.get("who") == "tester@example.com" and d.get("plan") == "max",
          "the right code: signed in, as who, on which plan")
    code, _, d = alpha.ask("POST", "/api/m/cloud/api/signin/github", {"do": "login"})
    check(code == 200 and d.get("url") == "https://github.com/login/device" and d.get("code") == "ABCD-1234",
          "GitHub: its device page and the code to type there")
    got = until(lambda: alpha.ask("GET", "/api/m/cloud/api/signin/github")[2].get("signed_in"), 15)
    check(bool(got) and (cloud.home / ".fake-gh-setup-git").exists(), "GitHub signed in by itself, then gh auth setup-git")
    bm = until(lambda: (lambda b: b if b.get("claude") == "in" and b.get("github") == "in" else None)(alpha.board_machines().get("cloud", {})), 75)
    check(bool(bm), "the board says both are signed in there")
    code, _, d = alpha.ask("GET", "/api/signin/claude")
    check(code == 200 and d.get("signed_in") is False, "this machine's own Claude, apart (not signed in)")

    print("its reports, only with its token")
    code, _, d = alpha.ask("POST", "/api/cloud/progress", {"name": "cloud", "step": "app", "words": "x"},
                           headers={"Authorization": "Bearer nope"})
    check(code == 403, "a report with the wrong token: refused")
    code, _, d = alpha.ask("POST", "/api/cloud/progress", {"name": "nope", "step": "app"}, headers={"Authorization": "Bearer x"})
    check(code == 403, "one for a machine not being made: refused")

    print("a secret asked from a chat, for the cloud: the card, kept for the cloud only")
    r = alpha.amarchy("new", "proj", "asker")
    sid = r.stdout.strip().splitlines()[-1] if r.returncode == 0 else ""
    check(bool(sid), f"a chat ({sid})")
    asker = subprocess.Popen([sys.executable, BIN, "secret", "ask", "DIGITALOCEAN_TOKEN", "--cloud", "--again", "--why", "to make a cloud machine",
                              "--timeout", "30"], env={**alpha.env, "AMARCHY_SESSION": sid}, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    ask = until(lambda: next((s.get("secret_asks") or [None])[0] for s in alpha.ask("GET", "/api/state")[2]["sessions"]
                             if s["id"] == sid), 15)
    check(bool(ask) and ask.get("scope") == "cloud", f"its card in the chat, for the cloud ({ask})")
    if ask:
        code, _, d = alpha.ask("POST", f"/api/session/{sid}/secret", {"ask": ask["id"], "value": "wrong", "scope": "cloud"})
        check(code == 400 and "didn't take the token" in d.get("error", ""), "a wrong token on the card: DigitalOcean's words")
        code, _, d = alpha.ask("POST", f"/api/session/{sid}/secret", {"ask": ask["id"], "value": "good-digitalocean", "scope": "cloud"})
        out, err = asker.communicate(timeout=20)
        check(code == 200 and asker.returncode == 0 and "never given to a chat" in out
              and "good-digitalocean" not in out + err, "saved from the card; Claude hears it's kept, never its value")
        check("DIGITALOCEAN_TOKEN" not in alpha.amarchy("secret", "list").stdout, "and it isn't a chat's secret")
    else:
        asker.kill()

    print("DigitalOcean, and what fails")
    alpha.amarchy("machines", "cloud", "token", "tailscale", input="tskey-auth-kTEST-two\n")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "digitalocean", "--region", "nyc3", "--size", "s-8vcpu-16gb",
                      "--name", "cloud-do", "--yes")
    check(r.returncode != 0 and "droplet limit" in r.stderr and "cloud-do" not in alpha.cloud(), "a droplet limit: said so")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "digitalocean", "--name", "cloud", "--yes")
    check(r.returncode != 0 and "already" in r.stderr, "a name taken: refused")
    fake_vm("cloud-do", "tailnet")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "digitalocean", "--region", "fra1", "--name", "cloud-do", "--yes",
                      "--wait", timeout=60)
    rec = alpha.cloud().get("cloud-do", {})
    check(r.returncode == 1 and rec.get("step") == "failed" and "Tailscale key" in (rec.get("error") or "")
          and "hasn't joined your tailnet" in rec["error"], "a key that never joins: failed, saying it's most likely the key")
    check("TAILSCALE_AUTH_KEY" in env.read_text(), "the key it never used stays for the next one")
    drop = next((d for d in fake_state()["digitalocean"].values() if d["name"] == "cloud-do"), {})
    check(drop.get("size_slug") == "s-4vcpu-8gb" and drop.get("image", {}).get("slug") == "debian-13-x64" and "amarchy" in drop.get("tags", []),
          "DigitalOcean got s-4vcpu-8gb, Debian 13, the amarchy tag")
    r = alpha.amarchy("machines", "cloud", "remove", "cloud-do", "--yes", timeout=60)
    check(r.returncode == 0 and "Deleted at DigitalOcean" in r.stdout and not any(d["name"] == "cloud-do" for d in fake_state()["digitalocean"].values()),
          "Remove a failed one: deleted at DigitalOcean")
    fake_vm("cloud-bad", "claude")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hetzner", "--region", "hel1", "--name", "cloud-bad", "--yes", "--wait", timeout=60)
    rec = alpha.cloud().get("cloud-bad", {})
    check(rec.get("step") == "failed" and "Installing Claude Code failed" in (rec.get("error") or "")
          and "Could not resolve host" in (rec.get("log") or ""), "a setup that fails: its words, and its log's end")
    check(not rec.get("report"), "its report token, dead once it failed")
    r = alpha.amarchy("machines", "cloud", "status", "cloud-bad")
    check("its log" in r.stdout and "Could not resolve host" in r.stdout, "amarchy machines cloud status shows it")
    alpha.amarchy("machines", "cloud", "remove", "cloud-bad", "--yes", timeout=60)

    print("Hostinger: paid for a while (202), then set up with the same script")
    check(hg.start(), "the machine playing its amarchy")
    alpha.amarchy("machines", "cloud", "token", "tailscale", input="tskey-auth-kTEST-three\n")
    r = alpha.amarchy("machines", "cloud", "add", "--provider", "hostinger", "--region", "17", "--size", "hostingercom-vps-kvm1-usd-1m",
                      "--name", "cloud-hg", "--yes")
    check(r.returncode == 0 and alpha.cloud().get("cloud-hg", {}).get("step") == "creating" and alpha.cloud()["cloud-hg"].get("subscription"),
          "its payment is still being taken: waiting for it")
    rec = until(lambda: alpha.cloud().get("cloud-hg", {}).get("step") == "paired" and alpha.cloud()["cloud-hg"], 45)
    check(bool(rec), f"set up once paid, then paired ({(alpha.cloud().get('cloud-hg') or {}).get('step')}: {(alpha.cloud().get('cloud-hg') or {}).get('detail') or (alpha.cloud().get('cloud-hg') or {}).get('error')})")
    check(not fake_state()["scripts"], "its post-install script (the key in it) deleted at Hostinger once used")
    hs = next(iter(fake_state()["hostinger"].values()), {}).get("_script", "")
    check(hs.startswith("#!/bin/bash") and "TS_AUTH_KEY='tskey-auth-kTEST-three'" in hs and "good-hostinger" not in hs,
          "Hostinger's script: the key, never the Hostinger token")
    check((alpha.cloud().get("cloud-hg") or {}).get("billing") == "subscription", "billed by subscription")

    print("removing one")
    code, _, d = alpha.ask("POST", "/api/m/cloud/api/new", {"repo": "proj", "name": "busy-one"})
    has_chat = until(lambda: any(s.get("machine") == "cloud" for s in alpha.ask("GET", "/api/state")[2]["sessions"]), 15)
    check(bool(has_chat), "a chat on the cloud machine")
    r = alpha.amarchy("machines", "cloud", "remove", "cloud", "--yes")
    check(r.returncode != 0 and "1 chat" in r.stderr and "--move-chats" in r.stderr and "--lose-chats" in r.stderr,
          "Remove with a chat on it: refused until you say move them or lose them")
    code, _, d = alpha.ask("POST", "/api/cloud", {"action": "remove", "name": "cloud", "move_chats": True})
    rec = until(lambda: (lambda r: r if r.get("error") and not r.get("remove") else None)(alpha.cloud().get("cloud", {})), 40)
    check(bool(rec) and "couldn't move" in rec["error"] and "Nothing was deleted" in rec["error"]
          and any(s["name"] == "cloud" for s in fake_state()["hetzner"].values()) and "cloud" in alpha.machines(),
          f"its chat couldn't move (no origin here): stopped, nothing deleted ({(rec or {}).get('error')})")
    code, _, d = alpha.ask("POST", "/api/cloud", {"action": "remove", "name": "cloud", "lose_chats": True})
    rec = until(lambda: alpha.cloud().get("cloud", {}).get("step") == "removed" and alpha.cloud()["cloud"], 40)
    check(bool(rec) and "Deleted at Hetzner" in rec.get("detail", "") and not fake_state()["hetzner"].get(str(rec.get("id")))
          and not any(s["name"] == "cloud" for s in fake_state()["hetzner"].values()), "lose its chats: deleted at Hetzner")
    check("cloud" not in alpha.machines() and "alpha" not in cloud.machines(), "both forgot the other")
    check(until(lambda: (cloud.home / ".fake-tailscale-logout").exists(), 5), "it left the tailnet first (tailscale logout there)")
    code, _, d = alpha.ask("POST", "/api/cloud", {"action": "dismiss", "name": "cloud"})
    check(code == 200 and "cloud" not in alpha.cloud(), "a removed one let go of from the list")
    r = alpha.amarchy("machines", "cloud", "remove", "cloud-hg", "--yes", timeout=60)
    sub = next(iter(fake_state()["subscriptions"].values()), {})
    check(r.returncode == 0 and "isn't renewed" in r.stdout and "2026-12-22" in r.stdout and sub.get("is_auto_renewed") is False
          and next(iter(fake_state()["hostinger"].values()), {}).get("state") == "stopped",
          "Hostinger: stopped, and its subscription not renewed (it ends on its date)")
finally:
    for m in machines:
        m.stop()
    fakes.terminate()
    subprocess.run(["pkill", "-f", f"{BASE}"], capture_output=True)
    if failed:
        homes.keep(BASE)      # to look at

print(f"\n{'all passed' if not failed else f'{len(failed)} failed: ' + '; '.join(failed)}" + ("" if not failed else f" (kept: {BASE})"))
sys.exit(1 if failed else 0)
