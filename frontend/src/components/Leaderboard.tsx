import type { LeaderRow } from "../lib/types";
import { shortAddr } from "./common";

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  return (
    <div className="panel">
      <h2 className="section-title">Global Leaderboard</h2>
      {rows.length === 0 ? (
        <div className="empty">No players yet. Submit a tactic to claim XP.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th className="right">Points</th>
              <th className="right">Wins</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.address}>
                <td className="rank">{i + 1}</td>
                <td className="mono">{shortAddr(r.address)}</td>
                <td className="right mono">{Number(r.points)}</td>
                <td className="right mono">{Number(r.wins)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
