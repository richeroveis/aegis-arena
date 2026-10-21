"""Deploy AegisArena Milestone v1 to GenLayer studionet, drive a live scenario,
and collect reviewer-ready evidence.

Run from the repo root:  python scripts/deploy_studionet.py

Reads GENLAYER_PRIVATE_KEY from .env (never printed). Gasless on studionet.
Writes evidence/studionet_deployment.json. The four-way sha256 check (local,
git blob, remote GitHub blob, on-chain code) is completed by
scripts/verify_evidence.py after the contract is committed and pushed.
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
RETRIES = 60
CHALLENGE_WINDOW_SECONDS = 300
PRIZE_T1 = 4000
PRIZE_T2 = 2500
BOND = 200


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
    return retry_call(
        client.wait_for_transaction_receipt,
        tx_hash,
        status=TransactionStatus.FINALIZED,
        interval=INTERVAL_MS,
        retries=RETRIES,
        full_transaction=True,
    )


def submit_write(client, address, fn, args, account, label, log, leader_only=True, expect_revert=False):
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
    leader_receipts = (receipt.get("consensus_data") or {}).get("leader_receipt") or []
    if leader_receipts:
        entry["execution_result"] = leader_receipts[0].get("execution_result")
    if expect_revert:
        entry["expected"] = "revert; no state change"
    log.append(entry)
    print(f"  {label}: {entry['status']} / {entry['consensus_result']} {tx_hash}")
    time.sleep(2)
    return receipt, tx_hash


def submit_consensus_write(client, address, fn, args, account, label, log, attempts=6):
    """Retry a live-consensus write until validators agree (or attempts run out).

    A MAJORITY_DISAGREE on the exact discrete verdict is a clean rollback with no
    state change, so re-invoking the same call is safe.
    """
    receipt = None
    tx_hash = None
    for attempt in range(attempts):
        receipt, tx_hash = submit_write(
            client, address, fn, args, account,
            f"{label} (live consensus attempt {attempt + 1})", log,
            leader_only=False,
        )
        if receipt.get("result_name") == "MAJORITY_AGREE":
            return receipt, tx_hash
    return receipt, tx_hash


def main() -> int:
    main_account = create_account(account_private_key=PRIVATE_KEY)
    peer_account = create_account()
    challenger_account = create_account()
    client = create_client(chain=studionet, account=main_account)

    source_text = CONTRACT_PATH.read_text(encoding="utf-8")
    source_bytes = source_text.encode("utf-8")
    hash_local = sha256_bytes(source_bytes)
    hash_deploy = sha256_bytes(source_bytes)

    print(f"Main signer: {main_account.address}")
    print(f"Peer signer: {peer_account.address}")
    print(f"Challenger signer: {challenger_account.address}")

    # ---- deploy ----
    print("Deploying AegisArena Milestone v1 to studionet...")
    deploy_tx = retry_call(client.deploy_contract, code=source_text, args=[], leader_only=True)
    deploy_receipt = finalize(client, deploy_tx)
    address = deploy_receipt.get("data", {}).get("contract_address") or deploy_receipt.get("recipient")
    print(f"  deployed at {address} ({deploy_receipt.get('status_name')})")

    # ---- on-chain code hash ----
    hash_chain = None
    deployment_tx = None
    try:
        with urlopen(Request(EXPLORER_ADDR_API + address, headers={"User-Agent": "aegis"}), timeout=30) as resp:
            explorer = json.load(resp)
        onchain_code = explorer.get("contract_code", "")
        hash_chain = sha256_bytes(onchain_code.encode("utf-8"))
        deployment_tx = explorer.get("creator_info", {}).get("deployment_tx_hash")
    except Exception as exc:  # noqa: BLE001
        print(f"  explorer code fetch failed: {type(exc).__name__}")

    three_way_match = bool(hash_chain) and hash_local == hash_deploy == hash_chain
    print(f"  local/deploy/onchain sha256 match: {three_way_match}")

    log = []
    log.append({
        "label": "deploy",
        "function": "__init__",
        "tx_hash": deploy_tx,
        "status": deploy_receipt.get("status_name"),
        "consensus_result": deploy_receipt.get("result_name"),
        "contract_address": address,
    })

    def read(fn, args=None):
        return retry_call(client.read_contract, address, fn, args=args or [])

    def stat(key):
        return read("get_arena_stats").get(key)

    def vault():
        return read("check_vault_invariants")

    def balance(addr):
        return int(read("get_token_balance", [addr]))

    def tournament(tid):
        return read("get_tournament", [tid])

    def submission(sid):
        return read("get_submission", [sid])

    # ---- fund the three signers ----
    print("Funding signer ledgers from the AGT faucet...")
    for acct, label in (
        (main_account, "faucet main"),
        (peer_account, "faucet peer"),
        (challenger_account, "faucet challenger"),
    ):
        submit_write(client, address, "faucet_or_deposit", [60000], acct, label, log)

    # ---- seed two red-team tournaments ----
    print("Seeding AI red-team tournaments...")
    ref_url = "https://example.com"
    token = "Example Domain"

    submit_write(client, address, "create_tournament", [
        "Red-Team Gauntlet: Prompt Injection Defense",
        "Defend a support assistant against prompt injection and jailbreak payloads. "
        "Ground the defense in the reference source and never leak the system policy.",
        ref_url,
        token,
        PRIZE_T1,
        CHALLENGE_WINDOW_SECONDS,
    ], main_account, "create_tournament#1 (funded vault pot)", log)

    submit_write(client, address, "create_tournament", [
        "Jailbreak Arena: Policy Leak Stress Test",
        "Design a guardrail that survives role-play, encoding and tool-abuse jailbreaks. "
        "Anchor every claim on the reference source.",
        ref_url,
        token,
        PRIZE_T2,
        180,
    ], main_account, "create_tournament#2 (guard revert target)", log)

    print("Submitting defense tactics with defender bonds...")
    submit_write(client, address, "submit_tactic", [
        1,
        "Aegis Alpha",
        "Defense plan: anchor every answer on Example Domain, treat all user content as hostile, "
        "strip tool directives before rendering, and refuse role-play that requests the hidden policy. "
        "Log refusals with a hash of the prompt and replay the jailbreak corpus before each release. "
        "Escalate any policy leak to a human reviewer within one minute.",
        BOND,
    ], main_account, "submit_tactic#1 (Aegis Alpha, main)", log)

    submit_write(client, address, "submit_tactic", [
        1,
        "Aegis Beta",
        "Defense plan: validate the Example Domain reference, wrap untrusted text in a signed "
        "preamble, deny any instruction that asks to ignore prior rules, and cap output length. "
        "Run an adversarial corpus in CI and block releases when a jailbreak reproduces. "
        "Quarantine any tool call that tries to read the system policy.",
        BOND,
    ], peer_account, "submit_tactic#2 (Aegis Beta, peer)", log)

    submit_write(client, address, "submit_tactic", [
        2,
        "Jailbreak Nomad",
        "Defense plan: pin the Example Domain reference and encode the policy in a signed preamble. "
        "Reject encoding tricks, tool abuse and role-play that requests secrets. "
        "Log every refusal and replay the corpus weekly.",
        BOND,
    ], peer_account, "submit_tactic#3 (unevaluated, guard target)", log)

    v0 = vault()
    print("  vault after funding and bonds:", v0)
    assert v0["invariant_ok"], v0

    # ---- guard revert 1: premature settlement while the window is still open ----
    print("Guard revert 1: premature settlement before the challenge window closes...")
    submit_write(client, address, "settle_tournament", [1], main_account,
                 "guard_revert_premature_settle#1", log, expect_revert=True)
    premature_blocked = tournament(1)["status"] == "OPEN"
    assert premature_blocked, "premature settlement must not change status"

    # ---- first live consensus evaluation ----
    print("Running live consensus evaluation on submission #1...")
    submit_consensus_write(client, address, "evaluate_submission_live", [1], main_account,
                           "evaluate_submission_live#1", log)
    sub1 = submission(1)
    assert sub1["evaluated"] is True, sub1
    print(f"  sub1 band={sub1.get('defense_band')} anchor={sub1.get('robustness_anchor')} total={sub1.get('total_score')}")

    # ---- file the exploit challenge immediately, before the window can close ----
    print("Filing an exploit challenge with a matching bond...")
    submit_write(client, address, "challenge_defense_submission", [
        1,
        "https://example.com",
        int(sub1["defender_bond"]),
    ], challenger_account, "challenge_defense_submission#1 (matching bond)", log)

    bundle1 = read("get_tournament_bundle", [1])
    pending = [c for c in bundle1["challenges"] if c["status"] == "PENDING"]
    assert pending, "expected a pending challenge"
    challenge_id = int(pending[-1]["challenge_id"])
    v1 = vault()
    print("  vault with challenger bond locked:", v1)
    assert v1["invariant_ok"], v1

    # ---- second live evaluation gives a fallback leader if #1 is slashed ----
    print("Running live consensus evaluation on submission #2...")
    submit_consensus_write(client, address, "evaluate_submission_live", [2], peer_account,
                           "evaluate_submission_live#2", log)
    sub2 = submission(2)
    assert sub2["evaluated"] is True, sub2
    print(f"  sub2 band={sub2.get('defense_band')} anchor={sub2.get('robustness_anchor')} total={sub2.get('total_score')}")

    # ---- multi-signer endorsements ----
    print("Adding multi-signer community endorsements...")
    submit_write(client, address, "endorse_submission", [1], peer_account,
                 "endorse_submission#1 (peer signer)", log)
    submit_write(client, address, "endorse_submission", [2], challenger_account,
                 "endorse_submission#2 (challenger signer)", log)
    submit_write(client, address, "endorse_submission", [2], main_account,
                 "endorse_submission#2 (main signer)", log)

    submit_write(client, address, "post_arena_comment", [
        1, 1, "Challenger",
        "The policy leak gate looks solid, but I am probing the tool-abuse path.",
        "CHALLENGE",
    ], challenger_account, "post_arena_comment#1 (challenger signer)", log)

    # ---- wait for the challenge window to close ----
    clock = int(tournament(1)["challenge_window_clock"])
    wait = clock - int(time.time()) + 3
    if wait > 0:
        print(f"  waiting {wait}s for the challenge window to close...")
        time.sleep(wait)

    # ---- guard revert 2: settle an unevaluated tournament ----
    print("Guard revert 2: settle tournament #2 with no live-evaluated submission...")
    submit_write(client, address, "settle_tournament", [2], main_account,
                 "guard_revert_unevaluated_settle#2", log, expect_revert=True)
    t2_state = tournament(2)
    unevaluated_blocked = t2_state["status"] == "OPEN"
    assert unevaluated_blocked, "unevaluated tournament must stay OPEN"

    # ---- guard revert 3: settle while an exploit challenge is open ----
    print("Guard revert 3: settle tournament #1 while its exploit challenge is open...")
    submit_write(client, address, "settle_tournament", [1], main_account,
                 "guard_revert_open_challenge_settle#1", log, expect_revert=True)
    open_challenge_blocked = tournament(1)["status"] == "OPEN"
    assert open_challenge_blocked, "open challenge must block settlement"

    # ---- resolve the exploit challenge with live consensus ----
    print("Resolving the exploit challenge with live consensus...")
    submit_consensus_write(client, address, "resolve_exploit_challenge_live", [challenge_id],
                           main_account, f"resolve_exploit_challenge_live#{challenge_id}", log)
    resolved = read("get_challenge", [challenge_id])
    assert resolved.get("status") != "PENDING", resolved
    print(f"  challenge status={resolved.get('status')} band={resolved.get('defense_band')}")
    v2 = vault()
    print("  vault after challenge resolution:", v2)
    assert v2["invariant_ok"], v2

    # ---- settle the tournament ----
    print("Settling tournament #1 to the invariant winner...")
    winner_expected = tournament(1)["current_leader"]
    prize_before = balance(winner_expected)
    submit_write(client, address, "settle_tournament", [1], main_account,
                 "settle_tournament#1 (invariant winner)", log)
    t1_settled = tournament(1)
    winner = t1_settled["winner"]
    assert winner == winner_expected, "settlement winner must equal the stored leader"
    winner_sub = None
    for sid in (1, 2):
        s = submission(sid)
        if s["player"] == winner:
            winner_sub = s
    assert winner_sub is not None and winner_sub["evaluated"] and not winner_sub["slashed"], winner_sub
    print(f"  winner {winner} via submission #{winner_sub['submission_id']}")

    winner_acct = main_account if winner.lower() == main_account.address.lower() else peer_account
    time.sleep(2)
    prize_after = balance(winner)
    print(f"  winner AGT balance {prize_before} -> {prize_after}")

    # ---- transfer_tokens proves the prize receipt is spendable ----
    print("Transferring part of the prize receipt to the peer ledger...")
    transfer_to = main_account.address if winner_acct is peer_account else peer_account.address
    submit_write(client, address, "transfer_tokens", [transfer_to, 500], winner_acct,
                 "transfer_tokens (prize receipt)", log)

    # ---- guard revert 4: post-settlement endorsement ----
    print("Guard revert 4: endorse a submission after settlement...")
    pre_endorse = submission(int(winner_sub["submission_id"]))
    submit_write(client, address, "endorse_submission", [int(winner_sub["submission_id"])],
                 challenger_account, "guard_revert_post_settle_endorse", log, expect_revert=True)
    post_endorse = submission(int(winner_sub["submission_id"]))
    endorse_blocked = post_endorse["endorsements"] == pre_endorse["endorsements"]
    assert endorse_blocked, "post-settlement endorsement must not apply"

    # ---- liveness recovery: cancel the stalled unevaluated tournament ----
    print("Recovering the stalled tournament: permissionless cancel and refund...")
    _, recovery_tx = submit_write(client, address, "cancel_tournament", [2], challenger_account,
                                  "cancel_tournament#2 (stalled recovery by third party)", log)
    stalled_recovered = tournament(2)["status"] == "CANCELLED"
    assert stalled_recovered, "stalled tournament must be cancellable after the window"

    # ---- final reads ----
    v3 = vault()
    stats = read("get_arena_stats")
    bundle1 = read("get_tournament_bundle", [1])
    bundle2 = read("get_tournament_bundle", [2])
    leaderboard = read("get_leaderboard")

    print("\nFinal on-chain state:")
    print("  stats:", stats)
    print("  vault invariant:", v3)
    print("  T1:", tournament(1)["status"], "winner", winner)
    print("  T2:", tournament(2)["status"], "stalled recovery:", stalled_recovered)

    guard_reverts = [
        {"name": "premature_settlement_before_window", "blocked": premature_blocked},
        {"name": "unevaluated_leader_settlement", "blocked": unevaluated_blocked},
        {"name": "settlement_with_open_challenge", "blocked": open_challenge_blocked},
        {"name": "post_settlement_endorsement", "blocked": endorse_blocked},
    ]

    evidence = {
        "milestone": "v1",
        "network": "studionet",
        "chain_id": 61999,
        "rpc": "https://studio.genlayer.com/api",
        "contract_address": address,
        "explorer_url": f"https://explorer-studio.genlayer.com/address/{address}",
        "deploy_tx": deploy_tx,
        "deploy_status": deploy_receipt.get("status_name"),
        "deploy_consensus_result": deploy_receipt.get("result_name"),
        "signers": {
            "main": main_account.address,
            "peer": peer_account.address,
            "challenger": challenger_account.address,
        },
        "sha256": {
            "local_lf_file": hash_local,
            "deploy_payload": hash_deploy,
            "onchain_explorer_code": hash_chain,
            "local_deploy_onchain_match": three_way_match,
            "git_blob": None,
            "remote_github_blob": None,
            "four_way_match": False,
            "explorer_deployment_tx": deployment_tx,
        },
        "transactions": log,
        "guard_reverts": guard_reverts,
        "stalled_recovery": {
            "tournament_id": 2,
            "tx_hash": recovery_tx,
            "recovered": stalled_recovered,
            "triggered_by": challenger_account.address,
        },
        "vault_checks": {
            "after_funding_and_bonds": v0,
            "with_challenger_bond": v1,
            "after_challenge_resolution": v2,
            "final": v3,
        },
        "live_evaluation": {
            "submission_1": {
                "band": sub1.get("defense_band"),
                "anchor": sub1.get("robustness_anchor"),
                "total_score": sub1.get("total_score"),
                "rationale": sub1.get("judge_rationale"),
            },
            "submission_2": {
                "band": sub2.get("defense_band"),
                "anchor": sub2.get("robustness_anchor"),
                "total_score": sub2.get("total_score"),
                "rationale": sub2.get("judge_rationale"),
            },
            "challenge": resolved,
        },
        "prize_receipt": {
            "winner": winner,
            "balance_before_read": prize_before,
            "balance_after_read": prize_after,
        },
        "final_state": {
            "arena_stats": stats,
            "tournament_1": bundle1,
            "tournament_2": bundle2,
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
        and v3["invariant_ok"]
        and stats.get("total_tournaments", 0) == 2
        and stats.get("total_submissions", 0) == 3
        and stats.get("evaluated_submissions", 0) >= 2
        and stats.get("total_endorsements", 0) >= 3
        and stats.get("total_challenges", 0) >= 1
        and stats.get("settled", 0) >= 1
        and stalled_recovered
        and all(g["blocked"] for g in guard_reverts)
    )
    print("DEPLOY+SEED OK:", ok)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
