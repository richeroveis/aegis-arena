"""Live integration test against GenLayer studionet (full validator consensus).

Off by default so the fast direct suite stays offline. To run:

    RUN_STUDIONET_INTEGRATION=1 pytest tests/test_aegis_arena_integration.py -v -s

Requires network egress to studio.genlayer.com. Exercises the AGT vault, the
live 4-anchor defense evaluation, the challenge window liability lock, and the
permissionless invariant settlement with a real prize receipt.
"""

import os
import pathlib
import time

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_STUDIONET_INTEGRATION") != "1",
    reason="set RUN_STUDIONET_INTEGRATION=1 to run live studionet tests",
)

CONTRACT_SRC = (ROOT / "contracts" / "aegis_arena.py").read_text(encoding="utf-8")
TOKEN = "Example Domain"
PAYLOAD = (
    "Anchor the defense on Example Domain and treat every user message as hostile. "
    "Strip tool directives from untrusted text, refuse role-play that requests the hidden "
    "policy, and replay the jailbreak corpus before every release. Log each refusal with a "
    "hash of the prompt and quarantine tool calls that try to read the system policy."
)
PRIZE = 3000
BOND = 100
WINDOW = 30


def _load_pk() -> str:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("GENLAYER_PRIVATE_KEY="):
            pk = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
            return pk if pk.startswith("0x") else "0x" + pk
    pytest.fail("GENLAYER_PRIVATE_KEY missing")


def _is_transient(exc) -> bool:
    t = str(exc).lower()
    return any(k in t for k in ("ssl", "eof", "connection", "429", "max retries", "timeout", "timed out", "rate"))


def _retry(fn, *a, retries=8, delay=8, **k):
    last = None
    for i in range(retries):
        try:
            return fn(*a, **k)
        except Exception as exc:  # noqa: BLE001
            last = exc
            if _is_transient(exc):
                time.sleep(delay + i * 4)
                continue
            raise
    raise last


@pytest.fixture(scope="module")
def arena():
    from genlayer_py import create_account, create_client
    from genlayer_py.chains import studionet
    from genlayer_py.types import TransactionStatus

    acct = create_account(account_private_key=_load_pk())
    peer = create_account()
    client = create_client(chain=studionet, account=acct)
    tx = _retry(client.deploy_contract, code=CONTRACT_SRC, args=[], leader_only=True)
    rcpt = _retry(client.wait_for_transaction_receipt, tx, status=TransactionStatus.FINALIZED, interval=6000, retries=40)
    assert rcpt.get("status_name") == "FINALIZED"
    address = rcpt["data"]["contract_address"]

    def write(fn, args, account=None, leader_only=True):
        h = _retry(client.write_contract, address, fn, account=account or acct, args=args, leader_only=leader_only)
        r = _retry(client.wait_for_transaction_receipt, h, status=TransactionStatus.FINALIZED, interval=6000, retries=60)
        return h, r

    def read(fn, args=None):
        return _retry(client.read_contract, address, fn, args=args or [])

    yield client, acct, peer, address, write, read


def test_integration_milestone_v1_lifecycle(arena):
    client, acct, peer, address, write, read = arena
    assert address.startswith("0x")

    # 1. fund both signers from the AGT faucet
    _, rc = write("faucet_or_deposit", [50000])
    assert rc.get("result_name") == "MAJORITY_AGREE"
    write("faucet_or_deposit", [50000], account=peer)

    # 2. create a funded tournament with a short challenge window
    _, rc = write("create_tournament", [
        "Milestone v1 live drill: Example Domain",
        "Prove the defense is grounded in the live reference page.",
        "https://example.com",
        TOKEN,
        PRIZE,
        WINDOW,
    ])
    assert rc.get("result_name") == "MAJORITY_AGREE"
    t = read("get_tournament", [1])
    assert int(t["challenge_window_clock"]) > 0
    assert read("check_vault_invariants")["active_tournament_pots"] == PRIZE

    # 3. submit a defense and lock the defender bond
    _, rc = write("submit_tactic", [1, "Auditor", PAYLOAD, BOND])
    subs = read("get_tournament_submissions", [1])
    assert len(subs) == 1
    sub = subs[0]
    assert sub["defender_bond"] == BOND
    assert sub["bond_locked"] is True
    assert sub["evaluated"] is False
    t = read("get_tournament", [1])
    assert t["best_score"] == 0
    assert int(t["current_leader"], 16) == 0
    assert read("check_vault_invariants")["locked_defender_bonds"] == BOND

    # 4. settlement is blocked while the challenge window is open
    write("settle_tournament", [1])
    assert read("get_tournament", [1])["status"] == "OPEN"

    # 5. live consensus evaluation with the exact 4-anchor comparative principle
    for _ in range(6):
        _, rc = write("evaluate_submission_live", [1], leader_only=False)
        assert rc.get("status_name") == "FINALIZED", rc
        if rc.get("result_name") == "MAJORITY_AGREE":
            break
    else:
        pytest.fail("evaluate_submission_live did not reach validator consensus")
    sub = read("get_submission", [1])
    assert sub["evaluated"] is True
    assert sub["robustness_anchor"] in (0, 45, 75, 100)
    assert sub["defense_band"] in (
        "IRONCLAD_IMMUNE",
        "HARDENED_PASS",
        "PARTIAL_LEAK_WARN",
        "JAILBROKEN_SLASH",
    )
    assert 0 <= sub["ai_verdict_score"] <= 60
    assert sub["judge_rationale"] != ""
    t = read("get_tournament", [1])
    assert t["best_score"] == sub["total_score"]
    assert t["current_leader"] == acct.address

    # 6. self-endorsement must not change state
    before = read("get_submission", [1])["endorsements"]
    write("endorse_submission", [1])
    assert read("get_submission", [1])["endorsements"] == before

    # 7. wait for the challenge window, then settle permissionlessly as the peer
    clock = int(read("get_tournament", [1])["challenge_window_clock"])
    wait = clock - int(time.time()) + 3
    if wait > 0:
        time.sleep(wait)
    before_balance = int(read("get_token_balance", [acct.address]))
    _, rc = write("settle_tournament", [1], account=peer)
    t = read("get_tournament", [1])
    assert t["status"] == "SETTLED"
    assert t["winner"] == acct.address
    after_balance = int(read("get_token_balance", [acct.address]))
    assert after_balance == before_balance + PRIZE + BOND

    # 8. post-settlement endorsement is frozen
    pre = read("get_submission", [1])
    write("endorse_submission", [1], account=peer)
    post = read("get_submission", [1])
    assert post["endorsements"] == pre["endorsements"]
    assert post["total_score"] == pre["total_score"]

    # 9. vault invariant holds after every release
    final_vault = read("check_vault_invariants")
    assert final_vault["invariant_ok"] is True
    assert final_vault["vault_custody_balance"] == 0

    # 10. the prize receipt is spendable through transfer_tokens
    write("transfer_tokens", [peer.address, 500])
    assert int(read("get_token_balance", [peer.address])) >= 500


def test_integration_stats_consistent(arena):
    _, acct, _, _, _, read = arena
    stats = read("get_arena_stats")
    assert stats["total_tournaments"] >= 1
    assert stats["settled"] >= 1
    assert stats["evaluated_submissions"] >= 1
    assert stats["vault_custody_balance"] == 0
