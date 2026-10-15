import type { Tournament } from "../lib/types";
import { StatusBadge } from "./common";

interface Props {
  tournaments: Tournament[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
}

export function TournamentList({ tournaments, selectedId, onSelect, onCreate }: Props) {
  return (
    <div className="panel">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Tournament Explorer
        </h2>
        <button className="sm primary" onClick={onCreate}>
          + New Tournament
        </button>
      </div>
      {tournaments.length === 0 ? (
        <div className="empty">No tournaments on-chain yet. Launch the first one.</div>
      ) : (
        <div className="tlist">
          {tournaments.map((t) => (
            <button
              key={t.tournament_id}
              className={`panel tcard ${selectedId === t.tournament_id ? "active" : ""}`}
              onClick={() => onSelect(t.tournament_id)}
            >
              <div className="spread">
                <h3>
                  #{t.tournament_id} · {t.title}
                </h3>
                <StatusBadge status={t.status} />
              </div>
              <div className="row wrap small muted">
                <span>Prize {Number(t.prize_pool_points)} pts</span>
                <span>·</span>
                <span>{Number(t.entry_count)} entries</span>
                <span>·</span>
                <span>Best {Number(t.best_score)}</span>
                <span>·</span>
                <span className="badge token">token: {t.mandatory_fact_token}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
