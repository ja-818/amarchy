# Fake cloud APIs for the cloud machine's tests (docs/plan-omarchy-and-
# machines.md, track F): Hetzner Cloud, DigitalOcean and Hostinger VPS, each
# answering with its real request and response shapes (from their OpenAPI
# specs: docs.hetzner.cloud/cloud.spec.json, DigitalOcean-public.v2.yaml,
# developers.hostinger.com/openapi/openapi.json), its real errors and its
# pagination, in memory; and a fake VM behind each machine made: it starts
# (initializing → running), reads the settings its setup carries (the report
# URL and token, as cloud/bootstrap.sh does) and reports its steps to the
# machine that made it, puts itself on a fake tailnet (a `tailscale status
# --json` file), and leaves it again when deleted.
#
#   python3 test/cloud_fakes.py --port <p> --tailnet <status.json> [--slow <s>]
#
# One server for the three, by path: /hetzner/v1/..., /digitalocean/v2/...,
# /hostinger/api/... (AMARCHY_CLOUD_API_HETZNER=http://127.0.0.1:<p>/hetzner/v1
# and so on). Tokens: "good-<provider>" is taken, "read-only" can only read,
# anything else is refused. GET /_fake/state says what it made, deleted,
# was sent; POST /_fake/vm {name, fail: <step>} makes a VM's setup fail there.

import argparse, base64, gzip, http.server, json, re, shlex, ssl, threading, time, urllib.request
from pathlib import Path

LOCK = threading.Lock()
STATE = {"hetzner": {}, "digitalocean": {}, "hostinger": {}, "scripts": {}, "subscriptions": {}, "log": [], "fail": {},
         "next": 1000}
OPTS = None


def nid():
    STATE["next"] += 1
    return STATE["next"]


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# ---- the catalogs: what each provider sells (the specs' shapes, real names)

HZ_LOCATIONS = [
    {"id": 1, "name": "fsn1", "description": "Falkenstein DC Park 1", "country": "DE", "city": "Falkenstein",
     "latitude": 50.47612, "longitude": 12.370071, "network_zone": "eu-central"},
    {"id": 2, "name": "nbg1", "description": "Nuremberg DC Park 1", "country": "DE", "city": "Nuremberg",
     "latitude": 49.452102, "longitude": 11.076665, "network_zone": "eu-central"},
    {"id": 3, "name": "hel1", "description": "Helsinki DC Park 1", "country": "FI", "city": "Helsinki",
     "latitude": 60.169855, "longitude": 24.938379, "network_zone": "eu-central"},
    {"id": 4, "name": "ash", "description": "Ashburn, VA", "country": "US", "city": "Ashburn, VA",
     "latitude": 39.045821, "longitude": -77.487073, "network_zone": "us-east"},
]


def hz_type(i, name, cores, mem, disk, monthly, arch="x86", cpu="shared", where=("fsn1", "nbg1", "hel1", "ash"), deprecated=False):
    gross = lambda v: {"net": f"{v / 1.19:.4f}", "gross": f"{v:.4f}"}
    return {"id": i, "name": name, "description": name.upper(), "cores": cores, "memory": mem, "disk": disk,
            "prices": [{"location": loc, "price_hourly": gross(monthly / 730), "price_monthly": gross(monthly),
                        "included_traffic": 21990232555520, "price_per_tb_traffic": gross(1.19)} for loc in where],
            "storage_type": "local", "cpu_type": cpu, "category": "Cost-Optimized" if name.startswith("cx") else "Regular Purpose",
            "architecture": arch,
            "deprecation": {"unavailable_after": "2026-01-01T00:00:00Z", "announced": "2025-10-16T00:00:00Z"} if deprecated else None,
            "locations": [{"id": n + 1, "name": loc, "deprecation": None, "recommended": loc == "fsn1", "available": True}
                          for n, loc in enumerate(where)]}


HZ_TYPES = [hz_type(114, "cx23", 2, 4, 40, 3.49), hz_type(115, "cx33", 4, 8, 80, 5.49), hz_type(116, "cx43", 8, 16, 160, 9.49),
            hz_type(117, "cx53", 16, 32, 320, 17.49), hz_type(45, "cax21", 4, 8, 80, 6.49, arch="arm", where=("fsn1", "nbg1", "hel1")),
            hz_type(110, "cpx32", 4, 8, 160, 13.99), hz_type(104, "cx22", 2, 4, 40, 3.79, deprecated=True),
            hz_type(1, "cx11", 1, 1, 20, 3.29)]
HZ_IMAGES = [
    {"id": 161547269, "type": "system", "status": "available", "name": "ubuntu-24.04", "description": "Ubuntu 24.04",
     "image_size": None, "disk_size": 5, "created": "2024-04-25T12:00:00Z", "created_from": None, "bound_to": None,
     "os_flavor": "ubuntu", "os_version": "24.04", "rapid_deploy": True, "protection": {"delete": False}, "deprecation": None,
     "deleted": None, "labels": {}, "architecture": "x86"},
    {"id": 310557660, "type": "system", "status": "available", "name": "debian-13", "description": "Debian 13",
     "image_size": None, "disk_size": 5, "created": "2025-08-11T12:00:00Z", "created_from": None, "bound_to": None,
     "os_flavor": "debian", "os_version": "13", "rapid_deploy": True, "protection": {"delete": False}, "deprecation": None,
     "deleted": None, "labels": {}, "architecture": "x86"},
    {"id": 310557661, "type": "system", "status": "available", "name": "debian-13", "description": "Debian 13",
     "image_size": None, "disk_size": 5, "created": "2025-08-11T12:00:00Z", "created_from": None, "bound_to": None,
     "os_flavor": "debian", "os_version": "13", "rapid_deploy": True, "protection": {"delete": False}, "deprecation": None,
     "deleted": None, "labels": {}, "architecture": "arm"},
]

DO_REGIONS = [{"name": n, "slug": s, "features": ["backups", "ipv6", "metadata", "install_agent", "storage", "image_transfer"],
               "available": a, "sizes": ["s-2vcpu-4gb", "s-4vcpu-8gb", "s-8vcpu-16gb"]}
              for n, s, a in (("New York 3", "nyc3", True), ("Frankfurt 1", "fra1", True), ("San Francisco 1", "sfo1", False))]


def do_size(slug, mem_mb, vcpus, disk, price, desc="Basic", regions=("nyc3", "fra1"), gpu=False):
    out = {"slug": slug, "memory": mem_mb, "vcpus": vcpus, "disk": disk, "transfer": 4.0, "price_monthly": price,
           "price_hourly": round(price / 672, 5), "regions": list(regions), "available": True, "description": desc,
           "disk_info": [{"type": "local", "size": {"amount": disk, "unit": "gib"}}]}
    if gpu:
        out["gpu_info"] = {"count": 1, "vram": {"amount": 80, "unit": "gib"}, "model": "nvidia_h100"}
    return out


DO_SIZES = [do_size("s-1vcpu-1gb", 1024, 1, 25, 6), do_size("s-2vcpu-4gb", 4096, 2, 80, 24),
            do_size("s-4vcpu-8gb", 8192, 4, 160, 48), do_size("g-2vcpu-8gb", 8192, 2, 25, 63, "General Purpose"),
            do_size("s-8vcpu-16gb", 16384, 8, 320, 96), do_size("gpu-h100x1-80gb", 245760, 20, 720, 2500, "GPU", gpu=True)]
DO_IMAGES = [{"id": 1, "name": n, "distribution": d, "slug": s, "public": True, "regions": ["nyc3", "fra1"],
              "created_at": "2025-09-01T00:00:00Z", "type": "base", "min_disk_size": 15, "size_gigabytes": 1.5,
              "description": n, "tags": [], "status": "available", "error_message": ""}
             for n, d, s in (("24.04 (LTS) x64", "Ubuntu", "ubuntu-24-04-x64"), ("13 x64", "Debian", "debian-13-x64"))]

HG_DCS = [{"id": 17, "name": "lt", "location": "lt", "city": "Vilnius", "continent": "Europe"},
          {"id": 29, "name": "phx", "location": "us", "city": "Phoenix", "continent": "North America"}]
HG_CATALOG = [{"id": f"hostingercom-vps-kvm{n}", "name": f"KVM {n}", "category": "VPS", "metadata": None,
               "prices": [{"id": f"hostingercom-vps-kvm{n}-usd-1m", "name": f"KVM {n} (billed every month)", "currency": "USD",
                           "price": p, "first_period_price": f, "period": 1, "period_unit": "month"},
                          {"id": f"hostingercom-vps-kvm{n}-usd-12m", "name": f"KVM {n} (billed every 12 months)",
                           "currency": "USD", "price": p * 10, "first_period_price": f * 10, "period": 12, "period_unit": "month"}]}
              for n, p, f in ((1, 1099, 649), (2, 1499, 899), (4, 2599, 1299), (8, 4599, 2599))]
HG_TEMPLATES = [{"id": 1002, "name": "Ubuntu 24.04 LTS", "description": "Ubuntu 24.04 LTS", "documentation": None},
                {"id": 1077, "name": "Debian 13 with CloudPanel", "description": "Debian 13 with CloudPanel", "documentation": None},
                {"id": 1070, "name": "Debian 13", "description": "Debian 13", "documentation": None}]
HG_PAYMENT = [{"id": 6523, "name": "Credit Card", "identifier": "4242*****4242", "payment_method": "card",
               "is_default": True, "is_expired": False, "is_suspended": False, "created_at": "2025-01-01T00:00:00Z",
               "expires_at": "2030-01-01T00:00:00Z", "suspended_at": None}]


# ---- the fake VM behind each machine made

def settings_of(setup):
    """The settings its setup carries (as bootstrap.sh reads them), from
    cloud-init's user data or Hostinger's script."""
    out = {}
    block = re.search(r"content: \|\n((?:      .*\n)+)", setup)
    lines = [l[6:] for l in block.group(1).splitlines()] if block else \
        (re.search(r"<<'AMARCHY_SETTINGS'\n(.*?)\nAMARCHY_SETTINGS", setup, re.S) or [None, ""])[1].splitlines()
    for line in lines:
        k, eq, v = line.partition("=")
        if eq:
            out[k] = shlex.split(v)[0] if v else ""
    return out


def tailnet(change):
    """The fake tailnet's status file, changed under a lock."""
    with LOCK:
        f = Path(OPTS.tailnet)
        try:
            st = json.loads(f.read_text())
        except (OSError, ValueError):
            st = {"BackendState": "Running", "Peer": {}}
        change(st)
        f.write_text(json.dumps(st, indent=1))


def report(s, step, words, log=""):
    if not s.get("REPORT_URL"):
        return
    body = json.dumps({"name": s["AMARCHY_NAME"], "step": step, "words": words, "log": log}).encode()
    req = urllib.request.Request(s["REPORT_URL"].rstrip("/") + "/api/cloud/progress", data=body, method="POST",
                                 headers={"Authorization": f"Bearer {s.get('REPORT_TOKEN', '')}",
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5, context=ssl.create_default_context()) as r:
            STATE["log"].append({"report": step, "status": r.status})
    except Exception as e:      # (as bootstrap.sh: a report never stops it)
        STATE["log"].append({"report": step, "error": str(e)[:200]})


def vm_life(provider, vid, setup):
    """What a real one does once made: it starts, joins the tailnet (its
    node, named for it), reports each step of its setup, and is ready."""
    s = settings_of(setup)
    name = s.get("AMARCHY_NAME") or "cloud"
    slow = OPTS.slow
    fail = lambda step: STATE["fail"].get(name) == step
    time.sleep(slow)

    def running():
        vm = STATE[provider].get(vid)
        if not vm:
            return False
        if provider == "hetzner":
            vm["status"] = "running"
        elif provider == "digitalocean":
            vm["status"] = "active"
            vm["networks"]["v4"] = [{"ip_address": "203.0.113.20", "netmask": "255.255.240.0", "gateway": "203.0.113.1", "type": "public"}]
        else:
            vm["state"] = "running"
        return True
    if not running():
        return
    time.sleep(slow)
    if fail("tailnet") or not s.get("TS_AUTH_KEY"):
        return      # it never joins (a key used already): it can't say so
    tailnet(lambda st: st.setdefault("Peer", {}).update({f"nodekey:{name}": {
        "ID": f"n{vid}", "HostName": name, "DNSName": f"{name}.tail0000.ts.net.", "OS": "linux", "Online": True,
        "UserID": 1, "TailscaleIPs": ["100.64.0.42"], "Created": now_iso()}}))
    report(s, "tailnet", "On your tailnet")
    for step, words in (("packages", "Installing git, tmux, python3"), ("claude", "Installing Claude Code"),
                        ("amarchy", "Installing amarchy"), ("app", "Turning its app on")):
        time.sleep(slow / 2)
        if fail(step):
            report(s, "failed", f"{words} failed (retry install_claude)",
                   "== claude: Claude Code\ncurl: (6) Could not resolve host: claude.ai\n  (failed, try 5 of 5)")
            return
        report(s, step, words)
    time.sleep(slow / 2)
    report(s, "ready", f"amarchy is up: pairing with {s.get('AMARCHY_BY')}")


def vm_gone(name):
    tailnet(lambda st: st.get("Peer", {}).pop(f"nodekey:{name}", None))


# ---- the server

class Fake(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, status, body=None, headers=None):
        raw = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if body is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return None

    def token(self, provider):
        t = (self.headers.get("Authorization") or "")[7:]
        return "good" if t == f"good-{provider}" else "read" if t == "read-only" else None

    def route(self, method):
        path, _, query = self.path.partition("?")
        q = {k: v[-1] for k, v in __import__("urllib.parse").parse.parse_qs(query).items()}
        if path == "/_fake/state":
            with LOCK:
                return self.reply(200, {k: STATE[k] for k in ("hetzner", "digitalocean", "hostinger", "scripts", "subscriptions", "log")})
        if path == "/_fake/vm" and method == "POST":
            d = self.body() or {}
            STATE["fail"][d.get("name")] = d.get("fail")
            return self.reply(200, {})
        for provider in ("hetzner", "digitalocean", "hostinger"):
            if path.startswith(f"/{provider}/"):
                STATE["log"].append({"provider": provider, "method": method, "path": path, "query": q})
                return getattr(self, provider)(method, path[len(provider) + 1:], q)
        self.reply(404, {"error": "no such fake"})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")

    # -- Hetzner Cloud (https://api.hetzner.cloud/v1)

    def hz_error(self, status, code, message, details=None):
        self.reply(status, {"error": {"code": code, "message": message, "details": details or {}}})

    def hz_page(self, key, items, q):
        page, per = max(1, int(q.get("page") or 1)), min(50, int(q.get("per_page") or 25))
        last = max(1, (len(items) + per - 1) // per)
        self.reply(200, {key: items[(page - 1) * per: page * per], "meta": {"pagination": {
            "page": page, "per_page": per, "previous_page": page - 1 if page > 1 else None,
            "next_page": page + 1 if page < last else None, "last_page": last, "total_entries": len(items)}}})

    def hetzner(self, method, path, q):
        who = self.token("hetzner")
        if not who:
            return self.hz_error(401, "unauthorized", "unable to authenticate")
        if path == "/v1/locations":
            return self.hz_page("locations", HZ_LOCATIONS, q)
        if path == "/v1/server_types":
            return self.hz_page("server_types", HZ_TYPES, q)
        if path == "/v1/pricing":
            gross = lambda v: {"net": f"{v / 1.19:.4f}", "gross": f"{v:.4f}"}
            return self.reply(200, {"pricing": {
                "currency": "EUR", "vat_rate": "19.00",
                "primary_ips": [{"type": "ipv4", "prices": [{"location": l["name"], "price_hourly": gross(0.0008),
                                                             "price_monthly": gross(0.5)} for l in HZ_LOCATIONS]},
                                {"type": "ipv6", "prices": [{"location": l["name"], "price_hourly": gross(0),
                                                             "price_monthly": gross(0)} for l in HZ_LOCATIONS]}],
                "floating_ips": [], "image": {"price_per_gb_month": gross(0.0119)}, "volume": {"price_per_gb_month": gross(0.0524)},
                "server_backup": {"percentage": "20.00"},
                "server_types": [{"id": t["id"], "name": t["name"], "prices": t["prices"]} for t in HZ_TYPES],
                "load_balancer_types": []}})
        if path == "/v1/images":
            items = [i for i in HZ_IMAGES if (not q.get("architecture") or i["architecture"] == q["architecture"])
                     and (not q.get("type") or i["type"] == q["type"])]
            return self.hz_page("images", items, q)
        if path == "/v1/servers" and method == "GET":
            items = list(STATE["hetzner"].values())
            if q.get("name"):
                items = [s for s in items if s["name"] == q["name"]]
            if q.get("label_selector"):
                k, _, v = q["label_selector"].partition("=")
                items = [s for s in items if (s["labels"].get(k) == v if v else k in s["labels"])]
            return self.hz_page("servers", items, q)
        if path == "/v1/servers" and method == "POST":
            if who == "read":
                return self.hz_error(403, "forbidden", "insufficient permissions for this request")
            d = self.body()
            if d is None:
                return self.hz_error(400, "json_error", "invalid JSON input in your request")
            for f in ("name", "server_type", "image"):
                if not d.get(f):
                    return self.hz_error(422, "invalid_input", f"invalid input in field '{f}'",
                                         {"fields": [{"name": f, "messages": ["is required"]}]})
            if len((d.get("user_data") or "").encode()) > 32 * 1024:
                return self.hz_error(422, "invalid_input", "invalid input in field 'user_data': is too long")
            if any(s["name"] == d["name"] for s in STATE["hetzner"].values()):
                return self.hz_error(409, "uniqueness_error", "server name is already used", {"fields": [{"name": "name"}]})
            t = next((x for x in HZ_TYPES if x["name"] == d["server_type"]), None)
            if not t or t.get("deprecation"):
                return self.hz_error(412 if t else 422, "resource_unavailable" if t else "invalid_input",
                                     "server type unavailable" if t else "server type not found")
            if d["server_type"] == "cx53":
                return self.hz_error(403, "resource_limit_exceeded", "server limit exceeded",
                                     {"limits": [{"name": "server_limit"}]})
            loc = next(l for l in HZ_LOCATIONS if l["name"] == (d.get("location") or "fsn1"))
            img = next((i for i in HZ_IMAGES if i["name"] == d["image"] and i["architecture"] == t["architecture"]), None)
            if not img:
                return self.hz_error(422, "invalid_input", "image not found")
            vid = nid()
            srv = {"id": vid, "name": d["name"], "status": "initializing", "created": now_iso(),
                   "public_net": {"ipv4": {"id": vid + 1, "ip": "203.0.113.10", "blocked": False, "dns_ptr": f"static.{vid}.example"},
                                  "ipv6": {"id": vid + 2, "ip": "2001:db8::/64", "blocked": False, "dns_ptr": []},
                                  "floating_ips": [], "firewalls": []},
                   "private_net": [], "server_type": t, "location": loc, "image": img, "iso": None, "rescue_enabled": False,
                   "locked": False, "backup_window": None, "outgoing_traffic": 0, "ingoing_traffic": 0,
                   "included_traffic": 21990232555520, "protection": {"delete": False, "rebuild": False},
                   "labels": d.get("labels") or {}, "volumes": [], "load_balancers": [], "primary_disk_size": t["disk"],
                   "placement_group": None, "user_data": d.get("user_data") or ""}
            STATE["hetzner"][vid] = srv
            threading.Thread(target=vm_life, args=("hetzner", vid, srv["user_data"]), daemon=True).start()
            shown = {k: v for k, v in srv.items() if k != "user_data"}
            return self.reply(201, {"server": shown, "action": {
                "id": nid(), "command": "create_server", "status": "running", "started": now_iso(), "finished": None,
                "progress": 0, "resources": [{"id": vid, "type": "server"}], "error": None},
                "next_actions": [{"id": nid(), "command": "start_server", "status": "running", "started": now_iso(),
                                  "finished": None, "progress": 0, "resources": [{"id": vid, "type": "server"}], "error": None}],
                "root_password": "YItygq1v3GYjjMomLaKc"})
        m = re.fullmatch(r"/v1/servers/(\d+)", path)
        if m:
            srv = STATE["hetzner"].get(int(m.group(1)))
            if not srv:
                return self.hz_error(404, "not_found", "server with ID not found")
            if method == "DELETE":
                if who == "read":
                    return self.hz_error(403, "forbidden", "insufficient permissions for this request")
                del STATE["hetzner"][srv["id"]]
                vm_gone(srv["name"])
                return self.reply(200, {"action": {"id": nid(), "command": "delete_server", "status": "running",
                                                   "started": now_iso(), "finished": None, "progress": 0,
                                                   "resources": [{"id": srv["id"], "type": "server"}], "error": None}})
            return self.reply(200, {"server": {k: v for k, v in srv.items() if k != "user_data"}})
        self.hz_error(404, "not_found", "not found")

    # -- DigitalOcean (https://api.digitalocean.com/v2)

    def do_error(self, status, ident, message):
        self.reply(status, {"id": ident, "message": message, "request_id": "4d9d8375-3c56-4925-a3e7-eb137fed17e9"})

    def do_page(self, key, items, q):
        page, per = max(1, int(q.get("page") or 1)), min(200, int(q.get("per_page") or 20))
        last = max(1, (len(items) + per - 1) // per)
        pages = {}
        base = f"https://api.digitalocean.com{self.path.split('?')[0].replace('/digitalocean', '')}"
        if page < last:
            pages.update(next=f"{base}?page={page + 1}&per_page={per}", last=f"{base}?page={last}&per_page={per}")
        if page > 1:
            pages.update(first=f"{base}?page=1&per_page={per}", prev=f"{base}?page={page - 1}&per_page={per}")
        self.reply(200, {key: items[(page - 1) * per: page * per], "links": {"pages": pages}, "meta": {"total": len(items)}})

    def digitalocean(self, method, path, q):
        who = self.token("digitalocean")
        if not who:
            return self.do_error(401, "unauthorized", "Unable to authenticate you.")
        if path == "/v2/account":
            return self.reply(200, {"account": {"droplet_limit": 25, "floating_ip_limit": 5, "email": "sammy@example.com",
                                                "name": "Sammy", "uuid": "b6fr89dbf6d9156cace5f3c78dc9851d957381ef",
                                                "email_verified": True, "status": "active", "status_message": " ",
                                                "team": {"uuid": "5df3e3004a17e242b7c20ca6c9fc25b701a47ece", "name": "My Team"}}})
        if path == "/v2/regions":
            return self.do_page("regions", DO_REGIONS, q)
        if path == "/v2/sizes":
            return self.do_page("sizes", DO_SIZES, q)
        if path == "/v2/images":
            return self.do_page("images", [i for i in DO_IMAGES if not q.get("type") or q["type"] == "distribution"], q)
        if path == "/v2/droplets" and method == "GET":
            items = list(STATE["digitalocean"].values())
            if q.get("tag_name"):
                items = [d for d in items if q["tag_name"] in d["tags"]]
            if q.get("name"):
                items = [d for d in items if d["name"].lower() == q["name"].lower()]
            return self.do_page("droplets", items, q)
        if path == "/v2/droplets" and method == "POST":
            if who == "read":
                return self.do_error(403, "forbidden", "You do not have access for the attempted action.")
            d = self.body()
            if d is None:
                return self.do_error(400, "bad_request", "error parsing request body")
            if not d.get("name") or not d.get("size") or not d.get("image"):
                return self.do_error(422, "unprocessable_entity", "request payload validation failed")
            if len((d.get("user_data") or "").encode()) > 64 * 1024:
                return self.do_error(422, "unprocessable_entity", "user_data may not exceed 64 KiB")
            if d["size"] == "s-8vcpu-16gb":
                return self.do_error(422, "unprocessable_entity", "creating this/these droplet(s) will exceed your droplet limit")
            size = next(s for s in DO_SIZES if s["slug"] == d["size"])
            region = next(r for r in DO_REGIONS if r["slug"] == d.get("region"))
            vid = nid()
            drop = {"id": vid, "name": d["name"], "memory": size["memory"], "vcpus": size["vcpus"], "disk": size["disk"],
                    "locked": False, "status": "new", "kernel": None, "created_at": now_iso(), "features": ["ipv6"],
                    "backup_ids": [], "next_backup_window": None, "snapshot_ids": [],
                    "image": next(i for i in DO_IMAGES if i["slug"] == d["image"]), "volume_ids": [], "size": size,
                    "size_slug": d["size"], "networks": {"v4": [], "v6": []}, "region": region, "tags": d.get("tags") or [],
                    "vpc_uuid": "760e09ef-dc84-11e8-981e-3cfdfeaae000", "user_data": d.get("user_data") or ""}
            STATE["digitalocean"][vid] = drop
            threading.Thread(target=vm_life, args=("digitalocean", vid, drop["user_data"]), daemon=True).start()
            return self.reply(202, {"droplet": {k: v for k, v in drop.items() if k != "user_data"},
                                    "links": {"actions": [{"id": nid(), "rel": "create",
                                                           "href": f"https://api.digitalocean.com/v2/actions/{vid}"}]}})
        m = re.fullmatch(r"/v2/droplets/(\d+)", path)
        if m:
            drop = STATE["digitalocean"].get(int(m.group(1)))
            if not drop:
                return self.do_error(404, "not_found", "The resource you requested could not be found.")
            if method == "DELETE":
                del STATE["digitalocean"][drop["id"]]
                vm_gone(drop["name"])
                return self.reply(204)
            return self.reply(200, {"droplet": {k: v for k, v in drop.items() if k != "user_data"}})
        self.do_error(404, "not_found", "The resource you requested could not be found.")

    # -- Hostinger (https://developers.hostinger.com)

    def hg_error(self, status, message, errors=None):
        self.reply(status, {"message": message, **({"errors": errors} if errors else {}),
                            "correlation_id": "26a91bd9-f8c8-4a83-9df9-83e23d696fe3"})

    def hostinger(self, method, path, q):
        who = self.token("hostinger")
        if not who:
            return self.hg_error(401, "Unauthenticated.")
        if path == "/api/vps/v1/data-centers":
            return self.reply(200, HG_DCS)
        if path == "/api/billing/v1/catalog":
            return self.reply(200, [c for c in HG_CATALOG if not q.get("category") or c["category"] == q["category"]])
        if path == "/api/billing/v1/payment-methods":
            return self.reply(200, HG_PAYMENT)
        if path == "/api/vps/v1/templates":
            return self.reply(200, HG_TEMPLATES)
        if path == "/api/vps/v1/post-install-scripts" and method == "POST":
            d = self.body() or {}
            if not d.get("name") or not d.get("content"):
                return self.hg_error(422, "The name field is required.", {"name": ["The name field is required."]})
            if len(d["content"].encode()) > 48 * 1024:
                return self.hg_error(422, "The content may not be greater than 48 kilobytes.",
                                     {"content": ["The content may not be greater than 48 kilobytes."]})
            sid = nid()
            STATE["scripts"][sid] = {"id": sid, "name": d["name"], "content": d["content"], "created_at": now_iso(),
                                     "updated_at": now_iso()}
            return self.reply(200, STATE["scripts"][sid])
        m = re.fullmatch(r"/api/vps/v1/post-install-scripts/(\d+)", path)
        if m and method == "DELETE":
            if not STATE["scripts"].pop(int(m.group(1)), None):
                return self.hg_error(404, "Resource not found")
            return self.reply(200, {"message": "Request accepted"})
        if path == "/api/vps/v1/virtual-machines" and method == "GET":
            return self.reply(200, [{k: v for k, v in vm.items() if not k.startswith("_")} for vm in STATE["hostinger"].values()])
        if path == "/api/vps/v1/virtual-machines" and method == "POST":
            d = self.body() or {}
            setup = d.get("setup") or {}
            if not d.get("item_id") or not setup.get("data_center_id") or not setup.get("template_id"):
                return self.hg_error(422, "The item id field is required.", {"item_id": ["The item id field is required."]})
            item = next((c for c in HG_CATALOG for p in c["prices"] if p["id"] == d["item_id"]), None)
            if not item:
                return self.hg_error(422, "The selected item id is invalid.", {"item_id": ["The selected item id is invalid."]})
            script = STATE["scripts"].get(setup.get("post_install_script_id"))
            vid, sub = nid(), f"Azz{nid()}Uhl1xC54pR0"
            n = int(item["name"].split()[-1])
            vm = {"id": vid, "firewall_group_id": None, "subscription_id": sub, "data_center_id": setup["data_center_id"],
                  "plan": item["name"], "hostname": f"srv{vid}.hstgr.cloud", "state": "initial" if item["name"] == "KVM 1" else "creating",
                  "actions_lock": "unlocked", "cpus": n, "memory": {1: 4, 2: 8, 4: 16, 8: 32}[n] * 1024,
                  "disk": {1: 50, 2: 100, 4: 200, 8: 400}[n] * 1024, "bandwidth": 4096000, "ns1": "1.1.1.1", "ns2": "8.8.8.8",
                  "ipv4": [{"id": vid + 1, "address": "203.0.113.30", "ptr": f"srv{vid}.hstgr.cloud"}], "ipv6": None,
                  "template": next(t for t in HG_TEMPLATES if t["id"] == setup["template_id"]), "created_at": now_iso(),
                  "_script": script["content"] if script else ""}
            STATE["hostinger"][vid] = vm
            STATE["subscriptions"][sub] = {"id": sub, "name": item["name"], "status": "active", "billing_period": 1,
                                           "billing_period_unit": "month", "currency_code": "USD",
                                           "total_price": item["prices"][0]["price"], "renewal_price": item["prices"][0]["price"],
                                           "is_auto_renewed": True, "created_at": now_iso(), "expires_at": None,
                                           "next_billing_at": "2026-12-22T00:00:00Z"}
            if vm["state"] == "initial":        # KVM 1, in the fake: the payment is still being taken (202)
                return self.reply(202, {"id": nid(), "subscription_id": sub, "status": "payment_initiated",
                                        "message": "Payment is being processed"})
            threading.Thread(target=vm_life, args=("hostinger", vid, vm["_script"]), daemon=True).start()
            order = {"id": nid(), "subscription_id": sub, "status": "completed", "currency": "USD",
                     "subtotal": item["prices"][0]["price"], "total": item["prices"][0]["price"], "billing_address": {},
                     "created_at": now_iso(), "updated_at": now_iso()}
            return self.reply(200, {"order": order, "virtual_machine": {k: v for k, v in vm.items() if not k.startswith("_")}})
        m = re.fullmatch(r"/api/vps/v1/virtual-machines/(\d+)(/setup|/stop)?", path)
        if m:
            vm = STATE["hostinger"].get(int(m.group(1)))
            if not vm:
                return self.hg_error(404, "Resource not found")
            if m.group(2) == "/setup" and method == "POST":
                d = self.body() or {}
                script = STATE["scripts"].get(d.get("post_install_script_id"))
                vm.update(state="creating", _script=script["content"] if script else "")
                threading.Thread(target=vm_life, args=("hostinger", vm["id"], vm["_script"]), daemon=True).start()
                return self.reply(200, {k: v for k, v in vm.items() if not k.startswith("_")})
            if m.group(2) == "/stop" and method == "POST":
                vm["state"] = "stopped"
                vm_gone(re.sub(r"^.*AMARCHY_NAME='([^']+)'.*$", r"\1", vm.get("_script") or "", flags=re.S))
                return self.reply(200, {"id": nid(), "name": "stop", "state": "sent", "created_at": now_iso(), "updated_at": now_iso()})
            return self.reply(200, {k: v for k, v in vm.items() if not k.startswith("_")})
        m = re.fullmatch(r"/api/billing/v1/subscriptions/([^/]+)/auto-renewal/disable", path)
        if m and method == "DELETE":
            sub = STATE["subscriptions"].get(m.group(1))
            if not sub:
                return self.hg_error(404, "Resource not found")
            sub.update(is_auto_renewed=False, status="not_renewing", expires_at="2026-12-22T00:00:00Z")
            return self.reply(200, sub)
        self.hg_error(404, "Resource not found")


def write_bins(FAKE):
    """The fakes the tests put first on PATH: claude (the chat engine's protocol,
    and its sign-in with the real prompts), gh (its device sign-in, as the real
    one asks), tailscale (status from the fake tailnet's file)."""
    FAKE = Path(FAKE)
    FAKE.mkdir(parents=True, exist_ok=True)
    (FAKE / "claude").write_text(r'''#!/usr/bin/env python3
import json, os, sys, time
home = os.environ["HOME"]
auth = os.path.join(home, ".fake-claude-auth.json")
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    try:
        d = json.load(open(auth))
    except Exception:
        d = {"loggedIn": False}
    print(json.dumps({"loggedIn": d.get("loggedIn", False), "authMethod": "claude.ai" if d.get("loggedIn") else "none",
                      "email": d.get("email"), "subscriptionType": d.get("plan")}))
    sys.exit(0)
if args[:2] == ["auth", "login"]:
    print("Opening browser to sign in…")
    print("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&response_type=code&state=xyz")
    code = input("Paste code here if prompted > ")
    if code.strip() == "good-code#state":
        json.dump({"loggedIn": True, "email": "tester@example.com", "plan": "max"}, open(auth, "w"))
        print("Login successful.")
    else:
        print("OAuth error: Invalid code")
        sys.exit(1)
    sys.exit(0)
if args[:1] == ["--version"]:
    print("2.1.321 (Claude Code)")
    sys.exit(0)
def say(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
for line in sys.stdin:
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("type") == "control_request":
        say({"type": "control_response", "response": {"subtype": "success", "request_id": o["request_id"], "response": {}}})
    elif o.get("type") == "user":
        say({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 10,
             "session_id": "c0ffee00-0000-4000-8000-000000000001", "result": "ok"})
    ''')
    (FAKE / "gh").write_text(r'''#!/usr/bin/env python3
import os, sys, time
home = os.environ["HOME"]
auth = os.path.join(home, ".fake-gh-auth")
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    if os.path.exists(auth):
        print("github.com\n  ✓ Logged in to github.com account tester (keyring)")
        sys.exit(0)
    print("You are not logged into any GitHub hosts. To log in, run: gh auth login", file=sys.stderr)
    sys.exit(1)
if args[:2] == ["auth", "login"]:
    input("? Authenticate Git with your GitHub credentials? (Y/n) ")
    print("! Failed to copy one-time code to clipboard\n  exit status 1")
    print("! First copy your one-time code: ABCD-1234")
    input("Press Enter to open https://github.com/login/device in your browser... ")
    time.sleep(2)               # (you type the code on GitHub's page)
    open(auth, "w").write("tester\n")
    print("✓ Authentication complete.")
    sys.exit(0)
if args[:2] == ["auth", "setup-git"]:
    open(os.path.join(home, ".fake-gh-setup-git"), "w").write("yes\n")
    sys.exit(0)
sys.exit(1)
    ''')
    (FAKE / "tailscale").write_text(r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args[:1] == ["status"]:
    try:
        st = json.load(open(os.environ["FAKE_TAILNET"]))
    except Exception:
        st = {"BackendState": "Running", "Peer": {}}
    st["Self"] = {"ID": "self", "HostName": os.environ.get("AMARCHY_HOST_NAME", "x"),
                  "DNSName": os.environ.get("AMARCHY_HOST_NAME", "x") + ".tail0000.ts.net.", "OS": "linux",
                  "Online": True, "UserID": 1, "TailscaleIPs": ["100.64.0.1"]}
    st["User"] = {"1": {"ID": 1, "LoginName": "tester@example.com", "DisplayName": "Tester"}}
    st["CertDomains"] = [st["Self"]["DNSName"].rstrip(".")]
    st["MagicDNSSuffix"] = "tail0000.ts.net"
    print(json.dumps(st))
    sys.exit(0)
if args[:1] == ["logout"]:
    open(os.path.join(os.environ["HOME"], ".fake-tailscale-logout"), "w").write("out\n")
    sys.exit(0)
if args[:2] == ["serve", "status"]:
    print("{}")
    sys.exit(0)
sys.exit(0)
    ''')
    for f in ("claude", "gh", "tailscale"):
        (FAKE / f).chmod(0o755)


def main():
    global OPTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int)
    ap.add_argument("--tailnet")
    ap.add_argument("--slow", type=float, default=1.0)
    ap.add_argument("--bins", help="only write the fake claude, gh and tailscale there, and exit")
    OPTS = ap.parse_args()
    if OPTS.bins:
        return write_bins(OPTS.bins)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", OPTS.port), Fake)
    server.serve_forever()


if __name__ == "__main__":
    main()
