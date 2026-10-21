# AegisArena Milestone v1 Adversarial Security Review

Reviewer posture: every party that can call the contract is adversarial, including
tournament creators, defenders, red-team challengers, endorsers, commenters, and any
content returned by a fetched benchmark or exploit proof URL.

## 0. Steward red lines

1. Zero owner or creator bypass. There is no `owner` field and no deterministic scoring
   method. The only path that marks a submission evaluated and assigns a defense band is
   `evaluate_submission_live`, which runs the neutral live consensus evaluation.
   `settle_tournament` is permissionless and pays only the invariant-derived leader.
   Proven by `test_no_owner_or_deterministic_backdoor_exists` and
   `test_creator_cannot_bypass_live_evaluation`.
2. Mandatory live consensus before leadership or payout. A submission cannot lead, win, or
   receive the prize until it has completed `evaluate_submission_live`. Settlement reverts
   with `cannot settle without a live-evaluated, un-slashed winning submission` otherwise.
   Proven by `test_settle_requires_live_evaluated_leader`.
3. One consistent ranking and settlement invariant. The stored leader, `best_score` and the
   settlement winner all come from `_sync_leader_if_evaluated`, which only considers
   evaluated, un-slashed submissions and uses
   `min(100, deterministic_score + ai_verdict_score + endorsements * 2)`. Proven by
   `test_evaluate_makes_submission_leader`, `test_endorse_adds_bonus_and_syncs_leader` and
   `test_settle_winner_matches_stored_leader`.
4. Score-changing endorsements are frozen after settlement. Proven by
   `test_endorse_rejected_after_settlement`.

## 1. State machine

Tournament lifecycle:

| Status | submit_tactic | evaluate_submission_live | challenge_defense_submission | resolve_exploit_challenge_live | endorse_submission | settle_tournament | cancel_tournament |
|---|---|---|---|---|---|---|---|
| OPEN, window open | allowed with bond | allowed if window open | allowed with matching bond | allowed for a pending challenge | allowed | rejected (window open) | allowed only if empty |
| OPEN, window closed | rejected | rejected | rejected | allowed for a pending challenge | allowed (scores still rematerialize) | allowed only if no pending challenge and a live leader exists | allowed if empty, or stalled with no live leader and no pending challenge |
| SETTLED | rejected | rejected | rejected | rejected | rejected | rejected | rejected |
| CANCELLED | rejected | rejected | rejected | rejected | rejected | rejected | rejected |

Challenge lifecycle: `PENDING` to `RESOLVED_SLASHED` (exploit reproduced, defender bond
paid to challenger) or `RESOLVED_UPHELD` (defense holds, challenger bond forfeited to the
defender). No transition leaves a resolved challenge.

## 2. Fund custody and liveness

The contract now holds real AGT test custody. `vault_custody_balance` is the locked
liability vault:

```
vault_custody_balance == active_tournament_pots
                      + locked_defender_bonds
                      + locked_challenger_bonds
```

`check_vault_invariants()` returns every term and an `invariant_ok` flag. It is asserted
after funding, defense submission, challenge staking, challenge resolution and settlement
in `test_create_locks_prize_in_vault`, `test_submit_locks_defender_bond_in_vault`,
`test_challenge_locks_challenger_bond_in_vault`, `test_settle_releases_all_vault_liabilities`
and `test_vault_invariant_view_shape`.

`token_balances` is the liquid AGT ledger for faucet credits, transfers and prize receipts.
`faucet_or_deposit` mints test credit into that ledger without touching the locked vault.
`transfer_tokens` moves liquid credit only and never changes the vault
(`test_transfer_does_not_change_vault`).

The PAPITO max-liability rule keeps 100 percent of the pot, defender bonds and challenger
bonds locked until the challenge window closes and every challenge is resolved. Settlement
reverts while the window is open (`test_settle_reverts_before_challenge_window_closes`) and
while a challenge is pending (`test_settle_blocked_while_challenge_open`).

Liveness recovery: an OPEN tournament whose entries were never evaluated after the window
closes can never settle. `cancel_tournament` is permissionless and, once the window is
closed, no challenge is pending and no live-evaluated leader exists, it refunds the pot to
the creator and every locked defender bond to its defender
(`test_cancel_stalled_refunds_pot_and_bonds`). The recovery is blocked as soon as a live
leader exists (`test_cancel_stalled_rejected_with_live_leader`) or a challenge is pending
(`test_cancel_stalled_rejected_with_open_challenge`), so a creator cannot rug an evaluated
winner. An empty tournament can also be cancelled permissionlessly at any time
(`test_cancel_empty_is_permissionless`).

## 3. Race conditions

- `challenge_defense_submission` vs `resolve_exploit_challenge_live`: a submission accepts
  only one open challenge (`active_challenge_id`), and resolution requires `PENDING`.
  Proven by `test_challenge_rejects_duplicate_open` and `test_resolve_rejects_non_pending`.
- `settle_tournament` vs an open challenge: settlement requires
  `active_challenges == 0`, so a pending challenge always blocks payout.
- `settle_tournament` vs the window clock: settlement uses `now >= challenge_window_clock`,
  and submission, evaluation and challenge filing use `now < challenge_window_clock`, so
  the guards are mutually exclusive at the boundary
  (`test_settle_boundary_opens_at_exact_clock`).
- Double settlement: SETTLED blocks a second call (`test_double_settle_rejected`).
- Double evaluation: `evaluated` blocks a second call (`test_evaluate_rejects_double`).
- Post-settlement endorsement: status guard blocks any score change
  (`test_endorse_rejected_after_settlement`).

## 4. Accounting invariants

- A submission is credited once: `evaluated` is flipped only in
  `evaluate_submission_live`, and a slashed submission can no longer be evaluated
  (`test_slashed_submission_cannot_be_evaluated`).
- The defender bond is released exactly once: either refunded at settlement or paid to a
  successful challenger, then `bond_locked` is set to False.
- A challenger bond is released exactly once: refunded on a successful slash or forfeited
  to the defender on an upheld challenge.
- Settlement pays `prize_pool_points` once because SETTLED blocks a second call.
- Scores are clamped: deterministic 0..40, AI contribution 0..60, total 0..100.

## 5. Input validation

- `title` 1..100, `challenge_brief` 1..1000, `mandatory_fact_token` 1..64.
- `reference_url` and `exploit_proof_url` 8..512, must start with `http://` or
  `https://`, and reject spaces or control characters.
- `prize_pool_points` 100..1000000, `defender_bond` 10..1000000, `faucet` 1..1000000.
- `challenge_window_seconds` 30..86400 with both a floor and a ceiling
  (`test_create_rejects_short_challenge_window`,
  `test_create_rejects_long_challenge_window`).
- `moniker` 1..32, `tactic_payload` 10..1500, `message` 1..280, `stance` restricted.
- Address strings are parsed into `Address` and reject malformed hex.

## 6. Consensus safety (GenLayer)

- `evaluate_submission_live` and `resolve_exploit_challenge_live` snapshot every storage
  value into plain locals before the non-deterministic block. The closure performs zero
  storage reads. Proven structurally and by the direct tests that run the leader path.
- Both paths fetch evidence with `gl.nondet.web.render(url, mode="text")`, strip control
  characters and defuse delimiter injection before interpolation.
- The robustness anchor is quantized onto the discrete ladder `0, 45, 75, 100`, and
  `_compute_defense_standing` derives the band inside the closure. The principle requires
  exact agreement on `defense_band`, `robustness_anchor` and `exploit_reproduced`.
- A JAILBROKEN verdict is only possible when a challenger supplied exploit proof and the
  judge reproduced it. Benchmark evaluation cannot declare a jailbreak.
- Fail closed: missing or non-numeric anchors raise a UserError and apply no state change
  (`test_evaluate_fails_closed_on_missing_anchor`,
  `test_evaluate_fails_closed_on_non_dict`,
  `test_evaluate_fails_closed_on_non_numeric_anchor`).

## 7. Findings

FIXED - Creator and owner scoring bypass. The old `score_tactic_deterministic` and the
`owner` field are removed. Only `evaluate_submission_live` can set a defense standing.
Proven by `test_no_owner_or_deterministic_backdoor_exists`.

FIXED - Unverified settlement. Settlement requires a live-evaluated, un-slashed leader and
re-runs the invariant immediately before paying. Proven by
`test_settle_requires_live_evaluated_leader`.

FIXED - Leader and winner divergence. Endorsements and challenge re-audits both call
`_sync_leader_if_evaluated`, so the ranking and settlement winner never disagree. Proven by
`test_endorse_adds_bonus_and_syncs_leader` and `test_settle_winner_matches_stored_leader`.

FIXED - Post-settlement score changes. Endorsements are frozen after settlement. Proven by
`test_endorse_rejected_after_settlement`.

FIXED - Unbacked bonds and prizes. All pot, defender bond and challenger bond movements are
mirrored in `vault_custody_balance`, and the invariant view proves conservation. Proven by
the vault tests listed in section 2.

FIXED - Successful exploit challenge. A reproduced jailbreak slashes the defender bond to
the challenger, refunds the challenger bond, zeroes the submission score and disqualifies
it from leadership. Proven by `test_resolve_slash_moves_bond_and_disqualifies` and
`test_resolve_slash_pays_challenger_both_bonds`.

FIXED - Frivolous challenge penalty. A failed challenge forfeits the challenger bond to the
defender while the defender bond stays locked. Proven by
`test_resolve_upheld_forfeits_challenger_bond_to_defender`.

FIXED - Stalled tournament lockup. An OPEN tournament whose entries were never evaluated
after the window closed had no exit, which would lock the pot and defender bonds forever.
`cancel_tournament` now has a permissionless stalled recovery that refunds the pot and every
locked defender bond, and is blocked while a live leader or a pending challenge exists.
Proven by `test_cancel_stalled_refunds_pot_and_bonds`,
`test_cancel_stalled_rejected_with_live_leader` and
`test_cancel_stalled_rejected_with_open_challenge`.

## 8. Open items (honest status)

OPEN - Direct mode proves the leader path only. It does not prove that independent
validators agree on the live web fetch and the LLM verdict. That is covered by the live
studionet integration test and the seeded deployment, which record `FINALIZED` and
`MAJORITY_AGREE` transactions in `evidence/studionet_deployment.json`.

OPEN - Exact consensus can occasionally end in `MAJORITY_DISAGREE`. That is a clean
rollback with no state change, and the deploy script and integration test retry the
transaction until validators converge.

OPEN - Reputation farming remains possible because `player_points` is a non-monetary
ledger. If points ever gain monetary value, cap per-address minting or require staking.

OPEN - The reference and exploit URLs are fetched by the validators' web sandbox. The
contract truncates renders to 5000 characters, defuses delimiters and fails closed, but it
cannot stop a creator from pointing at a slow or hostile page.
