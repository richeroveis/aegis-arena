# AegisArena Milestone v1 On-Chain Evidence

Deployed on GenLayer studionet (chain id 61999).

## Coordinates

- Contract address: `0x35c9359795829DA2Aafc821aAc7d3d65E6d66f53`
- Explorer: https://explorer-studio.genlayer.com/address/0x35c9359795829DA2Aafc821aAc7d3d65E6d66f53
- Deploy tx: `0xcd11529b1eee7aced71fa7fc69287908ea647824e5f5ad5dd9b82cb8bafb0a38`
- Deployed commit: `99f6cfbaa78457d8de0159eb5e5eec0e55af571f`

## Four-way sha256 identity

| Source | sha256 |
|---|---|
| Local LF file | `095fbf906ad76d57e60069db005152172598f123c6042ed2aeb0e83afc25fab1` |
| Git blob at commit | `095fbf906ad76d57e60069db005152172598f123c6042ed2aeb0e83afc25fab1` |
| Remote GitHub raw blob | `095fbf906ad76d57e60069db005152172598f123c6042ed2aeb0e83afc25fab1` |
| Studionet on-chain code | `095fbf906ad76d57e60069db005152172598f123c6042ed2aeb0e83afc25fab1` |

Four-way match: **True**

## Live consensus outcomes

| Submission | Defense band | Anchor | Total score |
|---|---|---|---|
| #1 | HARDENED_PASS | 75 | 76 |
| #2 | HARDENED_PASS | 75 | 73 |

Exploit challenge #1 resolved as `RESOLVED_UPHELD` with band `PARTIAL_LEAK_WARN`.

## Expected guard reverts

| Guard | Blocked |
|---|---|
| premature_settlement_before_window | True |
| unevaluated_leader_settlement | True |
| settlement_with_open_challenge | True |
| post_settlement_endorsement | True |

## Vault invariant

```json
{
  "active_tournament_pots": 0,
  "expected_locked_total": 0,
  "invariant_ok": true,
  "locked_challenger_bonds": 0,
  "locked_defender_bonds": 0,
  "vault_custody_balance": 0
}
```

The invariant is `vault_custody_balance == active_tournament_pots + locked_defender_bonds + locked_challenger_bonds`.

## Transactions

| Label | Function | Tx | Status | Consensus |
|---|---|---|---|---|
| deploy | __init__ | `0xcd11529b1eee7aced71fa7fc69287908ea647824e5f5ad5dd9b82cb8bafb0a38` | FINALIZED | MAJORITY_AGREE |
| faucet main | faucet_or_deposit | `0xe1b815620333306c5634de4b947ba707300f1b9275f62878569bfa9755916715` | FINALIZED | MAJORITY_AGREE |
| faucet peer | faucet_or_deposit | `0x429c5a8fea6ee7872445b47dd037f5f287eeea0428d1f53fe4ea0c6855125841` | FINALIZED | MAJORITY_AGREE |
| faucet challenger | faucet_or_deposit | `0x7234ceffcf42c019a871933dfab97af0b30640608d8627d6bc9fc03bce34368c` | FINALIZED | MAJORITY_AGREE |
| create_tournament#1 (funded vault pot) | create_tournament | `0xd4f5d9bc1528b1b4767533b3c8efb9116d85b524ab31d0333e52eeb71ce63bbf` | FINALIZED | MAJORITY_AGREE |
| create_tournament#2 (guard revert target) | create_tournament | `0xd089e48b25fa3516419203c6db4347bc4a2f7d1e58b7f6477e21007a6dc2429d` | FINALIZED | MAJORITY_AGREE |
| submit_tactic#1 (Aegis Alpha, main) | submit_tactic | `0x2617f1bf1814d898e9b0ef9d4f35ee9f5ddfc829823cb9a29c75bc77dbc3affa` | FINALIZED | MAJORITY_AGREE |
| submit_tactic#2 (Aegis Beta, peer) | submit_tactic | `0xc9e5d57e531be7d0c080796ae814d1c94d6c7b76d9fe6ed96ec1a7713f99225d` | FINALIZED | MAJORITY_AGREE |
| submit_tactic#3 (unevaluated, guard target) | submit_tactic | `0x2737048d77214328d16f1aac1d250f7fbdad18e5cf58f411a7c65441f55c1166` | FINALIZED | MAJORITY_AGREE |
| guard_revert_premature_settle#1 | settle_tournament | `0x4baa31e33d03c947121ba4958581339d64f2cdde112e542e429ea55da0d020fa` | FINALIZED | MAJORITY_AGREE |
| evaluate_submission_live#1 (live consensus attempt 1) | evaluate_submission_live | `0x11055fc3f9fcba532a13003750eae1568c090b99c61a80ff12161e78d4a0ec01` | FINALIZED | MAJORITY_AGREE |
| challenge_defense_submission#1 (matching bond) | challenge_defense_submission | `0x0ebf45735be9d116d05d61d3c644eeb9be62982a1798e4d9be790ce9c5b1f809` | FINALIZED | MAJORITY_AGREE |
| evaluate_submission_live#2 (live consensus attempt 1) | evaluate_submission_live | `0x1d2f183aa565ec49f2aefe93826d7e39f9f8aa9d00f16d4f84aa6904067f3f57` | FINALIZED | MAJORITY_AGREE |
| endorse_submission#1 (peer signer) | endorse_submission | `0x92429f362520f13a886fc4ecef71898e544d54dff54a6009ec9bfe49d0aed563` | FINALIZED | MAJORITY_AGREE |
| endorse_submission#2 (challenger signer) | endorse_submission | `0x8c8dd22fb174788b10b040ddc44ed658e94cc6fa30a976f99083e65ede490fde` | FINALIZED | MAJORITY_AGREE |
| endorse_submission#2 (main signer) | endorse_submission | `0x301ec22e504285247450130ab9be699aadf89d1f33e05bfc8f0c5a05db57622f` | FINALIZED | MAJORITY_AGREE |
| post_arena_comment#1 (challenger signer) | post_arena_comment | `0xfdda364550d6b0f887b8ccadd06c71409f3716c29d2775e2a3d6960ce44b98f2` | FINALIZED | MAJORITY_AGREE |
| guard_revert_unevaluated_settle#2 | settle_tournament | `0x0e70d91c749710bf1559faf0172bef59c77ee5cb16ec58519e955dacaa000cc3` | FINALIZED | MAJORITY_AGREE |
| guard_revert_open_challenge_settle#1 | settle_tournament | `0x4d6eb069a63318cebe63beab955c782208c5fe32dff12ae9a0fe8e3ba5ff77b3` | FINALIZED | MAJORITY_AGREE |
| resolve_exploit_challenge_live#1 (live consensus attempt 1) | resolve_exploit_challenge_live | `0x3a915165e719315367e7e6b408579664a3b4239e5332064ada9ac3e629989ba8` | FINALIZED | MAJORITY_AGREE |
| settle_tournament#1 (invariant winner) | settle_tournament | `0x6641d35f878b87306f1421792c398d4815b76c44bb9749d7f2871e1c34e68e80` | FINALIZED | MAJORITY_AGREE |
| transfer_tokens (prize receipt) | transfer_tokens | `0xac6b1de71ca4393c701a092ad6437585f0bd345cedef1f99786d3f883bfd0047` | FINALIZED | MAJORITY_AGREE |
| guard_revert_post_settle_endorse | endorse_submission | `0xf6dfe5c746559d14b4295ab3d679c67e817b04be17395a80561d7861df9ca3b3` | FINALIZED | MAJORITY_AGREE |
| cancel_tournament#2 (stalled recovery by third party) | cancel_tournament | `0x494b253c52547bf46a3e5254c464f83f93eb4603475e04c8d1e48e8f85fee4e5` | FINALIZED | MAJORITY_AGREE |

Machine-readable proof: `evidence/studionet_deployment.json`.
