# A chat's preview, without a browser: amarchy preview saves an address for its
# Preview button, refuses one the user's browser can't reach, and clears; the
# list says whether it answers, the prompts tell Claude about it.
#
#   python3 test/preview.py         exits 0 when every check passed

import importlib.machinery, importlib.util, json, os, socket, sys, tempfile, time
from pathlib import Path

home = tempfile.mkdtemp(prefix="preview-")
os.environ.update(HOME=home, XDG_STATE_HOME=home + "/state", XDG_CONFIG_HOME=home + "/config")
os.environ.pop("AMARCHY_SESSION", None)
loader = importlib.machinery.SourceFileLoader("amarchy_under_test", str(Path(__file__).resolve().parent.parent / "bin/amarchy"))
am = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(am)

failed = []
def check(ok, what):
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failed.append(what)

am._network = ("box", "127.0.0.1")
am.SESSIONS.mkdir(parents=True, exist_ok=True)
am.save_session({"id": "p-a", "repo": "p", "name": "a", "branch": "a", "base": "main", "path": home})
saved = lambda: am.session("p-a").get("preview")

check(am.cmd_preview(["--id", "p-a", "http://localhost:3000"]) != 0 and not saved(), "localhost refused on a host: it wouldn't reach their browser")
check(am.cmd_preview(["--id", "p-a", "ftp://box/x"]) != 0 and not saved(), "only http and https")
check(am.cmd_preview(["--id", "p-a", "not a url"]) != 0 and not saved(), "not an address: refused")

srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(1)
port = srv.getsockname()[1]
url = f"http://box:{port}/app"
check(am.cmd_preview(["--id", "p-a", url]) == 0 and saved() == {"url": url}, "saved on the session")
s = am.session("p-a"); s["title"] = "Named"; am.save_session(s)
check(saved() == {"url": url}, "kept when the session is saved again")

check(am.preview_up(url) is True, "something listens: up")
srv.close()
am._preview_up.clear()
check(am.preview_up(url) is False, "nothing listens: not up")
check(am.preview_up(f"http://box.tail1234.ts.net:{port}/") is False, "the machine's full name is this machine too")
check(am.preview_up("https://example.vercel.app/") is True, "served elsewhere: not tried, taken as up")
check(am.preview_local("https://example.vercel.app/") is None, "nothing elsewhere is ever probed")

check(am.cmd_preview(["--id", "p-a", "--clear"]) == 0 and not saved(), "--clear takes it off")
check(am.cmd_preview(["--id", "p-a", "https://example.com/x"]) == 0 and saved() == {"url": "https://example.com/x"}, "a deploy's address is fine")

check("amarchy preview <url>" in am.REPLY_FORMAT, "the system prompt tells Claude to set it")
check("amarchy preview <url>" in am.agent_context(am.session("p-a")), "and the session's start says which address")
check("preview" not in am.VIEW_FIELDS and "preview_up" in am.VIEW_FIELDS, "the address is saved, whether it answers isn't")

print(f"\n{len(failed)} failed" if failed else "\nAll passed.")
sys.exit(1 if failed else 0)
