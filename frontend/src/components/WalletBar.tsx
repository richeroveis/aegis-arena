import { CONTRACT_ADDRESS, explorerAddressUrl } from "../config";
import type { WalletMode } from "../lib/wallet";
import { shortAddr } from "./common";

interface Props {
  mode: WalletMode;
  address: string | null;
  online: boolean;
  onBurner: () => void;
  onNewBurner: () => void;
  onMetaMask: () => void;
  onDisconnect: () => void;
}

export function WalletBar({
  mode,
  address,
  online,
  onBurner,
  onNewBurner,
  onMetaMask,
  onDisconnect,
}: Props) {
  return (
    <div className="header">
      <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="AegisArena logo" />
      <div className="brand grow">
        <h1>AEGISARENA</h1>
        <div className="tag">
          GenLayer tactical tournaments · resolved against live web sources
        </div>
      </div>

      <div className="row wrap">
        <span className={`badge ${online ? "open" : "cancelled"}`}>
          <span className={`dot ${online ? "live" : "down"}`} />
          {online ? "studionet live" : "rpc unreachable"}
        </span>
        <a
          className="badge mono"
          href={explorerAddressUrl(CONTRACT_ADDRESS)}
          target="_blank"
          rel="noreferrer"
        >
          {shortAddr(CONTRACT_ADDRESS)}
        </a>
      </div>

      <div className="row wrap">
        {mode === "none" ? (
          <>
            <button className="primary" onClick={onBurner}>
              Enter Arena (1-click burner)
            </button>
            <button onClick={onMetaMask}>Connect Wallet</button>
          </>
        ) : (
          <>
            <span className="badge">
              {mode === "burner" ? "burner" : "wallet"} · {shortAddr(address)}
            </span>
            {mode === "burner" && (
              <button className="sm" onClick={onNewBurner}>
                New Burner Identity
              </button>
            )}
            <button className="sm ghost" onClick={onDisconnect}>
              Exit
            </button>
          </>
        )}
      </div>
    </div>
  );
}
