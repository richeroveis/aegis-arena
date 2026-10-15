import { useCallback, useEffect, useState } from "react";
import { BattleRoom } from "./components/BattleRoom";
import { CreateTournamentModal, type TournamentDraft } from "./components/CreateTournamentModal";
import { Leaderboard } from "./components/Leaderboard";
import { StatsBar } from "./components/StatsBar";
import { Toast } from "./components/common";
import { TournamentList } from "./components/TournamentList";
import { WalletBar } from "./components/WalletBar";
import {
  readComments,
  readLeaderboard,
  readStats,
  readSubmissions,
  readTournament,
  readTournaments,
  runWrite,
} from "./lib/arena";
import type { Stance } from "./config";
import type {
  ArenaComment,
  ArenaStats,
  LeaderRow,
  Submission,
  Tournament,
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

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<TxStage>("idle");
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "bad"; text: string; hash?: string } | null>(null);

  const loadDetail = useCallback(async (id: number) => {
    const [t, subs, com] = await Promise.all([
      readTournament(id),
      readSubmissions(id),
      readComments(id),
    ]);
    setTournament(t);
    setSubmissions(subs ?? []);
    setComments(com ?? []);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [st, ts, lb] = await Promise.all([readStats(), readTournaments(), readLeaderboard()]);
      setStats(st);
      setTournaments(ts ?? []);
      setLeaderboard(lb ?? []);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 25000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const selectTournament = useCallback(
    (id: number) => {
      setSelectedId(id);
      void loadDetail(id);
    },
    [loadDetail],
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
      after?: () => Promise<void> | void,
    ) => {
      const client = wallet.getWriteClient();
      if (!client) {
        setToast({ kind: "bad", text: "Connect a wallet or enter with a burner first." });
        return;
      }
      setBusy(true);
      setHash(undefined);
      const res = await runWrite(client, functionName, args, (s, h) => {
        setStage(s);
        if (h) setHash(h);
      });
      setBusy(false);
      if (res.ok) {
        setToast({ kind: "ok", text: successMsg, hash: res.hash });
        await refresh();
        if (selectedId !== null) await loadDetail(selectedId);
        if (after) await after();
      } else {
        setToast({ kind: "bad", text: res.message ?? "Transaction did not apply.", hash: res.hash });
      }
      window.setTimeout(() => setStage("idle"), 6000);
    },
    [wallet, refresh, loadDetail, selectedId],
  );

  const onSubmitTactic = (moniker: string, payload: string) =>
    doWrite("submit_tactic", [selectedId ?? 0, moniker, payload], "Tactic submitted on-chain.");

  const onEvaluate = (sid: number) =>
    doWrite("evaluate_tactic_live", [sid], "Live AI consensus recorded.");

  const onEndorse = (sid: number) =>
    doWrite("endorse_submission", [sid], "Endorsement added.");

  const onComment = (sid: number, moniker: string, message: string, stance: Stance) =>
    doWrite("post_arena_comment", [selectedId ?? 0, sid, moniker, message, stance], "Comment posted.");

  const onSettle = () => doWrite("settle_tournament", [selectedId ?? 0], "Tournament settled.");

  const onCancel = () => doWrite("cancel_tournament", [selectedId ?? 0], "Tournament cancelled.");

  const onCreate = (draft: TournamentDraft) =>
    doWrite(
      "create_tournament",
      [
        draft.title,
        draft.challenge_brief,
        draft.reference_url,
        draft.mandatory_fact_token,
        Number(draft.prize_pool_points),
      ],
      "Tournament created.",
      () => setModalOpen(false),
    );

  const isCreator =
    !!tournament &&
    !!wallet.address &&
    tournament.creator.toLowerCase() === wallet.address.toLowerCase();

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
            busy={busy}
            stage={stage}
            hash={hash}
            onSubmitTactic={onSubmitTactic}
            onEvaluate={onEvaluate}
            onEndorse={onEndorse}
            onComment={onComment}
            onSettle={onSettle}
            onCancel={onCancel}
          />
        </div>
        <div className="grid">
          <Leaderboard rows={leaderboard} />
          <div className="panel">
            <h2 className="section-title">How resolution works</h2>
            <p className="small muted" style={{ lineHeight: 1.6 }}>
              Every tactic is scored deterministically on-chain (structure, length efficiency and the
              mandatory fact token) for up to 40 points. The optional live path fetches the tournament
              reference URL through validators and runs an LLM comparative judgment for up to 60 more,
              so the outcome is independently verified rather than self-reported. Community endorsements
              add capped bonus points, and the creator settles the pot to the on-chain leader.
            </p>
          </div>
        </div>
      </div>

      <CreateTournamentModal
        open={modalOpen}
        busy={busy}
        stage={stage}
        hash={hash}
        onClose={() => setModalOpen(false)}
        onSubmit={onCreate}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
