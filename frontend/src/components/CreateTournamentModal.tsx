import { useState } from "react";
import { SCORE } from "../config";
import type { TxStage } from "../lib/types";
import { TxStepper } from "./common";

export interface TournamentDraft {
  title: string;
  challenge_brief: string;
  reference_url: string;
  mandatory_fact_token: string;
  prize_pool_points: number;
}

const PRESET: TournamentDraft = {
  title: "Blackout Drill: Grid Resilience",
  challenge_brief:
    "Devise a response plan for a coordinated OT attack on a regional power grid. Ground every claim in the reference source and keep civilian infrastructure online.",
  reference_url: "https://www.cisa.gov/topics/industrial-control-systems",
  mandatory_fact_token: "GRID RESILIENCE",
  prize_pool_points: 7500,
};

const EMPTY: TournamentDraft = {
  title: "",
  challenge_brief: "",
  reference_url: "",
  mandatory_fact_token: "",
  prize_pool_points: 5000,
};

interface Props {
  open: boolean;
  busy: boolean;
  stage: TxStage;
  hash?: string;
  onClose: () => void;
  onSubmit: (draft: TournamentDraft) => void;
}

export function CreateTournamentModal({ open, busy, stage, hash, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState<TournamentDraft>(EMPTY);
  if (!open) return null;

  const set = <K extends keyof TournamentDraft>(k: K, v: TournamentDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const valid =
    draft.title.trim().length >= 1 &&
    draft.title.length <= 100 &&
    draft.challenge_brief.trim().length >= 1 &&
    draft.reference_url.startsWith("http") &&
    draft.mandatory_fact_token.trim().length >= 1 &&
    draft.prize_pool_points >= SCORE.prizeMin &&
    draft.prize_pool_points <= SCORE.prizeMax;

  return (
    <div className="modal-back" onClick={busy ? undefined : onClose}>
      <div className="panel modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread">
          <h2 className="section-title" style={{ margin: 0 }}>
            Launch a Tournament
          </h2>
          <button className="sm ghost" onClick={onClose} disabled={busy}>
            close
          </button>
        </div>

        <div className="row" style={{ margin: "10px 0" }}>
          <button className="sm" onClick={() => setDraft(PRESET)} disabled={busy}>
            Load Preset Scenario
          </button>
        </div>

        <label>Title (1..100)</label>
        <input value={draft.title} onChange={(e) => set("title", e.target.value)} maxLength={100} />

        <label>Challenge brief (1..1000)</label>
        <textarea
          value={draft.challenge_brief}
          onChange={(e) => set("challenge_brief", e.target.value)}
          maxLength={1000}
        />

        <label>Reference URL (http/https)</label>
        <input
          className="mono"
          value={draft.reference_url}
          onChange={(e) => set("reference_url", e.target.value.trim())}
          placeholder="https://..."
        />

        <label>Mandatory fact token (anchor players must weave in)</label>
        <input
          value={draft.mandatory_fact_token}
          onChange={(e) => set("mandatory_fact_token", e.target.value)}
          maxLength={64}
        />

        <label>Prize pool points ({SCORE.prizeMin}..{SCORE.prizeMax})</label>
        <input
          type="number"
          value={draft.prize_pool_points}
          onChange={(e) => set("prize_pool_points", Number(e.target.value))}
        />

        <TxStepper stage={stage} hash={hash} />

        <div className="row" style={{ marginTop: 16 }}>
          <button
            className="primary grow"
            disabled={!valid || busy}
            onClick={() => onSubmit(draft)}
          >
            {busy ? "Broadcasting..." : "Create on-chain"}
          </button>
          <button className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
