# AegisArena Adversarial Security Review

Reviewer posture: every party that can call the contract is treated as
adversarial, including tournament creators, submitting players, endorsers,
commenters, and the content returned by any fetched `reference_url`.

## 0. Steward fixes (reviewer "zoefunds")

This release resolves every point raised by the steward. Each fix is pinned by a
named direct test in `tests/test_aegis_arena_direct.py` and exercised on live
studionet by `tests/test_aegis_arena_integration.py` and
`scripts/deploy_studionet.py`.

1. No creator/owner scoring bypass. `score_tactic_deterministic` is deleted from
   the contract. The only path that flips `submission.evaluated` to True and sets
   `ai_verdict_score` is `evaluate_tactic_live`, which runs the neutral live
   GenLayer consensus evaluation. Proven by
   `test_no_creator_or_owner_scoring_bypass_exists`.
2. Live consensus is required before settlement. `settle_tournament` re-runs the
   leader invariant and reverts with
   `"cannot settle tournament without a live-evaluated winning submission"` unless
   the winning submission completed `evaluate_tactic_live`. Proven by
   `test_cannot_settle_without_live_evaluated_submission` and
   `test_unevaluated_submission_with_endorsements_cannot_become_leader_or_win`.
3. One consistent score invariant. The stored ranking score and the settlement
   winner are always the same value:
   `total_score = min(100, deterministic_score + ai_verdict_score + endorsements * 2)`.
   A single helper `_sync_leader_if_evaluated` recomputes `best_score` and
   `current_leader` from that invariant, considering only live-evaluated
   submissions and breaking ties by earliest `submission_id`. It runs at the end
   of `evaluate_tactic_live` and `endorse_submission`, and again inside
   `settle_tournament`. Proven by
   `test_endorsement_updates_stored_leader_and_settlement_winner_consistently`
   and `test_evaluate_makes_the_submission_the_leader`.
4. Endorsements are frozen once a tournament leaves OPEN. `endorse_submission`
   requires `status == "OPEN"` and reverts with
   `"cannot endorse submission after tournament is settled or cancelled"`
   otherwise, so no post-settlement endorsement can move the winner. Proven by
   `test_endorse_reverts_after_tournament_settled_or_cancelled`.
5. Rock-solid verdict consensus. The LLM rubric score is snapped onto a fixed
   5-point grid (`0, 5, 10, ..., 60`) inside `evaluate_tactic_live`, and the
   `gl.eq_principle.prompt_comparative` principle requires validators to agree on
   the exact same quantized integer. Proven by
   `test_evaluate_quantizes_verdict_to_five_point_grid`.

## 1. State machine table

Tournament lifecycle:

| Status | create_tournament | submit_tactic | evaluate_tactic_live | endorse_submission | post_arena_comment | settle_tournament | cancel_tournament |
|--------|-------------------|---------------|----------------------|--------------------|--------------------|-------------------|-------------------|
| OPEN | creates OPEN | allowed (token gate); records score, never takes the lead | allowed (not evaluated); makes the submission eligible to lead | allowed (OPEN only, non self, unique); recomputes score and re-syncs leader | allowed | allowed only if a live-evaluated leader exists | allowed if entry_count == 0 |
| SETTLED | n/a | rejected | rejected (not OPEN) | rejected (not OPEN) | allowed | rejected (not OPEN) | rejected (not OPEN) |
| CANCELLED | n/a | rejected | rejected (not OPEN) | rejected (not OPEN) | allowed | rejected (not OPEN) | rejected (not OPEN) |

Transitions:
- OPEN to SETTLED via `settle_tournament` (creator or owner, entry_count > 0, and
  a live-evaluated submission must exist).
- OPEN to CANCELLED via `cancel_tournament` (creator or owner, entry_count == 0).
- No transition leaves SETTLED or CANCELLED.

## 2. Liveness: no stuck state

The contract holds no external value (no GEN, no ERC token). `player_points` is
a non-monetary reputation ledger minted by protocol rules, and
`prize_pool_points` is an integer award recorded to that ledger on settlement.
There is therefore no locked-funds or overdraft path.

Every OPEN tournament has an exit:
- If it gains at least one live-evaluated entry, the creator or owner can
  `settle_tournament`.
- If it stays empty, the creator or owner can `cancel_tournament`.
- An OPEN tournament with only unevaluated entries cannot be settled (it would
  pay an unverified winner), so the creator either runs `evaluate_tactic_live`
  on an entry, keeps it open for evaluation, or leaves it. Because there are no
  funds locked, this is not a stuck-funds condition. `cancel_tournament` requires
  `entry_count == 0`, so a creator cannot erase a live tournament with
  participants to dodge a payout.

## 3. Race conditions between competing transitions

- `settle_tournament` vs `cancel_tournament`: mutually exclusive by
  `entry_count` (settle needs > 0, cancel needs == 0) and both need OPEN. No
  ordering ambiguity.
- `evaluate_tactic_live` double call: guarded by `submission.evaluated`; the
  second call reverts `"submission already evaluated"`. Proven by
  `test_evaluate_rejects_double`.
- `endorse_submission` double call: guarded by `has_endorsed` keyed by
  `(submission_id, sender)`. Duplicate rejects.
- Post-settlement mutation: `settle_tournament` recomputes the leader from the
  score invariant and then flips status to SETTLED; after that, `submit_tactic`,
  `evaluate_tactic_live` and `endorse_submission` all reject a non-OPEN
  tournament, so the winner can no longer move.
- Endorse-then-settle and settle-then-endorse: `_sync_leader_if_evaluated` is
  re-run inside `settle_tournament`, so a settled winner always equals the last
  invariant-consistent leader; and `endorse_submission` refuses to run once the
  status is not OPEN, so no endorsement can race a settlement.

## 4. Accounting invariants

Invariant enforced: the leaderboard score, the stored leader, and the settlement
winner are one and the same deterministic value.

- `evaluated` is set to True only by `evaluate_tactic_live`; after True no path
  rewrites `ai_verdict_score`.
- `total_score` always equals `min(100, deterministic_score + ai_verdict_score +
  endorsements * 2)`, recomputed from first principles in both
  `evaluate_tactic_live` and `endorse_submission`.
- `best_score` and `current_leader` are derived solely by
  `_sync_leader_if_evaluated`, which scans every live-evaluated submission and
  picks the highest `total_score` (earliest `submission_id` wins a tie). An
  unevaluated submission can never lead, regardless of endorsements.
- `settle_tournament` pays exactly `current_leader`, which after the final
  `_sync_leader_if_evaluated` is guaranteed to be a live-evaluated submission.
- `settle_tournament` credits `prize_pool_points` once because SETTLED blocks a
  second settle, and it increments `player_wins` once for the same reason.
- Every score is clamped: deterministic 0..40, AI verdict 0..60 on a 5-point
  grid, total 0..100.

## 5. Input validation at every entry point

- `title` 1..100, `challenge_brief` 1..1000, `mandatory_fact_token` 1..64,
  all rejected (not clamped) when out of range.
- `reference_url` 8..512, must start with `http://` or `https://`, and is
  rejected if it contains whitespace or control characters.
- `prize_pool_points` bounded 100..1000000 with both a floor and a ceiling.
- `moniker` 1..32, `tactic_payload` 10..1500, `message` 1..280.
- `stance` rejected unless it is one of COMMEND, CHALLENGE, ANALYSIS.
- Access control: `settle` and `cancel` are restricted to the tournament creator
  or contract owner; scoring is restricted to the neutral consensus path.
- Cross-object consistency: `post_arena_comment` rejects a submission that does
  not belong to the stated tournament; `endorse_submission` looks up the parent
  tournament and requires it to be OPEN.

## 6. Consensus safety (GenLayer)

- `evaluate_tactic_live` snapshots all storage (brief, url, token, payload,
  deterministic score and endorsements) before the non-deterministic block, and
  performs zero storage reads inside `gl.eq_principle.prompt_comparative`.
- All fetched and supplied text (reference page, payload, brief, and the
  creator-controlled mandatory token) is control-character stripped and
  delimiter defused before it is interpolated into the judge prompt.
- The verdict is quantized onto the fixed 5-point grid, and the equivalence
  principle requires validators to agree on the exact quantized integer
  `ai_verdict_score` (only the rationale may differ). This removes the old
  tolerance band that let different validators settle on different scores, so the
  value that drives the leader and the winner is one deterministic integer.
- Fail-closed: if the reference page cannot be fetched or the LLM returns a
  non-parseable score, the transaction raises a UserError and applies no state
  change, so a submission cannot be silently awarded.

## 7. Findings

FIXED - Creator-controlled token injection. The mandatory token was
interpolated raw into the judge prompt, letting a creator smuggle wrapper
closing tags. Now defused with the same routine as the other inputs.
Proven by `test_evaluate_survives_malicious_token`.

FIXED - Creator/owner scoring bypass. `score_tactic_deterministic` let a creator
or owner mark a submission evaluated and set its verdict score without live
consensus, and could be used to pre-empt the neutral path. The method is removed;
only `evaluate_tactic_live` can mark a submission evaluated. Proven by
`test_no_creator_or_owner_scoring_bypass_exists`.

FIXED - Settlement on an unverified winner. `settle_tournament` previously paid
`current_leader` even when no submission had completed live consensus. It now
recomputes the invariant and reverts unless a live-evaluated winner exists.
Proven by `test_cannot_settle_without_live_evaluated_submission`.

FIXED - Leader/winner score divergence. Previously a submission could take the
lead at submission time, and endorsements updated `total_score` without updating
the leader, so the ranking and the settlement winner could disagree. Now the lead
is only ever held by a live-evaluated submission and `_sync_leader_if_evaluated`
keeps `best_score` and `current_leader` equal to the invariant on every score
change. Proven by
`test_endorsement_updates_stored_leader_and_settlement_winner_consistently` and
`test_unevaluated_submission_with_endorsements_cannot_become_leader_or_win`.

FIXED - Post-settlement endorsement. `endorse_submission` now requires the parent
tournament to be OPEN, so an endorsement can never change a score or the winner
after settlement or cancellation. Proven by
`test_endorse_reverts_after_tournament_settled_or_cancelled`.

## 8. Open items (honest status)

OPEN - Validator agreement is not proven by direct tests. Direct mode runs the
leader path only, so the mock-based `evaluate_tactic_live` tests confirm the
leader logic and prompt construction but do NOT confirm that independent
validators reach consensus on the live web fetch and the quantized score. This is
covered by the studionet integration test in
`tests/test_aegis_arena_integration.py` and the live seeded deployment, which
must be run against the real network.

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
