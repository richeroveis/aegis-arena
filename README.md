![AegisArena logo](docs/logo.png)

# AegisArena

AegisArena is a multiplayer tactical tournament and battle-resolution dapp built as a
GenLayer Intelligent Contract. Players compete in live, web-grounded tactical challenges,
GenLayer validators verify each outcome against real web sources using an LLM comparative
equivalence principle, and the community can endorse and discuss battles entirely on-chain.

- Live site: https://richeroveis.github.io/aegis-arena/
- Contract (studionet, chain id 61999): `0x09a0D07800547074a7D1f7c48B96208ee653d5DA`
- Explorer: https://explorer-studio.genlayer.com/address/0x09a0D07800547074a7D1f7c48B96208ee653d5DA
- Deploy tx: `0xfd5e1a6327bba4a5f20da22c154215748e9a720889367d787e6af8948ba97fc6`

The arena is already seeded on-chain with two tournaments: one live-evaluated
and SETTLED to its verified on-chain leader, and one still OPEN whose settlement
is correctly blocked because none of its entries finished the live consensus
evaluation. It also has ranked submissions, a real validator-consensus verdict,
a community endorsement from a second signer, and an on-chain comment, so a
reviewer opening the live site immediately sees a populated arena fetched from
studionet.

## Resolution invariants (steward review "zoefunds")

- Mandatory live consensus: a submission can only lead or win a tournament after
  it finishes `evaluate_tactic_live`, the neutral live GenLayer consensus path.
  `settle_tournament` reverts with
  `"cannot settle tournament without a live-evaluated winning submission"` if the
  winning submission was never live-evaluated.
- No creator/owner bypass: the former `score_tactic_deterministic` method is
  removed. Only `evaluate_tactic_live` can mark a submission evaluated. Its LLM
  verdict is snapped onto a fixed 5-point grid (0, 5, 10, ..., 60) and validators
  must agree on the exact quantized integer.
- One consistent score: the stored leader, `best_score`, and the settlement
  winner always follow `min(100, deterministic_score + ai_verdict_score +
  endorsements * 2)`, recomputed by a single `_sync_leader_if_evaluated` helper
  on every evaluation and endorsement, and again inside settlement.
- Frozen after terminal status: endorsements that would change scores revert once
  a tournament is `SETTLED` or `CANCELLED`.

## Deployment provenance

- Deployed contract tag: `studionet-v1` (points at the commit that contains this
  exact `contracts/aegis_arena.py`).
- Contract file sha256, identical across local file, deploy payload, on-chain
  explorer code and the git blob:
  `fbf039ac7a8d39eb9bc8ade29dea5ee2cc488c8873501d860b6ab74215aabb9e`
- Deploy tx: `0xfd5e1a6327bba4a5f20da22c154215748e9a720889367d787e6af8948ba97fc6`
- Per-transaction on-chain evidence, including the live-consensus evaluation,
  the endorsement leader/score sync and both negative rollbacks:
  `evidence/studionet_deployment.json`

The contract source at the tagged commit is byte-for-byte the source deployed to
studionet; later commits only add CI and documentation and do not touch
`contracts/aegis_arena.py`.

## Why GenLayer

AegisArena needs consensus for the part that is subjective and externally sourced: judging
whether a player's tactical submission is factually aligned with a live reference page. That
judgment determines scores, the tournament leader, and ultimately who receives the prize pool.
A plain backend could not make that decision in a way that is independently reproducible by
multiple validators. The deterministic parts (input validation, the mandatory-token gate, and
the structural score) run identically on every node; only the web-grounded quality judgment
goes through validator consensus.

## Architecture and boundaries

- Frontend owns: UI, burner/wallet auth, live reads, and non-authoritative pre-flight checks.
- Contract owns: tournament state, the deterministic score, the consensus-gated AI verdict,
  endorsements, comments, leaderboard points, and settlement of the prize to the leader.
- External sources own: the raw reference content, which validators re-fetch and normalize
  independently rather than trusting any player's claim.

## Contract

`contracts/aegis_arena.py`, pinned to the GenVM runner hash on line 1.

Persistent structures: `Tournament`, `BattleSubmission`, `ArenaComment`.

Write methods:

- `create_tournament(title, challenge_brief, reference_url, mandatory_fact_token, prize_pool_points)`
- `submit_tactic(tournament_id, moniker, tactic_payload)` (enforces the mandatory fact token and a deterministic 0..40 score; never takes the lead until live evaluation)
- `evaluate_tactic_live(submission_id)` (the only path that marks a submission evaluated; validators fetch the reference URL and run `gl.eq_principle.prompt_comparative` for a 5-point-grid verdict)
- `endorse_submission(submission_id)` (OPEN tournaments only, no self-endorsement, one per address, capped +2 bonus, keeps the leader in lockstep)
- `post_arena_comment(tournament_id, submission_id, author_moniker, message, stance)`
- `settle_tournament(tournament_id)` (creator or owner; requires a live-evaluated winner and pays the on-chain leader)
- `cancel_tournament(tournament_id)` (creator or owner, empty tournaments only)

View methods: `get_tournament`, `get_all_tournaments`, `get_tournament_submissions`,
`get_tournament_comments`, `get_leaderboard`, `get_arena_stats`.

## Scoring model

- Deterministic 0..40: mandatory-token emphasis, length efficiency, and structural richness.
- AI verdict 0..60 on a 5-point grid: only through validator consensus on the live reference source, with validators required to agree on the exact quantized integer.
- Total 0..100, clamped: `min(100, deterministic + ai_verdict + endorsements * 2)`. Endorsements add a capped community bonus, and the ranking score, stored leader and settlement winner all follow this one invariant.

## Frontend

`frontend/` is a Vite + React + TypeScript app using `genlayer-js`.

- Dual wallet: a one-click burner identity persisted in localStorage, or a MetaMask / EIP-1193
  connection. A "New Burner Identity" button makes it easy to test multi-player endorsement.
- Live dashboard with on-chain stats, a network health indicator, and a contract badge linking
  to the explorer.
- Tournament explorer and live battle room with ranked submissions.
- Tactical submission console with a real-time pre-flight check (mandatory-token presence and
  character bounds) and a Quick Fill demo tactic.
- Per-submission actions: a clear "Live Consensus Evaluated (Eligible to Win)" versus
  "Awaiting Live AI Evaluation" badge, a "Trigger Live AI Consensus" button that is only
  enabled for OPEN tournaments still awaiting evaluation, and an "Endorse" button that is
  disabled once a tournament is SETTLED or CANCELLED.
- On-chain discussion feed with stance badges and a comment composer.
- Create-tournament modal with a preset scenario loader.
- A live transaction lifecycle stepper: Signing, Broadcast to Studionet, Validator Consensus,
  Finalized with an explorer link, then automatic state refresh.

## Repository layout

```
contracts/aegis_arena.py        the Intelligent Contract
tests/test_aegis_arena_direct.py  55 direct-mode tests
tests/test_aegis_arena_integration.py  live studionet consensus tests
tests/conftest.py               Windows os.unlink shim for direct mode
scripts/deploy_studionet.py     deploy + seed + evidence collection
scripts/make_logo.py            programmatic logo renderer
evidence/studionet_deployment.json  on-chain deployment proof
docs/adversarial-review.md      security review notes
frontend/                        the live web app
```

## Development

```bash
pip install -r requirements.txt
genvm-lint check contracts/aegis_arena.py
pytest tests/ -q                 # offline direct suite (integration is skipped by default)

# live consensus suite (needs network to studionet)
RUN_STUDIONET_INTEGRATION=1 pytest tests/test_aegis_arena_integration.py -v -s

# deploy and seed a fresh instance
python scripts/deploy_studionet.py

# frontend
cd frontend && npm install && npm run build
```

## Security

See `docs/adversarial-review.md`. Highlights: strict input bounds with floors and ceilings,
rejection (not clamping) of out-of-range values, self-endorsement and duplicate-endorsement
guards, prompt-injection defusing of all fetched and creator-supplied text, a single-shot
consensus scoring path with a fixed 5-point verdict grid, a mandatory live-evaluation gate
before settlement, one shared leader/settlement score invariant, and endorse/settle/cancel
guards that freeze scores once a tournament leaves OPEN. The non-custodial design means the
contract holds no external funds; points are a reputation ledger, and settlement transfers
prize points to the live-evaluated on-chain leader only.

## Tech stack

GenLayer studionet, GenVM Python runner (pinned), `genlayer-js`, Vite, React, TypeScript,
viem, deployed to GitHub Pages.
