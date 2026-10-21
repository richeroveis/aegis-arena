import { useCallback, useEffect, useRef, useState } from "react";
import { BattleRoom } from "./components/BattleRoom";
import { ChallengeMonitor } from "./components/ChallengeMonitor";
import { CreateTournamentModal, type TournamentDraft } from "./components/CreateTournamentModal";
import { InspectorDrawer } from "./components/InspectorDrawer";
import { Leaderboard } from "./components/Leaderboard";
import { SecurityLab, type GuardKind, type GuardResult } from "./components/SecurityLab";
import { SimulatorPanel } from "./components/SimulatorPanel";
import { StatsBar } from "./components/StatsBar";
import { Toast } from "./components/common";
import { TournamentList } from "./components/TournamentList";
import { WalletBar } from "./components/WalletBar";
import {
  readBundle,
  readLeaderboard,
  readStats,
  readTokenBalance,
  readTournaments,
  readVaultInvariants,
  runWrite,
} from "./lib/arena";
import type { Stance } from "./config";
import type {
  ArenaComment,
  ArenaStats,
  ExploitChallenge,
  LeaderRow,
  Submission,
  Tournament,
  TournamentBundle,
  TxStage,
} from "./lib/types";
import { useWallet } from "./lib/wallet";

export default function App() {
  const wallet = useWallet();

  const [online, setOnline] = useState(true);
  const [stats, setStats] = useState<ArenaStats | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [comments, setComments] = useState<ArenaComment[]>([]);
  const [challenges, setChallenges] = useState<ExploitChallenge[]>([]);
  const [tokenBalance, setTokenBalance] = useState(0);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<TxStage>("idle");
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [guardResult, setGuardResult] = useState<GuardResult | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; text: string; hash?: string } | null>(null);
  // Guards the stepper reset: a finished write must not clear the stepper of
  // a newer write that started in the meantime.
  const writeSeq = useRef(0);

  const applyBundle = useCallback((bundle: TournamentBundle) => {
    setTournament(bundle?.tournament ?? null);
    setSubmissions(bundle?.submissions ?? []);
    setComments(bundle?.comments ?? []);
    setChallenges(bundle?.challenges ?? []);
  }, []);

  const loadBundle = useCallback(
    async (id: number) => {
      const bundle = await readBundle(id);
      applyBundle(bundle);
    },
    [applyBundle],
  );

  const refreshBalance = useCallback(async () => {
    if (!wallet.address) {
      setTokenBalance(0);
      return;
    }
    try {
      const balance = await readTokenBalance(wallet.address);
      setTokenBalance(Number(balance));
    } catch {
      /* transient read failure; keep the previous value */
    }
  }, [wallet.address]);

  const refresh = useCallback(async () => {
    // Three list reads plus one consolidated bundle keeps the initial page
    // load at four RPC calls, well below studionet rate limits.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const [st, ts, lb] = await Promise.all([readStats(), readTournaments(), readLeaderboard()]);
        setStats(st);
        setTournaments(ts ?? []);
        setLeaderboard(lb ?? []);
        setOnline(true);
        return;
      } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
      }
    }
    setOnline(false);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 30000);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const selectTournament = useCallback(
    (id: number) => {
      setSelectedId(id);
      void loadBundle(id);
    },
    [loadBundle],
  );

  // auto-select the first tournament once available
  useEffect(() => {
    if (selectedId === null && tournaments.length > 0) {
      selectTournament(Number(tournaments[0].tournament_id));
    }
  }, [tournaments, selectedId, selectTournament]);

  const doWrite = useCallback(
    async (
      functionName: string,
      args: (string | number | bigint)[],
      successMsg: string,
      options?: { leaderOnly?: boolean },
    ) => {
      const client = wallet.getWriteClient();
      if (!client) {
        setToast({ kind: "bad", text: "Connect a wallet or enter with a burner first." });
        return;
      }
      setBusy(true);
      setHash(undefined);
      const seq = ++writeSeq.current;
      const res = await runWrite(client, functionName, args, (s, h) => {
        setStage(s);
        if (h) setHash(h);
      }, options);
      setBusy(false);
      if (res.ok) {
        setToast({ kind: "ok", text: successMsg, hash: res.hash });
        await refresh();
        if (selectedId !== null) await loadBundle(selectedId);
        await refreshBalance();
      } else {
        setToast({ kind: "bad", text: res.message ?? "Transaction did not apply.", hash: res.hash });
      }
      window.setTimeout(() => {
        if (writeSeq.current === seq) setStage("idle");
      }, 6000);
    },
    [wallet, refresh, refreshBalance, loadBundle, selectedId],
  );

  const onSubmitTactic = (moniker: string, payload: string, bond: number) =>
    doWrite("submit_tactic", [selectedId ?? 0, moniker, payload, bond], "Defense submitted and bond locked.", {
      leaderOnly: true,
    });

  const onEvaluate = (sid: number) =>
    doWrite("evaluate_submission_live", [sid], "Live AI consensus recorded.");

  const onEndorse = (sid: number) => doWrite("endorse_submission", [sid], "Endorsement added.");

  const onChallenge = (sid: number, proofUrl: string, bond: number) =>
    doWrite("challenge_defense_submission", [sid, proofUrl, bond], "Exploit challenge filed and bond locked.");

  const onResolve = (cid: number) =>
    doWrite("resolve_exploit_challenge_live", [cid], "Exploit challenge resolved by live consensus.");

  const onComment = (sid: number, moniker: string, message: string, stance: Stance) =>
    doWrite("post_arena_comment", [selectedId ?? 0, sid, moniker, message, stance], "Comment posted.");

  const onSettle = () => doWrite("settle_tournament", [selectedId ?? 0], "Tournament settled to the invariant winner.");

  const onCancel = () => doWrite("cancel_tournament", [selectedId ?? 0], "Tournament cancelled and pot refunded.");

  const onFaucet = (amount: number) =>
    doWrite("faucet_or_deposit", [amount], "AGT credited to your ledger.", { leaderOnly: true });

  const onCreate = (draft: TournamentDraft) =>
    doWrite(
      "create_tournament",
      [
        draft.title,
        draft.challenge_brief,
        draft.reference_url,
        draft.mandatory_fact_token,
        Number(draft.prize_pool_points),
        Number(draft.challenge_window_seconds),
      ],
      "Tournament created and prize locked in the vault.",
    ).then(() => setModalOpen(false));

  const isCreator =
    !!tournament &&
    !!wallet.address &&
    tournament.creator.toLowerCase() === wallet.address.toLowerCase();

  const runGuard = useCallback(
    async (kind: GuardKind, target: number) => {
      if (kind === "vault") {
        try {
          const state = await readVaultInvariants();
          setGuardResult({
            kind,
            ok: Boolean(state.invariant_ok),
            message: `vault ${state.vault_custody_balance} = pots ${state.active_tournament_pots} + defender ${state.locked_defender_bonds} + challenger ${state.locked_challenger_bonds} | invariant_ok=${state.invariant_ok}`,
          });
        } catch (err) {
          setGuardResult({ kind, ok: false, message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      const client = wallet.getWriteClient();
      if (!client) {
        setGuardResult({ kind, ok: false, message: "Connect a wallet or burner to send the guard probe." });
        return;
      }
      setBusy(true);
      const functionName = kind === "endorse" ? "endorse_submission" : "settle_tournament";
      const res = await runWrite(client, functionName, [target], (s, h) => {
        setStage(s);
        if (h) setHash(h);
      });
      setBusy(false);
      setGuardResult({
        kind,
        ok: !res.ok,
        message: `${res.ok ? "UNEXPECTED SUCCESS" : "revert observed"} | status=${res.status ?? "n/a"} | consensus=${res.executionResult ?? "n/a"} | ${res.message ?? ""}`,
      });
      await refresh();
      if (selectedId !== null) await loadBundle(selectedId);
      window.setTimeout(() => setStage("idle"), 4000);
    },
    [wallet, refresh, loadBundle, selectedId],
  );

  return (
    <div className="app">
      <WalletBar
        mode={wallet.mode}
        address={wallet.address}
        online={online}
        onBurner={() => wallet.activateBurner()}
        onNewBurner={wallet.newBurnerIdentity}
        onMetaMask={async () => {
          const r = await wallet.connectMetaMask();
          if (!r.ok) setToast({ kind: "bad", text: r.message ?? "Wallet connect failed." });
        }}
        onDisconnect={wallet.disconnect}
      />

      <StatsBar stats={stats} />

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="grid">
          <TournamentList
            tournaments={tournaments}
            selectedId={selectedId}
            onSelect={selectTournament}
            onCreate={() => setModalOpen(true)}
          />
          <BattleRoom
            tournament={tournament}
            submissions={submissions}
            comments={comments}
            connected={wallet.mode !== "none"}
            isCreator={isCreator}
            currentAddress={wallet.address}
            tokenBalance={tokenBalance}
            busy={busy}
            stage={stage}
            hash={hash}
            onSubmitTactic={onSubmitTactic}
            onEvaluate={onEvaluate}
            onEndorse={onEndorse}
            onChallenge={onChallenge}
            onComment={onComment}
            onSettle={onSettle}
            onCancel={onCancel}
            onFaucet={onFaucet}
            onOpenInspector={() => setInspectorOpen(true)}
          />
        </div>
        <div className="grid">
          <Leaderboard rows={leaderboard} />
          <div className="panel">
            <h2 className="section-title">How resolution works</h2>
            <p className="small muted" style={{ lineHeight: 1.6 }}>
              The tournament pot is funded into the AGT custody vault at creation, and every
              defense submission locks a defender bond. A red-team challenger can stake a matching
              bond with an exploit proof before the challenge window closes. Both the benchmark
              evaluation and the exploit re-audit fetch evidence through validators and run one
              comparative judgment that must agree exactly on the discrete defense band, the
              robustness anchor (0, 45, 75, 100) and whether the exploit was reproduced. Only an
              evaluated, un-slashed submission can lead or claim the prize, and the ranking score
              and settlement winner always follow min(100, deterministic + AI verdict +
              endorsements x 2). Settlement is permissionless but blocked until the window closes
              and every challenge resolves. A reproduced jailbreak slashes the defender bond to the
              challenger and disqualifies the submission.
            </p>
          </div>
        </div>
      </div>

      <ChallengeMonitor
        tournament={tournament}
        submissions={submissions}
        challenges={challenges}
        busy={busy}
        onResolve={onResolve}
      />

      <SimulatorPanel />

      <SecurityLab
        tournaments={tournaments}
        tournament={tournament}
        submissions={submissions}
        challenges={challenges}
        busy={busy}
        lastResult={guardResult}
        onRunGuard={runGuard}
      />

      <CreateTournamentModal
        open={modalOpen}
        busy={busy}
        stage={stage}
        hash={hash}
        onClose={() => setModalOpen(false)}
        onSubmit={onCreate}
      />

      <InspectorDrawer
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        submissions={submissions}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
