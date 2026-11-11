#!/usr/bin/env python3
"""What sends a Mac's links out on to the browser (bin/amarchy's links_handler):
GET /<token>/<the address, in hex> answers with the address to go to; a wrong
token, something that isn't a web address, or anything else: nothing there.

    python3 test/links-out.py
"""
import http.client
import importlib.machinery
import importlib.util
import os
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
loader = importlib.machinery.SourceFileLoader("amarchy_cli", os.path.join(ROOT, "bin", "amarchy"))
spec = importlib.util.spec_from_loader("amarchy_cli", loader)
am = importlib.util.module_from_spec(spec)
loader.exec_module(am)

failures = []


def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failures.append(what)


TOKEN = "0123456789abcdef0123456789abcdef"
server = am.app_server_class()(("127.0.0.1", 0), am.links_handler(TOKEN))
threading.Thread(target=server.serve_forever, daemon=True).start()
port = server.server_address[1]


def get(path, method="GET"):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request(method, path)
    r = c.getresponse()
    r.read()
    c.close()
    return r.status, r.getheader("Location"), r.getheader("Cache-Control"), r.getheader("Referrer-Policy")


def hexed(url):
    return url.encode().hex()


for url in ("http://amarchy:3471/login", "https://example.com/sign-in?next=%2Fa&b=c#d", "HTTP://100.64.0.9:3000/"):
    status, to, cache, ref = get(f"/{TOKEN}/{hexed(url)}")
    check(status == 302 and to == url, f"{url}: sent on to it ({status} {to})")
    check(cache == "no-store" and ref == "no-referrer", "  not kept, and it isn't told where from")
status, to, _, _ = get(f"/{TOKEN}/{hexed('https://example.com/día')}")
check(status == 302 and to == "https://example.com/d%C3%ADa", f"an address with other letters: written as a header takes it ({to})")
check(get(f"/{TOKEN}/{hexed('http://amarchy:3471/')}", "HEAD")[0] == 302, "asked for its headers only: the same")
check(get(f"/{'f' * 32}/{hexed('https://example.com/')}")[0] == 404, "another token: nothing there")
for bad in ("javascript:alert(1)", "file:///etc/passwd", "//example.com/", "https://example.com/a b", "https://example.com/\r\nSet-Cookie: a=b"):
    check(get(f"/{TOKEN}/{hexed(bad)}")[0] == 404, f"{bad!r}: not a web address, nothing there")
for path in ("/", f"/{TOKEN}/", f"/{TOKEN}/zz", f"/{TOKEN}/ff", "/login"):
    check(get(path)[0] == 404, f"{path}: nothing there")

# The link as the app's pages write it: this server's address, the token, the link in hex.
am._links_out = f"http://127.0.0.1:{port}/{TOKEN}/"
out = am.links_out("http://amarchy:3471/login")
check(out == f"http://127.0.0.1:{port}/{TOKEN}/{hexed('http://amarchy:3471/login')}" and "login" not in out, "a link out is written without its words")
check(am.links_out("mailto:a@b.c") is None and am.links_out("") is None, "only a web address is")
am._links_out = None
check(am.links_out("http://amarchy:3471/login") is None, "not listening: none (the app opens it as it did)")

server.shutdown()
print(f"\n{len(failures)} failed:\n  " + "\n  ".join(failures) if failures else "\nAll passed.")
sys.exit(1 if failures else 0)
