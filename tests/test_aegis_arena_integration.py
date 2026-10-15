"""Live integration test against GenLayer studionet (full validator consensus).

Off by default so the fast direct suite stays offline. To run:

    set RUN_STUDIONET_INTEGRATION=1 && python -m pytest tests/test_aegis_arena_integration.py -v -s

Requires network egress to studio.genlayer.com. Uses the main .env signer as the
owner/creator and exercises the non-deterministic evaluate_tactic_live path with
real validator consensus, plus one attack path (self-endorsement must not apply).
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
TOKEN = "EXAMPLE DOMAIN"
PAYLOAD = (
    "Anchor the briefing on the EXAMPLE DOMAIN page from IANA, which documents that the "
    "domain is reserved for illustrative use and must not be used in operations. Cite that "
    "constraint, then map it to a defensive playbook: verify the canonical source, log the "
    "reference hash, and reject any lookalike domain in the runbook. Keep the plan concise."
)


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

    yield client, acct, address, write, read


def test_integration_full_lifecycle(arena):
    from genlayer_py.types import TransactionStatus  # noqa: F401

    client, acct, address, write, read = arena
    assert address.startswith("0x")

    # 1. create tournament pointing at a real, stable public source
    _, rc = write("create_tournament", [
        "Source Ver drill: Example Domain",
        "Prove you can ground a tactical brief in the live reference page.",
        "https://example.com",
        TOKEN,
        4000,
    ])
    assert rc.get("result_name") == "MAJORITY_AGREE"

    # 2. submit a token-bearing tactic
    _, rc = write("submit_tactic", [1, "Auditor", PAYLOAD])
    subs = read("get_tournament_submissions", [1])
    assert len(subs) == 1
    det = subs[0]["deterministic_score"]
    assert 0 <= det <= 40

    # 3. live consensus evaluation (non-deterministic: web render + LLM judged by validators)
    _, rc = write("evaluate_tactic_live", [1], leader_only=False)
    assert rc.get("status_name") == "FINALIZED", rc
    assert rc.get("result_name") == "MAJORITY_AGREE", rc
    subs = read("get_tournament_submissions", [1])
    assert subs[0]["evaluated"] is True
    assert 0 <= subs[0]["ai_verdict_score"] <= 60
    assert 0 <= subs[0]["total_score"] <= 100
    assert subs[0]["judge_rationale"] != ""

    # 4. attack path: self-endorsement must not apply any state change
    before = read("get_tournament_submissions", [1])[0]["endorsements"]
    write("endorse_submission", [1])  # acct is the submitter -> should revert on-chain
    after = read("get_tournament_submissions", [1])[0]["endorsements"]
    assert after == before, "self-endorsement must not change endorsements"

    # 5. happy path settle locks the winner
    _, rc = write("settle_tournament", [1])
    t = read("get_tournament", [1])
    assert t["status"] == "SETTLED"
    assert t["winner"] == acct.address
    board = read("get_leaderboard")
    assert any(row["address"] == acct.address and row["wins"] >= 1 for row in board)


def test_integration_stats_consistent(arena):
    _, _, _, _, read = arena
    stats = read("get_arena_stats")
    assert stats["total_tournaments"] >= 1
    assert stats["settled"] >= 1
    assert stats["evaluated_submissions"] >= 1
