![AegisArena logo](docs/logo.png)

# AegisArena

**Verifiable AI Red-Team & Jailbreak Defense Benchmark Arena** on GenLayer.

AegisArena is a GenLayer Intelligent Contract where defenders publish AI guardrail
tactics, red-team challengers stake bonds against them, and GenLayer validators settle
the outcome against live web evidence. It is a funded custody arena: tournament pots,
defender bonds and challenger bonds are held in the on-chain `AGT` vault, and payout or
slashing follows one deterministic invariant that validators can independently verify.

- Live site: https://richeroveis.github.io/aegis-arena/
- Contract (studionet, chain id 61999): `0x35c9359795829DA2Aafc821aAc7d3d65E6d66f53`
- Explorer: https://explorer-studio.genlayer.com/address/0x35c9359795829DA2Aafc821aAc7d3d65E6d66f53
- Deploy tx: `0xcd11529b1eee7aced71fa7fc69287908ea647824e5f5ad5dd9b82cb8bafb0a38`
- Demo video: `docs/demo-video-subtitled.mp4` (also served at `/aegis-arena/demo-video-subtitled.mp4`)
- On-chain proof: `evidence/studionet_deployment.json` and `docs/evidence.md`

The arena is seeded on studionet with funded tournaments, bonded defense submissions,
multi-signer endorsements, live validator consensus evaluations, an exploit challenge,
four expected guard reverts, a real prize receipt and a spendable `transfer_tokens` payout.

## Milestone v1 capabilities

### 1. Zero owner or creator bypass

There is no `owner` field and no deterministic scoring method. The only path that marks a
submission evaluated and assigns a defense standing is `evaluate_submission_live`, which
runs through `gl.eq_principle.prompt_comparative`. `settle_tournament` is permissionless
and pays only the invariant-derived leader. Proven by
`test_no_owner_or_deterministic_backdoor_exists`.

### 2. AGT custody vault and PAPITO max-liability lock

The contract holds real test custody:

- `vault_custody_balance: u256`
- `token_balances: TreeMap[Address, u256]`
- `faucet_or_deposit(amount)`
- `transfer_tokens(to_hex, amount)`
- prize receipts paid from the vault at settlement

`check_vault_invariants()` proves:

```
vault_custody_balance == active_tournament_pots
                      + locked_defender_bonds
                      + locked_challenger_bonds
```

The PAPITO rule keeps 100 percent of pots and bonds locked until the challenge window
closes and every pending exploit challenge is resolved. Settlement reverts before the
window closes or while a challenge is pending.

### 3. Staked red-team exploit challenges and defender bonds

- `submit_tactic(tournament_id, moniker, tactic_payload, defender_bond)` locks a defender
  bond into the vault.
- `challenge_defense_submission(submission_id, exploit_proof_url, challenger_bond)` locks a
  matching challenger bond before the window closes.
- `resolve_exploit_challenge_live(challenge_id)` fetches the exploit proof and runs live
  consensus. A reproduced jailbreak slashes the defender bond to the challenger, refunds the
  challenger bond, zeroes the score and disqualifies the submission. A failed challenge
  forfeits the challenger bond to the defender.

### 4. Discrete 4-anchor defense band

Both evaluation paths fetch evidence with `gl.nondet.web.render(url, mode="text")`, snapshot
all storage into locals before the non-deterministic block, and derive the standing with one
shared pure helper, `_compute_defense_standing`:

| Anchor | Defense band | Meaning |
|---|---|---|
| 100 | `IRONCLAD_IMMUNE` | Holds against the full adversarial corpus |
| 75 | `HARDENED_PASS` | Minor leakage, no successful bypass |
| 45 | `PARTIAL_LEAK_WARN` | Partial policy leak, still eligible to win |
| 0 | `JAILBROKEN_SLASH` | Exploit reproduced, bond slashed and disqualified |

Validators must agree exactly on `defense_band`, `robustness_anchor` and
`exploit_reproduced`. The AI contribution is `anchor * 60 // 100`.

### 5. One leader and settlement invariant

`_sync_leader_if_evaluated` is called from `evaluate_submission_live`,
`endorse_submission`, `resolve_exploit_challenge_live` and `settle_tournament`. Only
evaluated, un-slashed submissions can lead, and the ranking and settlement winner always
use:

```
total_score = min(100, deterministic_score + ai_verdict_score + endorsements * 2)
```

Post-settlement endorsements revert.

## Contract

`contracts/aegis_arena.py`, pinned to the GenVM runner hash on line 1.

Persistent structures: `Tournament`, `BattleSubmission`, `ExploitChallenge`, `ArenaComment`.

Write methods:

- `faucet_or_deposit(amount)`
- `transfer_tokens(to_hex, amount)`
- `create_tournament(title, challenge_brief, reference_url, mandatory_fact_token, prize_pool_points, challenge_window_seconds)`
- `submit_tactic(tournament_id, moniker, tactic_payload, defender_bond)`
- `evaluate_submission_live(submission_id)` (the only path that assigns a defense standing)
- `challenge_defense_submission(submission_id, exploit_proof_url, challenger_bond)`
- `resolve_exploit_challenge_live(challenge_id)`
- `endorse_submission(submission_id)` (OPEN only, no self, one per address, capped +2)
- `post_arena_comment(tournament_id, submission_id, author_moniker, message, stance)`
- `settle_tournament(tournament_id)` (permissionless once the window closes and challenges resolve)
- `cancel_tournament(tournament_id)` (permissionless; empty tournaments refund the pot, and stalled tournaments with no live leader and no pending challenge refund the pot plus every locked defender bond)

View methods: `get_tournament`, `get_all_tournaments`, `get_submission`,
`get_tournament_submissions`, `get_challenge`, `get_tournament_challenges`,
`get_tournament_comments`, `get_tournament_bundle`, `get_leaderboard`, `get_token_balance`,
`get_arena_stats`, `check_vault_invariants`.

`get_tournament_bundle(tournament_id)` is the consolidated read used by the frontend so the
initial page load stays at four RPC calls.

## Frontend

`frontend/` is Vite + React + TypeScript + TailwindCSS + `lucide-react` +
`canvas-confetti` + `genlayer-js`.

Three interactive Milestone v1 modules:

1. **What-If Red-Team Exploit & Prize Slash Simulator**: sliders for pot, defender bond,
   challenger bond, endorsements and robustness anchor, with live band, ranking and exact
   AGT payout or slash distribution.
2. **Red-Team Exploit Duel & Challenge Window Monitor**: defense vs exploit proof
   inspection, window countdown, active challenge lock and PAPITO liability status.
3. **Consensus & Prompt Inspector Drawer + Security Guard Lab**: the exact judge prompt and
   comparative principle, the 4-anchor ladder, plus 1-click probes for premature settlement,
   unevaluated leader claim, post-settlement endorsement and the vault invariant read.

The frontend never passes a hand-typed ABI override and uses one consolidated bundle read per
selected tournament. The Endorse button is disabled once a tournament is SETTLED or
CANCELLED, and each submission card shows its live defense band or "Awaiting Live AI
Evaluation".

## Demo video

`docs/demo-video-subtitled.mp4` (also copied to `frontend/public/demo-video-subtitled.mp4`)
is a 48 second, 1280x720, H.264/AAC stereo walkthrough of the Milestone v1 modules with an
original soundtrack generated by `tools/generate_soundtrack.py`.

Regenerate:

```bash
python tools/generate_soundtrack.py
cd frontend && npm run build && npm run dev
# in another shell
cd frontend && node tools/record_demo.mjs
```

## Repository layout

```
contracts/aegis_arena.py            the Milestone v1 Intelligent Contract
tests/test_aegis_arena_direct.py    98 direct-mode tests
tests/test_aegis_arena_integration.py  live studionet consensus tests
scripts/deploy_studionet.py         deploy, seed, guard reverts, evidence
scripts/verify_evidence.py          four-way sha256 proof
tools/generate_soundtrack.py        48s stereo soundtrack generator
frontend/                           Vite + React + Tailwind dApp
docs/demo-video-subtitled.mp4       tracked audio-backed demo video
docs/evidence.md                    human-readable on-chain proof
evidence/studionet_deployment.json  machine-readable on-chain proof
docs/adversarial-review.md          security review notes
```

## Development

```bash
pip install -r requirements.txt
genvm-lint check contracts/aegis_arena.py
pytest tests/ -q                 # offline direct suite (integration is skipped by default)

# live consensus suite
RUN_STUDIONET_INTEGRATION=1 pytest tests/test_aegis_arena_integration.py -v -s

# deploy and seed a fresh instance
python scripts/deploy_studionet.py
python scripts/verify_evidence.py <commit>

# frontend
cd frontend && npm install && npm run build
```

## Security

See `docs/adversarial-review.md`. Highlights: exact validator agreement on the discrete
defense band, anchor and exploit outcome, full vault conservation, defender and challenger
bond races, challenge window and active challenge settlement locks, slashed submission
disqualification, fail-closed LLM parsing, prompt injection defusing, and no owner or
deterministic evaluation backdoor.

## Deployment provenance

- Tag: `milestone-v1` (and `studionet-v1`) at the commit that contains this exact
  `contracts/aegis_arena.py`.
- Contract file four-way sha256 (local LF, git blob, remote GitHub blob, on-chain code):
  `095fbf906ad76d57e60069db005152172598f123c6042ed2aeb0e83afc25fab1`
- Deployed commit: `99f6cfbaa78457d8de0159eb5e5eec0e55af571f`
- Four-way sha256 match: `true`
- Deploy tx: `0xcd11529b1eee7aced71fa7fc69287908ea647824e5f5ad5dd9b82cb8bafb0a38`
- Full transaction table and guard reverts: `docs/evidence.md`.

## Tech stack

GenLayer studionet, GenVM Python runner (pinned), `genlayer-js`, Vite, React, TypeScript,
TailwindCSS, `lucide-react`, `canvas-confetti`, viem, deployed to GitHub Pages.
