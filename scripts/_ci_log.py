import json
import pathlib
import sys
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parents[1]
OWNER, REPO = "richeroveis", "aegis-arena"
API = "https://api.github.com"
T = None


def tok():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("GITHUB_TOKEN="):
            return line.split("=", 1)[1].strip()


T = tok()


def api(path):
    req = Request(API + path)
    req.add_header("Authorization", f"Bearer {T}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "aegis")
    with urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode())


sha = sys.argv[1]
cr = api(f"/repos/{OWNER}/{REPO}/commits/{sha}/check-runs")["check_runs"]
for run in cr:
    print("CHECK", run["name"], run["conclusion"])
    out = run.get("output", {})
    print("  title:", out.get("title"))
    print("  summary:", (out.get("summary") or "")[:500])
    ann = api(run["url"] + "/annotations")
    for a in ann[:10]:
        print("  ANN:", a.get("annotation_level"), (a.get("message") or "")[:300])
