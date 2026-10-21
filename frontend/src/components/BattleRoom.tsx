import { useMemo, useState } from "react";
import { Droplets, ExternalLink, Swords, Wallet } from "lucide-react";
import { SCORE, STANCES, bandMetaFor, type Stance } from "../config";
import type { ArenaComment, Submission, Tournament, TxStage } from "../lib/types";
import { StatusBadge, TxStepper, shortAddr } from "./common";

interface Props {
  tournament: Tournament | null;
  submissions: Submission[];
  comments: ArenaComment[];
  connected: boolean;
  isCreator: boolean;
  currentAddress: string | null;
  tokenBalance: number;
  busy: boolean;
  stage: TxStage;
  hash?: string;
  onSubmitTactic: (moniker: string, payload: string, bond: number) => void;
  onEvaluate: (submissionId: number) => void;
  onEndorse: (submissionId: number) => void;
  onChallenge: (submissionId: number, proofUrl: string, bond: number) => void;
  onComment: (submissionId: number, moniker: string, message: string, stance: Stance) => void;
  onSettle: () => void;
  onCancel: () => void;
  onFaucet: (amount: number) => void;
  onOpenInspector: () => void;
}

function bandClass(band: string) {
  if (band === "IRONCLAD_IMMUNE") return "badge eval-ok";
  if (band === "HARDENED_PASS") return "badge ANALYSIS";
  if (band === "PARTIAL_LEAK_WARN") return "badge settled";
  if (band === "JAILBROKEN_SLASH") return "badge cancelled";
  return "badge eval-pending";
}

export function BattleRoom(props: Props) {
  const { tournament, submissions, comments, connected, busy, stage, hash } = props;
  const [moniker, setMoniker] = useState("Operator");
  const [payload, setPayload] = useState("");
  const [bond, setBond] = useState(100);
  const [faucetAmount, setFaucetAmount] = useState(5000);
  const [commentFor, setCommentFor] = useState<number>(0);
  const [commentMsg, setCommentMsg] = useState("");
  const [commentStance, setCommentStance] = useState<Stance>("ANALYSIS");
  const [challengeFor, setChallengeFor] = useState<number>(0);
  const [challengeUrl, setChallengeUrl] = useState("https://example.com/exploit-proof");
  const [challengeBond, setChallengeBond] = useState(100);

  const token = tournament?.mandatory_fact_token ?? "";
  const hasToken = useMemo(
    () => token.length > 0 && payload.toLowerCase().includes(token.toLowerCase()),
    [payload, token],
  );
  const lenOk = payload.length >= SCORE.payloadMin && payload.length <= SCORE.payloadMax;
  const bondOk = bond >= SCORE.bondMin && bond <= SCORE.bondMax;

  if (!tournament) {
    return (
      <div className="panel">
        <h2 className="section-title">Live Battle Room</h2>
        <div className="empty">Select a tournament to enter the arena.</div>
      </div>
    );
  }

  const isOpen = tournament.status === "OPEN";
  const now = Math.floor(Date.now() / 1000);
  const windowClosed = Number(tournament.challenge_window_clock) <= now;
  const hasEvaluatedLeader = submissions.some((s) => s.evaluated && !s.slashed);
  const canSettle = isOpen && windowClosed && Number(tournament.active_challenges) === 0 && hasEvaluatedLeader;
  const challengeTarget = submissions.find((s) => Number(s.submission_id) === challengeFor);

  const quickFill = () =>
    setPayload(
      `Phase one: establish a hardened foothold and validate the canonical source before acting. ` +
        `The defense is anchored on ${token} so every operator aligns on the same objective. ` +
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
        <span>Prize {Number(tournament.prize_pool_points)} AGT</span>
        <span>Best {Number(tournament.best_score)}</span>
        <span>Leader {shortAddr(tournament.current_leader)}</span>
        <span>Challenges {Number(tournament.active_challenges)}</span>
        <a href={tournament.reference_url} target="_blank" rel="noreferrer">
          Reference source <ExternalLink size={11} />
        </a>
      </div>

      {connected && (
        <>
          <div className="divider" />
          <div className="row wrap items-end gap-2">
            <div className="flex items-center gap-2 small muted">
              <Wallet size={14} /> AGT balance <span className="font-mono text-arena-cyan">{props.tokenBalance}</span>
            </div>
            <input
              type="number"
              min={1}
              max={SCORE.faucetMax}
              value={faucetAmount}
              onChange={(e) => setFaucetAmount(Number(e.target.value))}
              style={{ maxWidth: 140 }}
            />
            <button className="sm" disabled={busy || faucetAmount < 1} onClick={() => props.onFaucet(faucetAmount)}>
              <Droplets size={14} /> Faucet / Deposit
            </button>
            <button className="sm ghost" disabled={busy} onClick={props.onOpenInspector}>
              Inspect Consensus Prompt
            </button>
          </div>
        </>
      )}

      {isOpen && connected && (
        <>
          <div className="divider" />
          <h3 className="section-title">Defense Submission Console</h3>
          <label>Moniker (1..32)</label>
          <input value={moniker} onChange={(e) => setMoniker(e.target.value)} maxLength={32} />
          <label>Tactic payload ({SCORE.payloadMin}..{SCORE.payloadMax} chars)</label>
          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            maxLength={SCORE.payloadMax}
            placeholder={`Weave the mandatory token "${token}" into your defense...`}
          />
          <label>Defender bond (AGT, escrowed in the vault)</label>
          <input
            type="number"
            min={SCORE.bondMin}
            max={SCORE.bondMax}
            value={bond}
            onChange={(e) => setBond(Number(e.target.value))}
          />
          <div className="preflight">
            <span className={hasToken ? "ok" : "bad"}>
              {hasToken ? "✓ mandatory token present" : "✗ mandatory token missing"}
            </span>
            <span className={lenOk ? "ok" : "bad"}>
              {lenOk ? `✓ ${payload.length} chars` : `✗ ${payload.length} chars (need ${SCORE.payloadMin}..${SCORE.payloadMax})`}
            </span>
            <span className={bondOk ? "ok" : "bad"}>
              {bondOk ? `✓ bond ${bond} AGT` : `✗ bond (need ${SCORE.bondMin}..${SCORE.bondMax})`}
            </span>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={!connected || !hasToken || !lenOk || !bondOk || moniker.trim().length === 0 || busy}
              onClick={() => props.onSubmitTactic(moniker.trim(), payload, bond)}
            >
              Submit Defense (locks bond)
            </button>
            <button onClick={quickFill} disabled={busy}>
              Quick Fill Demo Defense
            </button>
          </div>
        </>
      )}

      <div className="divider" />
      <h3 className="section-title">Ranked Defenses</h3>
      {submissions.length === 0 && <div className="empty">No defenses yet. Be the first.</div>}
      {submissions.map((s, i) => {
        const mine = props.currentAddress && s.player.toLowerCase() === props.currentAddress.toLowerCase();
        const meta = bandMetaFor(s.defense_band, Number(s.robustness_anchor));
        const canChallenge =
          isOpen &&
          connected &&
          s.evaluated &&
          !s.slashed &&
          Number(s.active_challenge_id) === 0 &&
          !mine;
        return (
          <div className={`sub ${s.slashed ? "opacity-70" : ""}`} key={s.submission_id}>
            <div className="spread">
              <div>
                <span className="rank">#{i + 1}</span>{" "}
                <strong>{s.moniker}</strong>{" "}
                <span className="mono small muted">{shortAddr(s.player)}</span>
                {mine && <span className="badge">you</span>}
                {s.slashed && <span className="badge cancelled">slashed</span>}
              </div>
              <div className="scorepill">{Number(s.total_score)}/100</div>
            </div>
            <div className="bar" title={`det ${s.deterministic_score} + ai ${s.ai_verdict_score} + endorse ${Number(s.endorsements) * SCORE.endorseBonus}`}>
              <span style={{ width: `${Math.min(100, Number(s.total_score))}%` }} />
            </div>
            <div className="row wrap small muted" style={{ margin: "6px 0" }}>
              <span>det {Number(s.deterministic_score)}/40</span>
              <span>·</span>
              <span>ai {Number(s.ai_verdict_score)}/60</span>
              <span>·</span>
              <span>anchor {Number(s.robustness_anchor)}</span>
              <span>·</span>
              <span>{Number(s.endorsements)} endorsements</span>
              <span>·</span>
              <span>bond {Number(s.defender_bond)} {s.bond_locked ? "(locked)" : "(released)"}</span>
            </div>
            <div style={{ margin: "6px 0" }}>
              {s.evaluated ? (
                <span className={bandClass(s.defense_band)}>{meta.label} (Eligible to Win)</span>
              ) : (
                <span className="badge eval-pending">Awaiting Live AI Evaluation</span>
              )}
              {Number(s.active_challenge_id) > 0 && (
                <span className="badge CHALLENGE ml-2">open challenge #{Number(s.active_challenge_id)}</span>
              )}
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
                disabled={!connected || !isOpen || s.evaluated || s.slashed || busy}
                onClick={() => props.onEvaluate(s.submission_id)}
                title="Runs validators' web fetch plus the exact 4-anchor comparative consensus"
              >
                Trigger Live AI Consensus
              </button>
              <button
                className="sm"
                disabled={!connected || mine || busy || !isOpen || s.slashed}
                onClick={() => props.onEndorse(s.submission_id)}
                title={isOpen ? "Endorse this submission" : "Endorsements close once the tournament is settled or cancelled"}
              >
                + Endorse
              </button>
              <button
                className="sm ghost"
                disabled={!canChallenge || busy}
                onClick={() => {
                  setChallengeFor(Number(s.submission_id));
                  setChallengeBond(Number(s.defender_bond));
                }}
                title="Stake a matching bond and challenge this defense with an exploit proof"
              >
                <Swords size={13} /> Challenge
              </button>
              <button
                className="sm ghost"
                disabled={!connected}
                onClick={() => setCommentFor(Number(s.submission_id))}
              >
                Comment
              </button>
            </div>
          </div>
        );
      })}

      {challengeTarget && (
        <div className="rounded-lg border border-arena-line p-3 mt-2">
          <div className="text-sm font-semibold">
            Challenge defense #{Number(challengeTarget.submission_id)} ({challengeTarget.moniker})
          </div>
          <p className="small muted mt-1">
            A matching bond of {Number(challengeTarget.defender_bond)} AGT is locked until live
            consensus resolves the exploit proof.
          </p>
          <label>Exploit proof URL</label>
          <input value={challengeUrl} onChange={(e) => setChallengeUrl(e.target.value)} />
          <label>Challenger bond (must match defender bond)</label>
          <input
            type="number"
            min={SCORE.bondMin}
            max={SCORE.bondMax}
            value={challengeBond}
            onChange={(e) => setChallengeBond(Number(e.target.value))}
          />
          <div className="row wrap mt-2">
            <button
              className="accent"
              disabled={busy || challengeBond !== Number(challengeTarget.defender_bond)}
              onClick={() => props.onChallenge(Number(challengeTarget.submission_id), challengeUrl, challengeBond)}
            >
              Stake Bond & File Challenge
            </button>
            <button className="ghost" disabled={busy} onClick={() => setChallengeFor(0)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="divider" />
      <h3 className="section-title">On-chain Red-Team Discussion</h3>
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
          <select value={commentFor} onChange={(e) => setCommentFor(Number(e.target.value))}>
            <option value={0}>select submission...</option>
            {submissions.map((s) => (
              <option key={s.submission_id} value={s.submission_id}>
                #{s.submission_id} · {s.moniker}
              </option>
            ))}
          </select>
          <label>Message (1..280)</label>
          <input value={commentMsg} onChange={(e) => setCommentMsg(e.target.value)} maxLength={280} />
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

      {isOpen && connected && (
        <>
          <div className="divider" />
          <div className="row wrap items-center">
            <button className="accent" disabled={busy || !canSettle} onClick={props.onSettle}>
              Settle Tournament (invariant winner)
            </button>
            <button
              className="ghost"
              disabled={busy || !props.isCreator || Number(tournament.entry_count) > 0}
              onClick={props.onCancel}
            >
              Cancel Empty (creator)
            </button>
          </div>
          <div className="small muted mt-1">
            {windowClosed
              ? Number(tournament.active_challenges) === 0
                ? hasEvaluatedLeader
                  ? "Window closed and no open challenges: settlement pays the live-evaluated, un-slashed leader."
                  : "Window closed, but no live-evaluated leader exists yet."
                : "Window closed, but an exploit challenge is still open."
              : "Challenge window still open: the PAPITO max-liability rule keeps the pot and bonds locked."}
          </div>
        </>
      )}

      <TxStepper stage={stage} hash={hash} />
    </div>
  );
}
