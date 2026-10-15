import type { ArenaStats } from "../lib/types";

export function StatsBar({ stats }: { stats: ArenaStats | null }) {
  const s = stats ?? {
    total_tournaments: 0,
    open: 0,
    settled: 0,
    cancelled: 0,
    total_submissions: 0,
    evaluated_submissions: 0,
    total_endorsements: 0,
    total_comments: 0,
  };
  const cells: [string, number][] = [
    ["Tournaments", s.total_tournaments],
    ["Open", s.open],
    ["Settled", s.settled],
    ["Submissions", s.total_submissions],
    ["Evaluated", s.evaluated_submissions],
    ["Endorsements", s.total_endorsements],
    ["Comments", s.total_comments],
    ["Cancelled", s.cancelled],
  ];
  return (
    <div className="stats">
      {cells.map(([label, value]) => (
        <div className="stat" key={label}>
          <div className="num">{Number(value) || 0}</div>
          <div className="lbl">{label}</div>
        </div>
      ))}
    </div>
  );
}
