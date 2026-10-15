# AegisArena Adversarial Security Review

Reviewer posture: every party that can call the contract is treated as
adversarial, including tournament creators, submitting players, endorsers,
commenters, and the content returned by any fetched `reference_url`.

## 1. State machine table

Tournament lifecycle:

| Status | create_tournament | submit_tactic | evaluate_tactic_live | score_tactic_deterministic | endorse_submission | post_arena_comment | settle_tournament | cancel_tournament |
|--------|-------------------|---------------|----------------------|----------------------------|--------------------|--------------------|-------------------|-------------------|
| OPEN | creates OPEN | allowed (token gate) | allowed (not evaluated) | allowed by creator/owner (not evaluated) | allowed (non self, unique) | allowed | allowed if entry_count > 0 | allowed if entry_count == 0 |
| SETTLED | n/a | rejected | rejected (not OPEN) | rejected (not OPEN) | allowed for archive | allowed | rejected (not OPEN) | rejected (not OPEN) |
| CANCELLED | n/a | rejected | rejected (not OPEN) | rejected (not OPEN) | allowed for archive | allowed | rejected (not OPEN) | rejected (not OPEN) |

Transitions:
- OPEN to SETTLED via `settle_tournament` (creator or owner, entry_count > 0).
- OPEN to CANCELLED via `cancel_tournament` (creator or owner, entry_count == 0).
- No transition leaves SETTLED or CANCELLED.

## 2. Liveness: no stuck state

The contract holds no external value (no GEN, no ERC token). `player_points` is
a non-monetary reputation ledger minted by protocol rules, and
`prize_pool_points` is an integer award recorded to that ledger on settlement.
There is therefore no locked-funds or overdraft path.

Every OPEN tournament has an exit:
- If it gains at least one entry, the creator or owner can `settle_tournament`.
- If it stays empty, the creator or owner can `cancel_tournament`.

Abandoned-state check: an OPEN tournament with entries where the creator never
settles simply remains on the leaderboard; there are no funds to release, so
this is not a lockup. `cancel_tournament` requires `entry_count == 0`, so a
creator cannot erase a live tournament with participants to dodge a payout.

## 3. Race conditions between competing transitions

- `settle_tournament` vs `cancel_tournament`: mutually exclusive by
  `entry_count` (settle needs > 0, cancel needs == 0) and both need OPEN. No
  ordering ambiguity.
- `evaluate_tactic_live` vs `score_tactic_deterministic`: both require
  `evaluated == False` and `status == OPEN`. Whichever runs first flips
  `evaluated` to True, so the second is rejected. No double scoring.
- `endorse_submission` double call: guarded by `has_endorsed` keyed by
  `(submission_id, sender)`. Duplicate rejects.
- Post-settlement scoring: `score_tactic_deterministic` now also checks
  `status == OPEN`, so a settled tournament cannot have a still-unevaluated
  submission rescored to move `current_leader` after the winner is locked.

## 4. Accounting invariants

Invariant enforced: a submission is credited exactly once.

- `evaluated` is the single-shot flag for both judge paths; after True no path
  rewrites `ai_verdict_score` or re-adds points.
- Endorsements add a +2 community bonus only while `total_score < 100`
  (headroom-clamped) and never call `_update_leader`, so endorsements cannot
  change the tournament winner.
- `settle_tournament` credits `prize_pool_points` once because SETTLED blocks a
  second settle, and it increments `player_wins` once for the same reason.
- Every score is clamped: deterministic 0..40, AI verdict 0..60, total 0..100.

## 5. Input validation at every entry point

- `title` 1..100, `challenge_brief` 1..1000, `mandatory_fact_token` 1..64,
  all rejected (not clamped) when out of range.
- `reference_url` 8..512, must start with `http://` or `https://`, and is
  rejected if it contains whitespace or control characters.
- `prize_pool_points` bounded 100..1000000 with both a floor and a ceiling.
- `moniker` 1..32, `tactic_payload` 10..1500, `message` 1..280.
- `rubric_bonus` rejected when above 60 (not clamped).
- `stance` rejected unless it is one of COMMEND, CHALLENGE, ANALYSIS.
- Access control: `settle`, `cancel`, and `score_tactic_deterministic` are
  restricted to the tournament creator or contract owner.
- Cross-object consistency: `post_arena_comment` rejects a submission that does
  not belong to the stated tournament.

## 6. Consensus safety (GenLayer)

- `evaluate_tactic_live` snapshots all storage (brief, url, token, payload)
  before the non-deterministic block, and performs zero storage reads inside
  `gl.eq_principle.prompt_comparative`.
- All fetched and supplied text (reference page, payload, brief, and the
  creator-controlled mandatory token) is control-character stripped and
  delimiter defused before it is interpolated into the judge prompt.
- The verdict drives only a reputation score, and it is bounded 0..60 and
  clamped on parse. Because points are non-monetary, the comparative principle
  uses a documented 10-point tolerance rather than exact equality. A fully
  deterministic, exact-consensus path is available via
  `score_tactic_deterministic` for creators who need reproducible settlement.
- Fail-closed: if the reference page cannot be fetched or the LLM returns a
  non-parseable score, the transaction raises a UserError and applies no state
  change, so a submission cannot be silently awarded.

## 7. Findings

FIXED - Creator-controlled token injection. The mandatory token was
interpolated raw into the judge prompt, letting a creator smuggle wrapper
closing tags. Now defused with the same routine as the other inputs.
Proven by `test_evaluate_survives_malicious_token`.

FIXED - Post-settlement rubric scoring. `score_tactic_deterministic` lacked the
OPEN guard that `evaluate_tactic_live` had, so a settled tournament's last
unevaluated submission could still be rescored. Guard added. Proven by
`test_score_det_rejected_after_settle`.

ACCEPTED - Winner cannot be moved by endorsements. `endorse_submission`
intentionally does not touch `best_score` or `current_leader`; proven by
`test_endorse_by_other_adds_bonus` and `test_endorse_caps_total_at_100`.

## 8. Open items (honest status)

OPEN - Validator agreement is not proven by direct tests. Direct mode runs the
leader path only, so the mock-based `evaluate_tactic_live` tests confirm the
leader logic and prompt construction but do NOT confirm that independent
validators reach consensus on the live web fetch and LLM score. This is covered
by the studionet integration test in `tests/test_aegis_arena_integration.py`
and the live seeded deployment, which must be run against the real network.

OPEN - Reputation farming is inherent, not a bug. Because `player_points` is an
unbounded non-monetary ledger, a set of colluding burner accounts could inflate
points through many submissions and mutual endorsements. There is no financial
loss, but the leaderboard is a trust signal. If points ever gain monetary
value, cap per-address point minting or require staking; that is out of scope
for this non-custodial release.

OPEN - `reference_url` is fetched by validators' web renderer. The contract
trusts the GenLayer web sandbox for network isolation. It cannot itself prevent
a creator from pointing at a slow or hostile page; the render is truncated to
5000 characters and defused, and any fetch failure reverts rather than awarding.
