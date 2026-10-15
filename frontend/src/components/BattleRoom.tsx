import { useMemo, useState } from "react";
import { SCORE, STANCES, type Stance } from "../config";
import type { ArenaComment, Submission, Tournament, TxStage } from "../lib/types";
import { StatusBadge, TxStepper, shortAddr } from "./common";

interface Props {
  tournament: Tournament | null;
  submissions: Submission[];
  comments: ArenaComment[];
  connected: boolean;
  isCreator: boolean;
  currentAddress: string | null;
  busy: boolean;
  stage: TxStage;
  hash?: string;
  onSubmitTactic: (moniker: string, payload: string) => void;
  onEvaluate: (submissionId: number) => void;
  onEndorse: (submissionId: number) => void;
  onComment: (submissionId: number, moniker: string, message: string, stance: Stance) => void;
  onSettle: () => void;
  onCancel: () => void;
}

export function BattleRoom(props: Props) {
  const { tournament, submissions, comments, connected, busy, stage, hash } = props;
  const [moniker, setMoniker] = useState("Operator");
  const [payload, setPayload] = useState("");
  const [commentFor, setCommentFor] = useState<number>(0);
  const [commentMsg, setCommentMsg] = useState("");
  const [commentStance, setCommentStance] = useState<Stance>("ANALYSIS");

  const token = tournament?.mandatory_fact_token ?? "";
  const hasToken = useMemo(
    () => token.length > 0 && payload.toLowerCase().includes(token.toLowerCase()),
    [payload, token],
  );
  const lenOk = payload.length >= SCORE.payloadMin && payload.length <= SCORE.payloadMax;

  if (!tournament) {
    return (
      <div className="panel">
        <h2 className="section-title">Live Battle Room</h2>
        <div className="empty">Select a tournament to enter the arena.</div>
      </div>
    );
  }

  const isOpen = tournament.status === "OPEN";

  const quickFill = () =>
    setPayload(
      `Phase one: establish a hardened foothold and validate the canonical source before acting. ` +
        `The plan is anchored on ${token} so every operator aligns on the same objective. ` +
        `Phase two: segment the target, restrict east-west movement, and instrument canary alerts. ` +
        `Phase three: rotate credentials, confirm integrity against the reference, and hold the line.`,
    );

  return (
    <div className="panel">
      <div className="spread wrap">
        <h2 className="section-title" style={{ margin: 0 }}>
          #{tournament.tournament_id} · {tournament.title}
        </h2>
        <StatusBadge status={tournament.status} />
      </div>

      <p style={{ lineHeight: 1.5 }}>{tournament.challenge_brief}</p>
      <div className="row wrap small muted">
        <span className="badge token">token: {token}</span>
        <span>Prize {Number(tournament.prize_pool_points)} pts</span>
        <span>Best {Number(tournament.best_score)}</span>
        <span>Leader {shortAddr(tournament.current_leader)}</span>
        <a href={tournament.reference_url} target="_blank" rel="noreferrer">
          Reference source ↗
        </a>
      </div>

      {isOpen && connected && (
        <>
          <div className="divider" />
          <h3 className="section-title">Tactical Submission Console</h3>
          <label>Moniker (1..32)</label>
          <input value={moniker} onChange={(e) => setMoniker(e.target.value)} maxLength={32} />
          <label>Tactic payload ({SCORE.payloadMin}..{SCORE.payloadMax} chars)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            maxLength={SCORE.payloadMax}
            placeholder={`Weave the mandatory token "${token}" into your plan...`}
          />
          <div className="preflight">
            <span className={hasToken ? "ok" : "bad"}>
              {hasToken ? "✓ mandatory token present" : "✗ mandatory token missing"}
            </span>
            <span className={lenOk ? "ok" : "bad"}>
              {lenOk ? `✓ ${payload.length} chars` : `✗ ${payload.length} chars (need ${SCORE.payloadMin}..${SCORE.payloadMax})`}
            </span>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={!connected || !hasToken || !lenOk || moniker.trim().length === 0 || busy}
              onClick={() => props.onSubmitTactic(moniker.trim(), payload)}
            >
              Submit Tactic to GenLayer
            </button>
            <button onClick={quickFill} disabled={busy}>
              Quick Fill Demo Tactic
            </button>
          </div>
        </>
      )}

      <div className="divider" />
      <h3 className="section-title">Ranked Submissions</h3>
      {submissions.length === 0 && <div className="empty">No submissions yet. Be the first.</div>}
      {submissions.map((s, i) => {
        const mine = props.currentAddress && s.player.toLowerCase() === props.currentAddress.toLowerCase();
        return (
          <div className="sub" key={s.submission_id}>
            <div className="spread">
              <div>
                <span className="rank">#{i + 1}</span>{" "}
                <strong>{s.moniker}</strong>{" "}
                <span className="mono small muted">{shortAddr(s.player)}</span>
                {mine && <span className="badge">you</span>}
              </div>
              <div className="scorepill">{Number(s.total_score)}/100</div>
            </div>
            <div className="bar" title={`det ${s.deterministic_score} + ai ${s.ai_verdict_score}`}>
              <span style={{ width: `${Math.min(100, Number(s.total_score))}%` }} />
            </div>
            <div className="row wrap small muted" style={{ margin: "6px 0" }}>
              <span>det {Number(s.deterministic_score)}/40</span>
              <span>·</span>
              <span>ai {Number(s.ai_verdict_score)}/60</span>
              <span>·</span>
              <span>{Number(s.endorsements)} endorsements</span>
              <span>·</span>
              <span>{s.evaluated ? "evaluated" : "pending"}</span>
            </div>
            <div className="payload">{s.tactic_payload}</div>
            {s.judge_rationale && (
              <div className="small" style={{ color: "var(--amber)" }}>
                Judge: {s.judge_rationale}
              </div>
            )}
            <div className="row wrap" style={{ marginTop: 8 }}>
              <button
                className="sm accent"
                disabled={!connected || !isOpen || s.evaluated || busy}
                onClick={() => props.onEvaluate(s.submission_id)}
                title="Runs validators' web fetch + LLM comparative consensus"
              >
                Trigger Live AI Consensus
              </button>
              <button
                className="sm"
                disabled={!connected || mine || busy}
                onClick={() => props.onEndorse(s.submission_id)}
              >
                + Endorse
              </button>
              <button
                className="sm ghost"
                disabled={!connected}
                onClick={() => setCommentFor(s.submission_id)}
              >
                Comment
              </button>
            </div>
          </div>
        );
      })}

      <div className="divider" />
      <h3 className="section-title">On-chain Tactical Discussion</h3>
      {comments.length === 0 && <div className="empty">No comments yet.</div>}
      {comments.map((c) => (
        <div className="comment" key={c.comment_id}>
          <div className="spread">
            <div>
              <strong>{c.author_moniker}</strong>{" "}
              <span className="mono small muted">{shortAddr(c.author)}</span>{" "}
              <span className={`badge ${c.stance}`}>{c.stance}</span>
            </div>
            <span className="small muted">on #{Number(c.submission_id)}</span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>{c.message}</div>
        </div>
      ))}

      {connected && (
        <>
          <label>Comment on submission id</label>
          <select
            value={commentFor}
            onChange={(e) => setCommentFor(Number(e.target.value))}
          >
            <option value={0}>select submission...</option>
            {submissions.map((s) => (
              <option key={s.submission_id} value={s.submission_id}>
                #{s.submission_id} · {s.moniker}
              </option>
            ))}
          </select>
          <label>Message (1..280)</label>
          <input
            value={commentMsg}
            onChange={(e) => setCommentMsg(e.target.value)}
            maxLength={280}
          />
          <label>Stance</label>
          <select value={commentStance} onChange={(e) => setCommentStance(e.target.value as Stance)}>
            {STANCES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={!commentFor || commentMsg.trim().length === 0 || busy}
              onClick={() => {
                props.onComment(commentFor, moniker.trim() || "anon", commentMsg.trim(), commentStance);
                setCommentMsg("");
              }}
            >
              Post Comment
            </button>
          </div>
        </>
      )}

      {isOpen && connected && props.isCreator && (
        <>
          <div className="divider" />
          <div className="row wrap">
            <button
              className="accent"
              disabled={busy || Number(tournament.entry_count) === 0}
              onClick={props.onSettle}
            >
              Settle Tournament (pay leader)
            </button>
            <button
              className="ghost"
              disabled={busy || Number(tournament.entry_count) > 0}
              onClick={props.onCancel}
            >
              Cancel (empty only)
            </button>
          </div>
        </>
      )}

      <TxStepper stage={stage} hash={hash} />
    </div>
  );
}
