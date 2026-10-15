import { explorerTxUrl } from "../config";
import type { TxStage } from "../lib/types";

export const shortAddr = (addr?: string | null) =>
  !addr ? "0x0000…0000" : addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export function StatusBadge({ status }: { status: string }) {
  const cls = status.toLowerCase();
  return <span className={`badge ${cls}`}>{status}</span>;
}

const STAGES: { key: TxStage; label: string; n: number }[] = [
  { key: "signing", label: "Signing", n: 1 },
  { key: "broadcast", label: "Broadcast to Studionet", n: 2 },
  { key: "consensus", label: "Validator Consensus", n: 3 },
  { key: "finalized", label: "Finalized", n: 4 },
];

const ORDER: TxStage[] = ["signing", "broadcast", "consensus", "finalized"];

export function TxStepper({ stage, hash }: { stage: TxStage; hash?: string }) {
  if (stage === "idle") return null;
  const activeIdx = stage === "error" ? 0 : ORDER.indexOf(stage);
  return (
    <div className="stepper">
      {STAGES.map((s, i) => {
        const state =
          stage === "error"
            ? i === 0
              ? "err"
              : ""
            : i < activeIdx
              ? "done"
              : i === activeIdx
                ? "active"
                : "";
        return (
          <div key={s.key} className={`step ${state}`}>
            <span className="box">{state === "done" ? "✓" : state === "err" ? "!" : s.n}</span>
            <span>{s.label}</span>
          </div>
        );
      })}
      {hash && (
        <a className="mono small" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
          {shortAddr(hash)}
        </a>
      )}
    </div>
  );
}

export function Toast({
  toast,
  onClose,
}: {
  toast: { kind: "ok" | "bad"; text: string; hash?: string } | null;
  onClose: () => void;
}) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`}>
      <div className="panel">
        <div className="spread">
          <strong>{toast.kind === "ok" ? "Confirmed" : "Attention"}</strong>
          <button className="sm ghost" onClick={onClose}>
            dismiss
          </button>
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          {toast.text}
        </div>
        {toast.hash && (
          <a className="mono small" href={explorerTxUrl(toast.hash)} target="_blank" rel="noreferrer">
            View transaction {shortAddr(toast.hash)}
          </a>
        )}
      </div>
    </div>
  );
}
