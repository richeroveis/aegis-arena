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
}

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
