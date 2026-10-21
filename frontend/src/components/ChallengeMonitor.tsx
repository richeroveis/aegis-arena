import { useEffect, useMemo, useState } from "react";
import { Clock, ExternalLink, Lock, ShieldAlert, Swords } from "lucide-react";
import type { ExploitChallenge, Submission, Tournament } from "../lib/types";

interface Props {
  tournament: Tournament | null;
  submissions: Submission[];
  challenges: ExploitChallenge[];
  busy: boolean;
  onResolve: (challengeId: number) => void;
}

function statusTone(status: string) {
  if (status === "RESOLVED_SLASHED") return "text-arena-red";
  if (status === "RESOLVED_UPHELD") return "text-arena-green";
  return "text-arena-amber";
}

export function ChallengeMonitor({ tournament, submissions, challenges, busy, onResolve }: Props) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const monikers = useMemo(() => {
    const map = new Map<number, string>();
    submissions.forEach((s) => map.set(Number(s.submission_id), s.moniker));
    return map;
  }, [submissions]);

  if (!tournament) {
    return null;
  }

  const remaining = Number(tournament.challenge_window_clock) - now;
  const closed = remaining <= 0;
  const active = Number(tournament.active_challenges);
  const pending = challenges.filter((c) => c.status === "PENDING").length;

  return (
    <section className="panel mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title m-0 flex items-center gap-2">
          <Swords size={18} /> Red-Team Exploit Duel & Challenge Window Monitor
        </h2>
        <span className={`badge ${closed ? "settled" : "open"}`}>
          {closed ? "WINDOW CLOSED" : "WINDOW OPEN"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-arena-line p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Clock size={14} /> Challenge window
          </div>
          <div className="font-mono text-lg">
            {closed ? "closed" : `${Math.floor(remaining / 60)}m ${remaining % 60}s`}
          </div>
          <div className="small muted">clock {Number(tournament.challenge_window_clock)}</div>
        </div>
        <div className="rounded-lg border border-arena-line p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldAlert size={14} /> Active challenges
          </div>
          <div className="font-mono text-lg">{active}</div>
          <div className="small muted">{pending} pending resolution</div>
        </div>
        <div className="rounded-lg border border-arena-line p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Lock size={14} /> PAPITO max liability
          </div>
          <div className="font-mono text-lg">locked</div>
          <div className="small muted">
            pot and bonds stay in vault until the window closes and every challenge resolves
          </div>
        </div>
      </div>

      {challenges.length === 0 && (
        <div className="empty mt-3">No exploit challenges filed for this tournament yet.</div>
      )}

      {challenges.map((c) => (
        <div className="comment mt-2" key={c.challenge_id}>
          <div className="spread wrap">
            <div className="flex flex-wrap items-center gap-2">
              <strong>Challenge #{Number(c.challenge_id)}</strong>
              <span className="badge token">on #{Number(c.submission_id)} {monikers.get(Number(c.submission_id)) ?? ""}</span>
              <span className={`badge ${c.status === "PENDING" ? "CHALLENGE" : c.status === "RESOLVED_UPHELD" ? "COMMEND" : "cancelled"}`}>
                {c.status}
              </span>
              {c.defense_band && <span className={`small ${statusTone(c.status)}`}>{c.defense_band}</span>}
            </div>
            <span className="small muted">bond {Number(c.challenger_bond)} AGT</span>
          </div>
          <div className="small muted mt-1 break-all">
            challenger {c.challenger}
          </div>
          <a
            className="small mt-1 inline-flex items-center gap-1 text-arena-cyan"
            href={c.exploit_proof_url}
            target="_blank"
            rel="noreferrer"
          >
            exploit proof <ExternalLink size={12} />
          </a>
          {c.rationale && <div className="small mt-1" style={{ color: "var(--amber)" }}>Judge: {c.rationale}</div>}
          {c.status === "PENDING" && (
            <button className="sm accent mt-2" disabled={busy} onClick={() => onResolve(Number(c.challenge_id))}>
              Resolve via Live Consensus
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
