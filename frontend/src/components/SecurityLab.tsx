import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, Gavel, ShieldAlert, Vault, XCircle } from "lucide-react";
import type { ExploitChallenge, Submission, Tournament } from "../lib/types";

export type GuardKind = "premature" | "unevaluated" | "endorse" | "vault";

export interface GuardResult {
  kind: GuardKind;
  ok: boolean;
  message: string;
}

interface Props {
  tournaments: Tournament[];
  tournament: Tournament | null;
  submissions: Submission[];
  challenges: ExploitChallenge[];
  busy: boolean;
  lastResult: GuardResult | null;
  onRunGuard: (kind: GuardKind, target: number) => void;
}

export function SecurityLab({ tournaments, tournament, submissions, challenges, busy, lastResult, onRunGuard }: Props) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000);
    return () => window.clearInterval(id);
  }, []);

  const evaluated = useMemo(
    () => submissions.filter((s) => s.evaluated && !s.slashed),
    [submissions],
  );

  const prematureTarget = useMemo(
    () =>
      tournaments.find(
        (t) => t.status === "OPEN" && Number(t.entry_count) > 0 && Number(t.challenge_window_clock) > now,
      ),
    [tournaments, now],
  );

  const unevaluatedTarget = useMemo(() => {
    if (!tournament || tournament.status !== "OPEN") return undefined;
    if (Number(tournament.challenge_window_clock) > now) return undefined;
    if (Number(tournament.active_challenges) > 0) return undefined;
    return evaluated.length === 0 ? tournament : undefined;
  }, [tournament, now, evaluated.length]);

  const settledWithSubmission = useMemo(
    () => (tournament && tournament.status === "SETTLED" ? tournament : undefined),
    [tournament],
  );
  const endorseTarget = settledWithSubmission
    ? submissions.find((s) => !s.slashed) ?? submissions[0]
    : undefined;

  const pendingChallenges = challenges.filter((c) => c.status === "PENDING").length;

  const card = (
    icon: ReactNode,
    title: string,
    description: string,
    enabled: boolean,
    onClick: () => void,
    action: string,
  ) => (
    <div className="rounded-lg border border-arena-line p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </div>
      <p className="small muted mt-1">{description}</p>
      <button className="sm accent mt-2" disabled={busy || !enabled} onClick={onClick}>
        {action}
      </button>
    </div>
  );

  return (
    <section className="panel mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title m-0 flex items-center gap-2">
          <ShieldAlert size={18} /> Security Guard Lab
        </h2>
        <span className="badge token">live revert probes</span>
      </div>
      <p className="small muted mt-2">
        Each probe sends a real studionet transaction that must revert. A finalized transaction
        with a reverted execution is the proof, and no state changes.
      </p>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {card(
          <Gavel size={16} />,
          "1. Premature Settlement Before Challenge Window",
          prematureTarget
            ? `Tournament #${prematureTarget.tournament_id} is still inside its challenge window. settle_tournament must revert.`
            : "No open tournament with entries is currently inside its challenge window.",
          !!prematureTarget,
          () => prematureTarget && onRunGuard("premature", Number(prematureTarget.tournament_id)),
          "Trigger premature settle",
        )}

        {card(
          <Ban size={16} />,
          "2. Unevaluated Leader Claim Revert",
          unevaluatedTarget
            ? `Tournament #${unevaluatedTarget.tournament_id} has no live-evaluated submission. Settlement must revert.`
            : "Select an OPEN tournament whose window is closed, with no open challenge, and no evaluated submission.",
          !!unevaluatedTarget,
          () => unevaluatedTarget && onRunGuard("unevaluated", Number(unevaluatedTarget.tournament_id)),
          "Trigger unevaluated claim",
        )}

        {card(
          <XCircle size={16} />,
          "3. Post-Settlement Endorsement Revert",
          endorseTarget
            ? `Endorsing submission #${endorseTarget.submission_id} in a SETTLED tournament must revert.`
            : "Select a SETTLED tournament with at least one submission to enable this probe.",
          !!endorseTarget,
          () => endorseTarget && onRunGuard("endorse", Number(endorseTarget.submission_id)),
          "Trigger frozen endorsement",
        )}

        {card(
          <Vault size={16} />,
          "4. Vault Invariant Read",
          "Reads check_vault_invariants: vault custody must equal pots plus locked defender and challenger bonds.",
          true,
          () => onRunGuard("vault", 0),
          "Verify vault invariant",
        )}
      </div>

      <div className="small muted mt-2">
        {pendingChallenges} pending challenge(s) in the selected tournament.
      </div>

      {lastResult && (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            lastResult.ok ? "border-arena-green" : "border-arena-amber"
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            {lastResult.ok ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
            {lastResult.kind} probe
          </div>
          <div className="small mt-1 break-all">{lastResult.message}</div>
        </div>
      )}
    </section>
  );
}
