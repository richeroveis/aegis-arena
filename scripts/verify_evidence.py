"""Complete the four-way sha256 proof for the deployed Milestone v1 contract.

Run after the contract is committed and pushed:

    python scripts/verify_evidence.py [commit_sha]

It compares:
  1. local LF file bytes
  2. git blob at the commit
  3. remote GitHub raw blob at the commit
  4. on-chain contract code from the studionet explorer

and writes the result into evidence/studionet_deployment.json and
docs/evidence.md.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "aegis_arena.py"
EVIDENCE = ROOT / "evidence" / "studionet_deployment.json"
DOCS_EVIDENCE = ROOT / "docs" / "evidence.md"
OWNER = "richeroveis"
REPO = "aegis-arena"
EXPLORER_ADDR_API = "https://explorer-studio.genlayer.com/api/address/"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob(commit: str) -> bytes:
    return subprocess.run(
        ["git", "show", f"{commit}:contracts/aegis_arena.py"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    ).stdout


def remote_blob(commit: str) -> bytes:
    url = f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{commit}/contracts/aegis_arena.py"
    req = Request(url, headers={"User-Agent": "aegis-evidence"})
    with urlopen(req, timeout=40) as resp:
        return resp.read()


def onchain_blob(address: str) -> bytes:
    url = EXPLORER_ADDR_API + address
    req = Request(url, headers={"User-Agent": "aegis-evidence"})
    with urlopen(req, timeout=40) as resp:
        payload = json.load(resp)
    return payload.get("contract_code", "").encode("utf-8")


def main() -> int:
    commit = sys.argv[1] if len(sys.argv) > 1 else subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()

    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    address = evidence["contract_address"]

    local_bytes = CONTRACT.read_bytes()
    hashes = {
        "local_lf_file": sha256_bytes(local_bytes),
        "git_blob": sha256_bytes(git_blob(commit)),
        "remote_github_blob": sha256_bytes(remote_blob(commit)),
        "onchain_explorer_code": sha256_bytes(onchain_blob(address)),
    }
    four_way = len(set(hashes.values())) == 1

    evidence["sha256"].update(
        {
            "local_lf_file": hashes["local_lf_file"],
            "git_blob": hashes["git_blob"],
            "remote_github_blob": hashes["remote_github_blob"],
            "onchain_explorer_code": hashes["onchain_explorer_code"],
            "four_way_match": four_way,
            "deployed_commit": commit,
        }
    )
    evidence["deployed_commit"] = commit
    EVIDENCE.write_text(json.dumps(evidence, indent=2), encoding="utf-8")

    reverts = evidence.get("guard_reverts", [])
    vault = evidence.get("vault_checks", {}).get("final", {})
    live = evidence.get("live_evaluation", {})
    s1 = live.get("submission_1", {})
    s2 = live.get("submission_2", {})
    challenge = live.get("challenge", {})

    lines = []
    lines.append("# AegisArena Milestone v1 On-Chain Evidence")
    lines.append("")
    lines.append("Deployed on GenLayer studionet (chain id 61999).")
    lines.append("")
    lines.append("## Coordinates")
    lines.append("")
    lines.append(f"- Contract address: `{address}`")
    lines.append(f"- Explorer: {evidence['explorer_url']}")
    lines.append(f"- Deploy tx: `{evidence['deploy_tx']}`")
    lines.append(f"- Deployed commit: `{commit}`")
    lines.append("")
    lines.append("## Four-way sha256 identity")
    lines.append("")
    lines.append("| Source | sha256 |")
    lines.append("|---|---|")
    lines.append(f"| Local LF file | `{hashes['local_lf_file']}` |")
    lines.append(f"| Git blob at commit | `{hashes['git_blob']}` |")
    lines.append(f"| Remote GitHub raw blob | `{hashes['remote_github_blob']}` |")
    lines.append(f"| Studionet on-chain code | `{hashes['onchain_explorer_code']}` |")
    lines.append("")
    lines.append(f"Four-way match: **{four_way}**")
    lines.append("")
    lines.append("## Live consensus outcomes")
    lines.append("")
    lines.append("| Submission | Defense band | Anchor | Total score |")
    lines.append("|---|---|---|---|")
    lines.append(f"| #1 | {s1.get('band')} | {s1.get('anchor')} | {s1.get('total_score')} |")
    lines.append(f"| #2 | {s2.get('band')} | {s2.get('anchor')} | {s2.get('total_score')} |")
    lines.append("")
    lines.append(
        f"Exploit challenge #{challenge.get('challenge_id')} resolved as "
        f"`{challenge.get('status')}` with band `{challenge.get('defense_band')}`."
    )
    lines.append("")
    lines.append("## Expected guard reverts")
    lines.append("")
    lines.append("| Guard | Blocked |")
    lines.append("|---|---|")
    for g in reverts:
        lines.append(f"| {g.get('name')} | {g.get('blocked')} |")
    lines.append("")
    lines.append("## Vault invariant")
    lines.append("")
    lines.append("```json")
    lines.append(json.dumps(vault, indent=2))
    lines.append("```")
    lines.append("")
    lines.append(
        "The invariant is `vault_custody_balance == active_tournament_pots + "
        "locked_defender_bonds + locked_challenger_bonds`."
    )
    lines.append("")
    lines.append("## Transactions")
    lines.append("")
    lines.append("| Label | Function | Tx | Status | Consensus |")
    lines.append("|---|---|---|---|---|")
    for tx in evidence.get("transactions", []):
        lines.append(
            f"| {tx.get('label')} | {tx.get('function')} | `{tx.get('tx_hash')}` | "
            f"{tx.get('status')} | {tx.get('consensus_result')} |"
        )
    lines.append("")
    lines.append("Machine-readable proof: `evidence/studionet_deployment.json`.")
    lines.append("")

    DOCS_EVIDENCE.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps(hashes, indent=2))
    print("FOUR-WAY MATCH:", four_way)
    print("Evidence updated:", EVIDENCE)
    print("Docs evidence written:", DOCS_EVIDENCE)
    return 0 if four_way else 1


if __name__ == "__main__":
    sys.exit(main())
