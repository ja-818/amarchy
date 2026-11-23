# A cloud machine's setup, run for real (docs/plan-omarchy-and-machines.md,
# track F): Debian 13's own cloud image (the one Hetzner and DigitalOcean
# make machines from), booted in QEMU here, given the user data amarchy
# renders (cloud-init's NoCloud, over HTTP), runs cloud/bootstrap.sh as a
# real one would: your user with sudo and lingering, the packages (tmux 3.5),
# security upgrades, swap, the firewall, Claude Code (its real installer)
# and amarchy (cloned from this checkout, install.sh, its app on), each step
# reported to this test as it would be to the machine that made it.
#
# Only Tailscale is stood in for (the tests' overrides.sh: a tailscale that
# answers as a signed-in one, with HTTPS certificates; joining a real tailnet
# needs a real key). Then a check inside: what listens, the firewall, sshd
# off, the secrets gone, the app answering as amarchy.
#
#   python3 test/cloud-vm.py [--image <debian-13-genericcloud-amd64.qcow2>]
#
# Needs qemu-system-x86_64 and qemu-img (KVM if there is one; else it runs
# emulated, slower: 20 to 40 minutes), and the internet (Debian's packages,
# Claude Code's installer). Exits 0 when every check passed.

import argparse, base64, gzip, http.server, json, os, shutil, socket, subprocess, sys, tempfile, threading, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN = ROOT / "bin/amarchy"
TMP = Path(os.environ.get("TMPDIR") or Path.home() / ".cache")
CACHE = Path.home() / ".cache/cloudtest/images"
IMAGE_URL = "https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2"

ap = argparse.ArgumentParser()
ap.add_argument("--image", default=str(CACHE / "debian-13-genericcloud-amd64.qcow2"))
ap.add_argument("--limit", type=int, default=75 * 60, help="seconds to wait for it to be ready")
ap.add_argument("--keep", action="store_true", help="keep the VM's files (and print where)")
opts = ap.parse_args()

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


for tool in ("qemu-system-x86_64", "qemu-img", "git"):
    if not shutil.which(tool):
        sys.exit(f"needs {tool}")
image = Path(opts.image)
if not image.exists():
    sys.exit(f"no image at {image}: fetch {IMAGE_URL} there (and check it against its SHA512SUMS)")

BASE = Path(tempfile.mkdtemp(prefix="cloud-vm-", dir=TMP))
PORT = free_port()
REPORT_TOKEN = base64.b64encode(os.urandom(18)).decode().replace("+", "-").replace("/", "_")
NAME, USER = "cloudvm", "ja"
reports = []

# ---- this checkout, as the repository it clones (git's dumb HTTP)

repo = BASE / "srv/amarchy.git"
subprocess.run(["git", "clone", "-q", "--bare", "--no-local", str(ROOT), str(repo)], check=True)
head = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
subprocess.run(["git", "-C", str(repo), "update-ref", "refs/heads/main", head], check=True)
subprocess.run(["git", "-C", str(repo), "symbolic-ref", "HEAD", "refs/heads/main"], check=True)
subprocess.run(["git", "-C", str(repo), "update-server-info"], check=True)
print(f"the VM clones {head[:12]} (this checkout's HEAD: commit what you want tested)")

# ---- what the VM is given: amarchy's own rendering, with the tests' stand-in for Tailscale

env = {**os.environ, "HOME": str(BASE / "home"), "XDG_CONFIG_HOME": str(BASE / "home/.config"),
       "XDG_STATE_HOME": str(BASE / "home/.local/state"), "AMARCHY_HOST_URL": f"http://10.0.2.2:{PORT}",
       "AMARCHY_HOST_NAME": "maker"}
(BASE / "home").mkdir()
r = subprocess.run([sys.executable, str(BIN), "machines", "cloud", "user-data", NAME], env=env, capture_output=True, text=True)
user_data = r.stdout
assert user_data.startswith("#cloud-config"), r.stderr
settings = {"AMARCHY_NAME": NAME, "AMARCHY_USER": USER, "AMARCHY_REPO": f"http://10.0.2.2:{PORT}/amarchy.git",
            "AMARCHY_BRANCH": "main", "AMARCHY_PROVIDER": "hetzner", "AMARCHY_BY": "maker", "GIT_NAME": "Cloud Test",
            "GIT_EMAIL": "cloud@example.com", "APP_USERS": "tester@example.com", "TS_AUTH_KEY": "tskey-auth-kVM-0123456789",
            "REPORT_URL": f"http://10.0.2.2:{PORT}", "REPORT_TOKEN": REPORT_TOKEN, "SWAP_GB": "2"}
lines = "".join(f"      {k}='{v}'\n" for k, v in settings.items())
start = user_data.index("    content: |\n") + len("    content: |\n")
end = user_data.index("  - path: /var/lib/amarchy-cloud/bootstrap.sh")
user_data = user_data[:start] + lines + user_data[end:]

TAILSCALE = r'''#!/bin/bash
# The tests' stand-in for Tailscale (test/cloud-vm.py): answers as a node
# signed in to a tailnet with HTTPS certificates, does nothing else.
case "$1" in
  status)
    cat <<'JSON'
{"BackendState": "Running", "Self": {"ID": "n1", "HostName": "cloudvm", "DNSName": "cloudvm.tail0000.ts.net.", "OS": "linux",
 "Online": true, "UserID": 1, "TailscaleIPs": ["100.64.0.42"]},
 "User": {"1": {"ID": 1, "LoginName": "tester@example.com", "DisplayName": "Tester"}},
 "CertDomains": ["cloudvm.tail0000.ts.net"], "MagicDNSSuffix": "tail0000.ts.net", "Peer": {}}
JSON
    ;;
  serve) [ "$2" = status ] && echo '{}' ;;
  *) echo "tailscale (test): $*" >>/var/log/fake-tailscale.log ;;
esac
exit 0
'''
OVERRIDES = '''# The tests' own (test/cloud-vm.py): Tailscale stood in for; never on a real machine.
install_tailscale() {
  install -m 755 /var/lib/amarchy-cloud/fake-tailscale /usr/local/bin/tailscale
  ip link show tailscale0 >/dev/null 2>&1 || ip link add tailscale0 type dummy 2>/dev/null || true
}
join_tailnet() {
  [ -n "${TS_AUTH_KEY:-}" ] && echo "joined (test) with ${TS_AUTH_KEY%%-0*}…"
}
'''
VERIFY = r'''#!/bin/bash
# The tests' check from inside (test/cloud-vm.py), after bootstrap.sh: facts, as JSON, to the test.
u=ja
uid=$(id -u $u)
as() { runuser -u $u -- env HOME=/home/$u XDG_RUNTIME_DIR=/run/user/$uid PATH=/home/$u/.local/bin:/usr/bin:/bin bash -c "$1"; }
j() { python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'; }
{
echo '{'
echo '"status":' "$(cat /var/lib/amarchy-cloud/status 2>/dev/null | j)",
echo '"settings_left":' "$( [ -e /var/lib/amarchy-cloud/settings ] && echo true || echo false )",
echo '"userdata_left":' "$(ls /var/lib/cloud/instances/*/user-data.txt 2>/dev/null | wc -l)",
echo '"key_in_logs":' "$(grep -rl 'kVM-0123456789' /var/log /var/lib/amarchy-cloud /home/$u 2>/dev/null | head -3 | tr '\n' ' ' | j)",
echo '"tmux":' "$(tmux -V | j)",
echo '"claude":' "$(as 'claude --version' 2>&1 | j)",
echo '"git_name":' "$(as 'git config --global user.name' | j)",
echo '"sudo":' "$(as 'sudo -n true && echo yes' 2>&1 | j)",
echo '"linger":' "$(loginctl show-user $u -p Linger | j)",
echo '"swap":' "$(swapon --show --noheadings | j)",
echo '"ufw":' "$(ufw status verbose | j)",
echo '"sshd":' "$(systemctl is-active ssh.service ssh.socket 2>&1 | tr '\n' ' ' | j)",
echo '"listening":' "$(ss -tlnH | awk '{print $4}' | sort -u | tr '\n' ' ' | j)",
echo '"app":' "$(as 'amarchy app --status' 2>&1 | j)",
echo '"hello":' "$(as 'curl -sS http://127.0.0.1:7397/api/peer/hello' 2>&1 | j)",
echo '"icon":' "$(cat /home/$u/.config/amarchy/icon 2>/dev/null | j)",
echo '"cloud_self":' "$(cat /home/$u/.config/amarchy/cloud-self.json 2>/dev/null | j)",
echo '"timers":' "$(as 'systemctl --user list-timers --no-legend amarchy-*' 2>&1 | j)",
echo '"upgrades":' "$(cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null | j)",
echo '"hostname":' "$(hostname | j)",
echo '"log_tail":' "$(tail -n 30 /var/log/amarchy-cloud.log | j)"
echo '}'
} >/var/lib/amarchy-cloud/verify.json 2>/dev/null
curl -sS --max-time 20 -H 'Content-Type: application/json' --data-binary @/var/lib/amarchy-cloud/verify.json "http://10.0.2.2:__PORT__/verify" || true
'''.replace("__PORT__", str(PORT))
extra = "".join(f"  - path: {path}\n    owner: root:root\n    permissions: \"{mode}\"\n    encoding: b64\n    content: {base64.b64encode(body.encode()).decode()}\n"
                for path, mode, body in (("/var/lib/amarchy-cloud/overrides.sh", "0600", OVERRIDES),
                                         ("/var/lib/amarchy-cloud/fake-tailscale", "0755", TAILSCALE),
                                         ("/var/lib/amarchy-cloud/verify.sh", "0700", VERIFY)))
user_data = user_data.replace("runcmd:\n", extra + "runcmd:\n", 1)
user_data = user_data.replace("  - [/var/lib/amarchy-cloud/bootstrap.sh]\n",
                              "  - [/var/lib/amarchy-cloud/bootstrap.sh]\n  - [/var/lib/amarchy-cloud/verify.sh]\n", 1)
(BASE / "srv/user-data").write_text(user_data)
(BASE / "srv/meta-data").write_text(f"instance-id: amarchy-test-{os.getpid()}\nlocal-hostname: {NAME}\n")
(BASE / "srv/vendor-data").write_text("")
if shutil.which("cloud-init"):
    r = subprocess.run(["cloud-init", "schema", "--config-file", str(BASE / "srv/user-data")], capture_output=True, text=True)
    check(r.returncode == 0, "cloud-init's own schema takes the user data")

# ---- the test's server: the user data (NoCloud), the repository, and the reports

verify = {}


class Serve(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(BASE / "srv"), **k)

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n)
        if self.path == "/api/cloud/progress":
            ok = self.headers.get("Authorization") == f"Bearer {REPORT_TOKEN}"
            d = json.loads(body or b"{}")
            reports.append({**d, "ok_token": ok, "at": time.time()})
            print(f"  … report: {d.get('step')}: {d.get('words')}", flush=True)
            self.send_response(200 if ok else 403)
        elif self.path == "/verify":
            try:
                verify.update(json.loads(body))
            except ValueError as e:
                verify["error"] = f"{e}: {body[:300]!r}"
            self.send_response(200)
        else:
            self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()


server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Serve)
threading.Thread(target=server.serve_forever, daemon=True).start()

# ---- the VM

disk = BASE / "disk.qcow2"
subprocess.run(["qemu-img", "create", "-q", "-f", "qcow2", "-b", str(image), "-F", "qcow2", str(disk), "20G"], check=True)
kvm = os.access("/dev/kvm", os.W_OK)
argv = ["qemu-system-x86_64", "-m", "4096", "-smp", "4", *(["-enable-kvm", "-cpu", "host"] if kvm else ["-accel", "tcg,thread=multi", "-cpu", "max"]),
        "-drive", f"file={disk},if=virtio", "-netdev", "user,id=n0", "-device", "virtio-net-pci,netdev=n0",
        "-smbios", f"type=1,serial=ds=nocloud;s=http://10.0.2.2:{PORT}/", "-display", "none",
        "-serial", f"file:{BASE / 'console.log'}", "-monitor", "none"]
print(f"booting Debian 13 ({'KVM' if kvm else 'emulated: slow'}); its console: {BASE / 'console.log'}", flush=True)
vm = subprocess.Popen(argv, stdout=subprocess.DEVNULL, stderr=open(BASE / "qemu.log", "w"))
began = time.time()
try:
    while time.time() - began < opts.limit:
        if verify or any(r.get("step") == "failed" for r in reports) or vm.poll() is not None:
            break
        time.sleep(5)
    took = time.time() - began
    print(f"after {took / 60:.1f} minutes", flush=True)
    steps = [r.get("step") for r in reports]
    check(vm.poll() is None, "the VM ran all along")
    check(all(r["ok_token"] for r in reports) and bool(reports), "every report came with its token")
    check(steps == ["tailnet", "packages", "claude", "amarchy", "app", "ready"],
          f"its reports, in order: {steps}" + (f" ({reports[-1].get('words')}; {reports[-1].get('log', '')[-1500:]})" if steps and steps[-1] == "failed" else ""))
    if verify:
        v = verify
        check(v.get("status", "").startswith("ready"), f"bootstrap.sh says ready ({v.get('status', '').strip()})")
        check(v.get("settings_left") is False and v.get("userdata_left") == 0, "its settings and cloud-init's copy of them are gone")
        check(not v.get("key_in_logs", "").strip(), f"the Tailscale key isn't in any log or file ({v.get('key_in_logs')})")
        tv = v.get("tmux", "").split()
        check(len(tv) == 2 and tuple(int(x) for x in tv[1].rstrip("abcdefgh").split(".")[:2]) >= (3, 5), f"tmux 3.5 or newer ({v.get('tmux', '').strip()})")
        check("Claude Code" in v.get("claude", ""), f"Claude Code installed by its installer ({v.get('claude', '').strip()})")
        check(v.get("git_name", "").strip() == "Cloud Test", "your git name there")
        check(v.get("sudo", "").strip() == "yes", "your user has sudo")
        check("Linger=yes" in v.get("linger", ""), "your user lingers (its services run with nobody logged in)")
        check("/swapfile" in v.get("swap", ""), "a swap file")
        ufw = v.get("ufw", "")
        check("Status: active" in ufw and "deny (incoming)" in ufw and "tailscale0" in ufw and "41641/udp" in ufw,
              "the firewall: nothing in but the tailnet and Tailscale's port")
        check("active" not in v.get("sshd", "").replace("inactive", ""), f"sshd off ({v.get('sshd', '').strip()})")
        listening = v.get("listening", "").split()
        public = [a for a in listening if not a.startswith(("127.", "[::1]", "127.0.0.53", "127.0.0.54"))]
        check(not public, f"nothing listens beyond this machine itself ({listening})")
        try:
            hello = json.loads(v.get("hello") or "{}")
        except ValueError:
            hello = {}
        check(hello.get("name") == NAME and hello.get("protocol") == 1 and hello.get("icon") == "cloud"
              and (hello.get("cloud") or {}).get("by") == "maker" and hello.get("user") == "tester@example.com",
              f"its amarchy answers as {NAME}, a cloud machine made by maker, yours ({v.get('hello', '')[:300]})")
        check(hello.get("claude") == "out", "its Claude isn't signed in yet (the app's Sign in to Claude)")
        check("on" in v.get("app", "") and "cloudvm.tail0000.ts.net" in v.get("app", ""), f"its app on, on the tailnet ({v.get('app', '').strip()})")
        check("amarchy-update.timer" in v.get("timers", "") and "amarchy-sleep.timer" in v.get("timers", ""),
              "amarchy keeps itself up to date there (its timers)")
        check('Unattended-Upgrade "1"' in v.get("upgrades", ""), "security upgrades by themselves")
        check(v.get("hostname", "").strip() == NAME, "its hostname")
    else:
        check(False, "its check from inside came")
finally:
    vm.terminate()
    try:
        vm.wait(30)
    except subprocess.TimeoutExpired:
        vm.kill()
    server.shutdown()
    print(f"\nconsole: {BASE / 'console.log'}" if failed or opts.keep else "")
    if not failed and not opts.keep:
        shutil.rmtree(BASE, ignore_errors=True)

print(f"\n{'all passed' if not failed else f'{len(failed)} failed: ' + '; '.join(failed)}")
sys.exit(1 if failed else 0)
