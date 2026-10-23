#!/usr/bin/env python3
"""Write backgrounds.json: the list of Omarchy's own wallpapers for each of
amarchy's themes (themes/<name>/backgrounds/ in basecamp/omarchy, at one
commit), with each file's size and git hash. Only the list is kept here: the
pictures themselves are fetched by each host from Omarchy's repository
(amarchy theme --refresh-wallpapers) and checked against these hashes, never
copied into amarchy (see CREDITS). Run it to follow a newer Omarchy:

    python3 themes/backgrounds.py [commit]      (default: Omarchy's main now)

Its intro videos (backgrounds/intros/) aren't wallpapers, and are left out."""
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = "basecamp/omarchy"
PICTURES = (".jpg", ".jpeg", ".png", ".webp")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "amarchy", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main(argv):
    ref = argv[0] if argv else "main"
    commit = get(f"https://api.github.com/repos/{REPO}/commits/{ref}")
    sha, date = commit["sha"], commit["commit"]["committer"]["date"][:10]
    tree = get(f"https://api.github.com/repos/{REPO}/git/trees/{sha}?recursive=1")
    if tree.get("truncated"):
        sys.exit("GitHub cut the list short: can't tell every wallpaper")
    ours = {d.name for d in HERE.iterdir() if (d / "colors.toml").is_file()}
    themes = {}
    for f in tree["tree"]:
        parts = f["path"].split("/")
        if (f["type"] == "blob" and len(parts) == 4 and parts[0] == "themes" and parts[2] == "backgrounds"
                and parts[1] in ours and Path(parts[3]).suffix.lower() in PICTURES):
            themes.setdefault(parts[1], []).append({"file": parts[3], "size": f["size"], "sha": f["sha"]})
    for files in themes.values():
        files.sort(key=lambda f: f["file"])         # Omarchy's order: the first is the theme's own
    out = {"repo": REPO, "commit": sha, "date": date,
           "themes": {k: themes[k] for k in sorted(themes)}}
    (HERE / "backgrounds.json").write_text(json.dumps(out, indent=1) + "\n")
    missing = sorted(ours - set(themes))
    n = sum(len(v) for v in themes.values())
    print(f"{n} wallpapers of {len(themes)} themes, at {REPO} {sha[:7]} ({date})"
          + (f"; none for {', '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
