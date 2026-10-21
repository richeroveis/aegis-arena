export interface Tournament {
  tournament_id: number;
  creator: string;
  title: string;
  challenge_brief?: string;
  reference_url: string;
  mandatory_fact_token: string;
  prize_pool_points: number;
  entry_count: number;
  best_score: number;
  current_leader: string;
  status: "OPEN" | "SETTLED" | "CANCELLED";
  winner: string;
  challenge_window_clock: number;
  active_challenges: number;
}

export type DefenseBand =
  | "IRONCLAD_IMMUNE"
  | "HARDENED_PASS"
  | "PARTIAL_LEAK_WARN"
  | "JAILBROKEN_SLASH"
  | "";

export interface Submission {
  submission_id: number;
  tournament_id: number;
  player: string;
  moniker: string;
  tactic_payload: string;
  deterministic_score: number;
  ai_verdict_score: number;
  total_score: number;
  endorsements: number;
  evaluated: boolean;
  judge_rationale: string;
  defender_bond: number;
  bond_locked: boolean;
  slashed: boolean;
  defense_band: DefenseBand;
  robustness_anchor: number;
  exploit_reproduced: boolean;
  active_challenge_id: number;
}

export type ChallengeStatus = "PENDING" | "RESOLVED_SLASHED" | "RESOLVED_UPHELD";

export interface ExploitChallenge {
  challenge_id: number;
  submission_id: number;
  tournament_id: number;
  challenger: string;
  exploit_proof_url: string;
  challenger_bond: number;
  status: ChallengeStatus;
  defense_band: DefenseBand;
  robustness_anchor: number;
  exploit_reproduced: boolean;
  rationale: string;
}

export interface ArenaComment {
  comment_id: number;
  tournament_id: number;
  submission_id: number;
  author: string;
  author_moniker: string;
  message: string;
  stance: "COMMEND" | "CHALLENGE" | "ANALYSIS";
}

export interface LeaderRow {
  address: string;
  points: number;
  wins: number;
}

export interface ArenaStats {
  total_tournaments: number;
  open: number;
  settled: number;
  cancelled: number;
  total_submissions: number;
  evaluated_submissions: number;
  total_endorsements: number;
  total_comments: number;
  total_challenges: number;
  slashed_submissions: number;
  vault_custody_balance: number;
}

export interface VaultState {
  vault_custody_balance: number;
  active_tournament_pots: number;
  locked_defender_bonds: number;
  locked_challenger_bonds: number;
  expected_locked_total: number;
  invariant_ok: boolean;
}

export interface TournamentBundle {
  tournament: Tournament;
  submissions: Submission[];
  comments: ArenaComment[];
  challenges: ExploitChallenge[];
}

export type TxStage =
  | "idle"
  | "signing"
  | "broadcast"
  | "consensus"
  | "finalized"
  | "error";

export interface TxResult {
  hash: string;
  status?: string;
  executionResult?: string;
  ok: boolean;
  message?: string;
}
