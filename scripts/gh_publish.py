"""GitHub publishing helper for AegisArena.

Reads GITHUB_TOKEN from .env (never printed). Subcommands:
  whoami        confirm the token owner
  create-repo   create the public repo richeroveis/aegis-arena if missing
  enable-pages  configure GitHub Pages from the gh-pages branch and poll the URL
"""

import json
import pathlib
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parents[1]
OWNER = "richeroveis"
REPO = "aegis-arena"
API = "https://api.github.com"
LIVE_URL = f"https://{OWNER}.github.io/{REPO}/"


def token() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("GITHUB_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("GITHUB_TOKEN missing in .env")


def api(method: str, path: str, body=None):
    req = Request(f"{API}{path}", method=method)
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "aegisarena-publish")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, data=data, timeout=40) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else {})
    except HTTPError as e:
        raw = e.read().decode()
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"message": raw[:200]}
        # redact anything that looks like a token just in case
        return e.code, parsed


def whoami():
    status, data = api("GET", "/user")
    print("token user:", data.get("login"), "status", status)
    return data.get("login")


def create_repo():
    status, data = api("POST", "/user/repos", {
        "name": REPO,
        "description": "AegisArena: GenLayer multiplayer tactical tournaments resolved against live web sources.",
        "public": True,
        "auto_init": False,
        "has_wiki": False,
    })
    if status in (200, 201):
        print("repo created:", data.get("html_url"))
    elif status == 422:
        print("repo already exists")
    else:
        print("create failed", status, json.dumps(data)[:300])
        return False
    return True


def enable_pages():
    status, data = api("POST", f"/repos/{OWNER}/{REPO}/pages", {
        "source": {"branch": "gh-pages", "path": "/"},
    })
    if status in (200, 201):
        print("pages enabled")
    elif status == 409:
        print("pages already enabled")
    else:
        print("pages enable", status, json.dumps(data)[:300])

    # poll the Pages build status
    for _ in range(30):
        s, d = api("GET", f"/repos/{OWNER}/{REPO}/pages")
        st = d.get("status") or d.get("build", {}).get("status")
        print("pages status:", st)
        if st in ("built", "ready"):
            break
        time.sleep(10)

    # poll the live URL for HTTP 200
    for i in range(30):
        try:
            with urlopen(Request(LIVE_URL, headers={"User-Agent": "aegis"}), timeout=25) as r:
                print("live HTTP", r.status, LIVE_URL)
                if r.status == 200:
                    return True
        except Exception as e:
            print("live not ready", type(e).__name__)
        time.sleep(10)
    return False


def ci_status():
    import subprocess
    sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    for _ in range(40):
        s, d = api("GET", f"/repos/{OWNER}/{REPO}/commits/{sha}/check-runs")
        runs = d.get("check_runs", [])
        if runs:
            concl = [(r.get("name"), r.get("status"), r.get("conclusion")) for r in runs]
            for name, st, cc in concl:
                print(f"{name}: {st} {cc or ''}")
            if all(st == "completed" for _, st, _ in concl):
                return all(cc == "success" for _, _, cc in concl)
        else:
            print("no check runs yet for", sha[:8])
        time.sleep(15)
    return False


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "whoami"
    if cmd == "whoami":
        whoami()
    elif cmd == "create-repo":
        sys.exit(0 if create_repo() else 1)
    elif cmd == "enable-pages":
        sys.exit(0 if enable_pages() else 1)
    elif cmd == "ci-status":
        sys.exit(0 if ci_status() else 1)
    else:
        sys.exit("unknown command")
