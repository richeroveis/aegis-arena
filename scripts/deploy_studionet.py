"""Deploy AegisArena to GenLayer studionet, seed reviewer-ready state, and
collect on-chain evidence.

Run from the repo root:  python scripts/deploy_studionet.py

Reads GENLAYER_PRIVATE_KEY from .env (never printed). Gasless on studionet.
Writes a machine-readable evidence file to evidence/studionet_deployment.json.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys
import time
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load_env() -> str:
    env_path = ROOT / ".env"
    if not env_path.exists():
        sys.exit("Missing .env in project root. Stop and add GENLAYER_PRIVATE_KEY.")
    pk = None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("GENLAYER_PRIVATE_KEY="):
            pk = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not pk:
        sys.exit("GENLAYER_PRIVATE_KEY not found in .env")
    if not pk.startswith("0x"):
        pk = "0x" + pk
    return pk


PRIVATE_KEY = _load_env()  # loaded before importing SDK to keep ordering clear

from genlayer_py import create_account, create_client  # noqa: E402
from genlayer_py.chains import studionet  # noqa: E402
from genlayer_py.types import TransactionStatus  # noqa: E402

EXPLORER_ADDR_API = "https://explorer-studio.genlayer.com/api/address/"
CONTRACT_PATH = ROOT / "contracts" / "aegis_arena.py"
INTERVAL_MS = 6000
RETRIES = 40


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_rate_limited(exc: Exception) -> bool:
    text = str(exc)
    return "429" in text or "-32429" in text or "rate" in text.lower()


def is_transient(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        is_rate_limited(exc)
        or "ssl" in text
        or "eof" in text
        or "connection" in text
        or "max retries" in text
        or "timed out" in text
        or "timeout" in text
    )


def retry_call(fn, *args, retries: int = 8, delay: int = 8, **kwargs):
    """Call fn, retrying on transient studionet TLS / rate-limit errors."""
    last = None
    for attempt in range(retries):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            last = exc
            if is_transient(exc):
                wait = delay + attempt * 4
                print(f"    transient error ({type(exc).__name__}); retry in {wait}s")
                time.sleep(wait)
                continue
            raise
    raise last


def finalize(client, tx_hash: str) -> dict:
    """Wait for FINALIZED, retrying on studionet transient / rate errors."""
    return retry_call(
        client.wait_for_transaction_receipt,
        tx_hash,
        status=TransactionStatus.FINALIZED,
        interval=INTERVAL_MS,
        retries=RETRIES,
        full_transaction=True,
    )


def submit_write(client, address, fn, args, account, label, log):
    """Send one write tx, wait FINALIZED, capture evidence. Returns receipt."""
    tx_hash = retry_call(
        client.write_contract,
        address, fn, account=account, args=args, leader_only=True,
    )
    receipt = finalize(client, tx_hash)
    entry = {
        "label": label,
        "function": fn,
        "tx_hash": tx_hash,
        "status": receipt.get("status_name") or receipt.get("status"),
        "consensus_result": receipt.get("result_name"),
        "error": receipt.get("error"),
    }
    log.append(entry)
    print(f"  {label}: {entry['status']} / {entry['consensus_result']} {tx_hash}")
    time.sleep(3)
    return receipt, tx_hash


def main() -> int:
    main_account = create_account(account_private_key=PRIVATE_KEY)
    client = create_client(chain=studionet, account=main_account)
    # Second ephemeral signer for community endorsement / co-play.
    peer_account = create_account()

    source_text = CONTRACT_PATH.read_text(encoding="utf-8")
    source_bytes = source_text.encode("utf-8")
    hash_local = sha256_bytes(source_bytes)
    hash_deploy = sha256_bytes(source_bytes)  # exact bytes sent to the network

    print(f"Main signer: {main_account.address}")
    print(f"Ephemeral peer signer: {peer_account.address}")

    # ---- deploy ----
    print("Deploying AegisArena to studionet...")
    deploy_tx = retry_call(client.deploy_contract, code=source_text, args=[], leader_only=True)
    deploy_receipt = finalize(client, deploy_tx)
    address = deploy_receipt.get("data", {}).get("contract_address") or deploy_receipt.get("recipient")
    print(f"  deployed at {address} ({deploy_receipt.get('status_name')})")

    # ---- 3-way sha256 identity ----
    hash_chain = None
    try:
        with urlopen(Request(EXPLORER_ADDR_API + address, headers={"User-Agent": "aegis"}), timeout=30) as resp:
            explorer = json.load(resp)
        onchain_code = explorer.get("contract_code", "")
        hash_chain = sha256_bytes(onchain_code.encode("utf-8"))
        deployment_tx = explorer.get("creator_info", {}).get("deployment_tx_hash")
    except Exception as exc:  # noqa: BLE001
        print(f"  explorer code fetch failed: {type(exc).__name__}")
        onchain_code = ""
        deployment_tx = None

    three_way_match = bool(hash_chain) and hash_local == hash_deploy == hash_chain
    print(f"  3-way sha256 match: {three_way_match}")

    log = []
    log.append({
        "label": "deploy",
        "function": "__init__",
        "tx_hash": deploy_tx,
        "status": deploy_receipt.get("status_name"),
        "consensus_result": deploy_receipt.get("result_name"),
        "contract_address": address,
    })

    # ---- seeding ----
    print("Seeding reviewer state...")
    t1_url = "https://en.wikipedia.org/wiki/Cybersecurity"
    t2_url = "https://owasp.org/www-project-top-ten/"

    _, _ = submit_write(client, address, "create_tournament", [
        "Red Team Raid: Lockdown Protocol",
        "Design a covert network-segmentation plan that isolates the crown-jewel VLAN "
        "without disrupting hospital telemetry. Ground every claim in the reference source.",
        t1_url,
        "LOCKDOWN PROTOCOL",
        8000,
    ], main_account, "create_tournament#1", log)

    _, _ = submit_write(client, address, "create_tournament", [
        "Blue Team Hardening: Top-Ten Reversal",
        "Produce a prioritized remediation brief that neutralizes the three highest-impact "
        "OWASP entries for a public fintech API. Cite the reference list.",
        t2_url,
        "OWASP",
        6000,
    ], main_account, "create_tournament#2", log)

    submit_write(client, address, "submit_tactic", [
        1,
        "Valkyrie",
        "Stage one: micro-segment the clinical VLAN and enforce zero-trust identity at the "
        "edge before any lateral movement. Anchor the whole plan on LOCKDOWN PROTOCOL so telemetry "
        "stays up while attackers are boxed in. Stage two: deploy canary hosts that alert on any "
        "unusual east-west flow. Stage three: rotate all service credentials and cut a hardened "
        "jump-host path for the IR team. Every action maps to defense-in-depth from the reference.",
    ], main_account, "submit_tactic#1 (Valkyrie)", log)

    submit_write(client, address, "submit_tactic", [
        2,
        "Nomad",
        "Prioritize OWASP A01 broken access control and A02 cryptographic failures first for the "
        "fintech API. Enforce deny-by-default object authorization, then move secrets to a managed KMS "
        "with short-lived tokens. Next, harden A03 injection with parameterized queries and strict "
        "server-side validation. Map OWASP controls to release-gate tests so regressions cannot ship.",
    ], peer_account, "submit_tactic#2 (Nomad, peer signer)", log)

    submit_write(client, address, "score_tactic_deterministic", [
        1,
        45,
        "Grounds every step in defense-in-depth from the reference and keeps the LOCKDOWN PROTOCOL "
        "anchor load-bearing. Minor gap: no rollback plan for the jump host.",
    ], main_account, "score_tactic_deterministic#1 (creator rubric)", log)

    submit_write(client, address, "endorse_submission", [1], peer_account,
                 "endorse_submission#1 (peer signer)", log)

    submit_write(client, address, "post_arena_comment", [
        1, 1, "Nomad",
        "Strong segmentation-first ordering, though I would front-load the telemetry continuity risk.",
        "ANALYSIS",
    ], peer_account, "post_arena_comment#1 (peer signer)", log)

    # ---- expected rollback: cancel a tournament that already has entries ----
    rb_tx = retry_call(
        client.write_contract, address, "cancel_tournament",
        account=main_account, args=[1], leader_only=True,
    )
    rb_receipt = finalize(client, rb_tx)
    rb_finalized = (rb_receipt.get("status_name") or rb_receipt.get("status"))
    log.append({
        "label": "rollback_check cancel_tournament#1 (has entries, must not take effect)",
        "function": "cancel_tournament",
        "tx_hash": rb_tx,
        "status": rb_finalized,
        "consensus_result": rb_receipt.get("result_name"),
        "error": rb_receipt.get("error"),
        "expected": "no state change; tournament stays OPEN",
    })
    print(f"  rollback check tx {rb_tx}: {rb_finalized}")

    # ---- read back and verify the rollback left state intact ----
    time.sleep(2)
    t1_state = retry_call(client.read_contract, address, "get_tournament", args=[1])
    rollback_ok = t1_state.get("status") == "OPEN"
    all_tournaments = retry_call(client.read_contract, address, "get_all_tournaments", args=[])
    subs_1 = retry_call(client.read_contract, address, "get_tournament_submissions", args=[1])
    subs_2 = retry_call(client.read_contract, address, "get_tournament_submissions", args=[2])
    comments_1 = retry_call(client.read_contract, address, "get_tournament_comments", args=[1])
    leaderboard = retry_call(client.read_contract, address, "get_leaderboard", args=[])
    stats = retry_call(client.read_contract, address, "get_arena_stats", args=[])

    print("\nFinal on-chain state:")
    print("  stats:", stats)
    print("  tournament#1 status:", t1_state.get("status"), "leader:", t1_state.get("current_leader"))
    print("  tournament#1 endorsements:", subs_1[0]["endorsements"] if subs_1 else None)
    print("  rollback left OPEN:", rollback_ok)

    evidence = {
        "network": "studionet",
        "chain_id": 61999,
        "rpc": "https://studio.genlayer.com/api",
        "contract_address": address,
        "explorer_url": f"https://explorer-studio.genlayer.com/address/{address}",
        "deploy_tx": deploy_tx,
        "deploy_status": deploy_receipt.get("status_name"),
        "deploy_consensus_result": deploy_receipt.get("result_name"),
        "creator_address": main_account.address,
        "peer_address": peer_account.address,
        "sha256": {
            "local_file": hash_local,
            "deploy_payload": hash_deploy,
            "onchain_explorer_contract_code": hash_chain,
            "three_way_match": three_way_match,
            "explorer_deployment_tx": deployment_tx,
        },
        "transactions": log,
        "rollback_check": {
            "tx": rb_tx,
            "finalized": rb_finalized,
            "left_tournament_open": rollback_ok,
        },
        "final_state": {
            "arena_stats": stats,
            "tournaments": all_tournaments,
            "tournament_1_submissions": subs_1,
            "tournament_2_submissions": subs_2,
            "tournament_1_comments": comments_1,
            "leaderboard": leaderboard,
        },
    }

    out_dir = ROOT / "evidence"
    out_dir.mkdir(exist_ok=True)
    out_file = out_dir / "studionet_deployment.json"
    out_file.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(f"\nEvidence written to {out_file}")

    ok = (
        deploy_receipt.get("status_name") == "FINALIZED"
        and rollback_ok
        and stats.get("total_tournaments", 0) == 2
        and stats.get("total_submissions", 0) == 2
        and stats.get("total_endorsements", 0) >= 1
        and stats.get("total_comments", 0) >= 1
    )
    print("DEPLOY+SEED OK:", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
