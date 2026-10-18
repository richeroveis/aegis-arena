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


def submit_write(client, address, fn, args, account, label, log, leader_only=True, expect_revert=False):
    """Send one write tx, wait FINALIZED, capture evidence. Returns receipt.

    leader_only=False is required for the non-deterministic evaluate_tactic_live
    path so it runs through full validator consensus. expect_revert marks calls
    that must apply no state change (used for the negative checks); their receipt
    error is recorded but is not treated as a failure.
    """
    tx_hash = retry_call(
        client.write_contract,
        address, fn, account=account, args=args, leader_only=leader_only,
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
    if expect_revert:
        entry["expected"] = "revert; no state change"
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
    # A fast, reliable public reference page with a mandatory token every
    # validator can independently verify through the live consensus path.
    ref_url = "https://example.com"
    ref_token = "Example Domain"

    def read_tournament(i):
        return retry_call(client.read_contract, address, "get_tournament", args=[i])

    def read_submission(tid, sid):
        subs = retry_call(client.read_contract, address, "get_tournament_submissions", args=[tid])
        for s in subs:
            if int(s["submission_id"]) == sid:
                return s
        return {}

    _, _ = submit_write(client, address, "create_tournament", [
        "Red Team Raid: Lockdown Protocol",
        "Design a covert network-segmentation plan that isolates the crown-jewel VLAN "
        "without disrupting hospital telemetry. Ground every claim in the reference source.",
        ref_url,
        ref_token,
        8000,
    ], main_account, "create_tournament#1", log)

    _, _ = submit_write(client, address, "create_tournament", [
        "Blue Team Hardening: Perimeter Reversal",
        "Produce a prioritized remediation brief that neutralizes the three highest-impact "
        "perimeter risks for a public fintech API. Cite the reference source.",
        ref_url,
        ref_token,
        6000,
    ], main_account, "create_tournament#2", log)

    submit_write(client, address, "submit_tactic", [
        1,
        "Valkyrie",
        "Stage one: micro-segment the clinical VLAN and enforce zero-trust identity at the "
        "edge before any lateral movement. Anchor the whole plan on Example Domain so telemetry "
        "stays up while attackers are boxed in. Stage two: deploy canary hosts that alert on any "
        "unusual east-west flow. Stage three: rotate all service credentials and cut a hardened "
        "jump-host path for the IR team. Every action maps to defense-in-depth from the reference.",
    ], main_account, "submit_tactic#1 (Valkyrie, live tournament)", log)

    submit_write(client, address, "submit_tactic", [
        2,
        "Nomad",
        "Prioritize the highest-impact perimeter risks first for the fintech API and keep every "
        "claim anchored to the Example Domain reference. Enforce deny-by-default object "
        "authorization, then move secrets to a managed KMS with short-lived tokens, and harden "
        "injection with parameterized queries and strict server-side validation before shipping.",
    ], peer_account, "submit_tactic#2 (Nomad, peer signer, unevaluated tournament)", log)

    # A freshly submitted tactic must NOT take the lead before live consensus.
    t1_before = read_tournament(1)
    leader_before_eval = t1_before.get("current_leader")
    best_before_eval = int(t1_before.get("best_score", 0))

    # ---- real live-consensus evaluation on studionet (full validator path) ----
    # Requiring validators to agree on the exact quantized verdict can, on rare
    # runs, end in MAJORITY_DISAGREE. That is a clean rollback (no state change,
    # the submission stays unevaluated), so re-invoking is safe. Retry until the
    # network reaches consensus, bounded to avoid an infinite loop.
    print("Running live consensus evaluation on submission #1...")
    eval_tx = None
    for attempt in range(5):
        _eval_receipt, eval_tx = submit_write(client, address, "evaluate_tactic_live", [1], main_account,
                     f"evaluate_tactic_live#1 (full validator consensus, attempt {attempt + 1})", log,
                     leader_only=False)
        if _eval_receipt.get("result_name") == "MAJORITY_AGREE":
            break
    else:
        print("  WARNING: live consensus did not converge on an exact verdict after retries")

    sub1_eval = read_submission(1, 1)
    t1_after_eval = read_tournament(1)
    leader_after_eval = t1_after_eval.get("current_leader")
    best_after_eval = int(t1_after_eval.get("best_score", 0))
    eval_verified = (
        sub1_eval.get("evaluated") is True
        and int(sub1_eval.get("ai_verdict_score", -1)) % 5 == 0
        and best_after_eval == int(sub1_eval.get("total_score", -1))
        and leader_after_eval == sub1_eval.get("player")
    )

    # ---- community endorsement from a second signer (leader/score sync) ----
    submit_write(client, address, "endorse_submission", [1], peer_account,
                 "endorse_submission#1 (peer signer)", log)
    sub1_end = read_submission(1, 1)
    t1_after_endorse = read_tournament(1)
    best_after_endorse = int(t1_after_endorse.get("best_score", 0))
    endorse_sync_verified = (
        best_after_endorse == best_after_eval + 2
        and best_after_endorse == int(sub1_end.get("total_score", -1))
        and t1_after_endorse.get("current_leader") == leader_after_eval
    )

    submit_write(client, address, "post_arena_comment", [
        1, 1, "Nomad",
        "Strong segmentation-first ordering, though I would front-load the telemetry continuity risk.",
        "ANALYSIS",
    ], peer_account, "post_arena_comment#1 (peer signer)", log)

    # ---- expected rollback A: settle tournament #2 with no live evaluation ----
    # Tournament #2 has an entry that never completed evaluate_tactic_live, so
    # settlement must revert and leave the tournament OPEN.
    _, rb_settle_tx = submit_write(client, address, "settle_tournament", [2], main_account,
                                    "rollback_settle#2 (no live-evaluated winner, must revert)", log,
                                    expect_revert=True)
    time.sleep(2)
    t2_state = read_tournament(2)
    rollback_settle_ok = (
        t2_state.get("status") == "OPEN"
        and int(t2_state.get("best_score", 0)) == 0
    )

    # ---- settle tournament #1 pays the live-evaluated on-chain leader ----
    submit_write(client, address, "settle_tournament", [1], main_account,
                 "settle_tournament#1 (live-evaluated winner)", log)
    t1_settled = read_tournament(1)
    settle_winner_verified = (
        t1_settled.get("status") == "SETTLED"
        and t1_settled.get("winner") == leader_after_eval
        and t1_settled.get("winner") == sub1_eval.get("player")
    )

    # ---- expected rollback B: endorse a submission after its tournament settled ----
    sub1_pre_rb = read_submission(1, 1)
    _, rb_endorse_tx = submit_write(client, address, "endorse_submission", [1], peer_account,
                                     "rollback_endorse#1 (post-settlement, must revert)", log,
                                     expect_revert=True)
    time.sleep(2)
    sub1_post_rb = read_submission(1, 1)
    rollback_endorse_ok = (
        int(sub1_post_rb.get("endorsements", -1)) == int(sub1_pre_rb.get("endorsements", 0))
        and int(sub1_post_rb.get("total_score", -1)) == int(sub1_pre_rb.get("total_score", -1))
    )

    # ---- read back final state ----
    all_tournaments = retry_call(client.read_contract, address, "get_all_tournaments", args=[])
    subs_1 = retry_call(client.read_contract, address, "get_tournament_submissions", args=[1])
    subs_2 = retry_call(client.read_contract, address, "get_tournament_submissions", args=[2])
    comments_1 = retry_call(client.read_contract, address, "get_tournament_comments", args=[1])
    leaderboard = retry_call(client.read_contract, address, "get_leaderboard", args=[])
    stats = retry_call(client.read_contract, address, "get_arena_stats", args=[])

    print("\nFinal on-chain state:")
    print("  stats:", stats)
    print("  T1 leader before eval:", leader_before_eval, "best:", best_before_eval)
    print("  T1 leader after eval:", leader_after_eval, "best:", best_after_eval)
    print("  T1 best after endorse:", best_after_endorse, "(endorse sync:", endorse_sync_verified, ")")
    print("  T1 settled winner matches live leader:", settle_winner_verified)
    print("  T2 settle blocked without live evaluation:", rollback_settle_ok)
    print("  T1 endorse-after-settle blocked:", rollback_endorse_ok)

    invariant = {
        "submit_does_not_take_lead": best_before_eval == 0,
        "live_evaluation_sets_leader": eval_verified,
        "endorsement_syncs_leader_and_score": endorse_sync_verified,
        "settle_requires_live_evaluated_winner": rollback_settle_ok,
        "settle_pays_live_leader": settle_winner_verified,
        "endorse_blocked_after_settle": rollback_endorse_ok,
    }

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
        "score_invariant_checks": invariant,
        "live_evaluation_tx_evidence": {
            "submission_id": 1,
            "consensus_tx_hash": eval_tx,
            "evaluated": sub1_eval.get("evaluated"),
            "ai_verdict_score": sub1_eval.get("ai_verdict_score"),
            "total_score": sub1_eval.get("total_score"),
            "leader_after_eval": leader_after_eval,
        },
        "rollback_checks": {
            "settle_unevaluated_tournament_tx": rb_settle_tx,
            "tournament_2_left_open": rollback_settle_ok,
            "endorse_after_settle_tx": rb_endorse_tx,
            "endorse_after_settle_left_score_unchanged": rollback_endorse_ok,
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
        and three_way_match
        and all(invariant.values())
        and stats.get("total_tournaments", 0) == 2
        and stats.get("total_submissions", 0) == 2
        and stats.get("evaluated_submissions", 0) >= 1
        and stats.get("total_endorsements", 0) >= 1
        and stats.get("total_comments", 0) >= 1
        and stats.get("settled", 0) >= 1
    )
    print("DEPLOY+SEED OK:", ok, "| invariant:", invariant)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
