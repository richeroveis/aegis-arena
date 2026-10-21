import { useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { FlaskConical, SlidersHorizontal, Zap } from "lucide-react";
import { ANCHORS, BAND_META, SCORE } from "../config";

function bandFor(anchor: number) {
  return BAND_META[anchor];
}

export function SimulatorPanel() {
  const [pot, setPot] = useState(5000);
  const [defenderBond, setDefenderBond] = useState(500);
  const [challengerBond, setChallengerBond] = useState(500);
  const [endorsements, setEndorsements] = useState(1);
  const [anchor, setAnchor] = useState<number>(100);

  const model = useMemo(() => {
    const det = 30;
    const ai = Math.floor((anchor * SCORE.aiMax) / 100);
    const total = Math.min(SCORE.totalMax, det + ai + endorsements * SCORE.endorseBonus);
    const band = bandFor(anchor);
    const slashed = anchor === 0;
    const defenderReceives = slashed ? 0 : pot + defenderBond;
    const challengerReceives = slashed ? defenderBond + challengerBond : 0;
    const challengerForfeit = slashed ? 0 : challengerBond;
    const defenderPayout = slashed ? 0 : defenderReceives + challengerBond;
    return {
      det,
      ai,
      total,
      band,
      slashed,
      defenderPayout,
      challengerReceives,
      challengerForfeit,
      prizePaid: slashed ? 0 : pot,
    };
  }, [anchor, challengerBond, defenderBond, endorsements, pot]);

  const run = () => {
    const burst = model.slashed ? 0.25 : 0.55;
    confetti({
      particleCount: model.slashed ? 90 : 140,
      spread: 70,
      origin: { y: 0.7 },
      colors: model.slashed
        ? ["#ff5d73", "#ffb43a", "#ffffff"]
        : ["#38f5a3", "#37e6ff", "#ffffff"],
      scalar: burst + 0.6,
    });
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
  ) => (
    <label className="block text-xs text-slate-300">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono text-arena-cyan">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-arena-cyan"
      />
    </label>
  );

  return (
    <section className="panel mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title m-0 flex items-center gap-2">
          <FlaskConical size={18} /> What-If Red-Team Exploit & Prize Slash Simulator
        </h2>
        <span className="badge token">local model, no RPC</span>
      </div>
      <p className="small muted mt-2">
        Move the sliders to model the exact Milestone v1 economy: prize pot, defender bond,
        challenger bond, endorsements and the discrete robustness anchor. The payout table
        follows the same invariant the contract settles on.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          {slider("Tournament pot (AGT)", pot, 100, 20000, 100, setPot)}
          {slider("Defender bond (AGT)", defenderBond, 10, 5000, 10, setDefenderBond)}
          {slider("Challenger bond (AGT)", challengerBond, 10, 5000, 10, setChallengerBond)}
          {slider("Community endorsements", endorsements, 0, 20, 1, setEndorsements)}

          <div>
            <span className="flex items-center gap-2 text-xs text-slate-300">
              <SlidersHorizontal size={14} /> Robustness anchor
            </span>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {ANCHORS.map((a) => (
                <button
                  key={a}
                  className={`sm ${anchor === a ? "accent" : ""}`}
                  onClick={() => setAnchor(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <button className="primary mt-1 flex items-center gap-2" onClick={run}>
            <Zap size={16} /> Simulate settlement
          </button>
        </div>

        <div className="rounded-xl border border-arena-line bg-arena-panel p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Defense band</div>
              <div className="text-lg font-semibold">{model.band.label}</div>
            </div>
            <div className="scorepill">{model.total}/100</div>
          </div>
          <p className="small muted mt-1">{model.band.blurb}</p>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg border border-arena-line p-2">
              <div className="text-slate-400">det</div>
              <div className="font-mono">{model.det}</div>
            </div>
            <div className="rounded-lg border border-arena-line p-2">
              <div className="text-slate-400">AI</div>
              <div className="font-mono">{model.ai}</div>
            </div>
            <div className="rounded-lg border border-arena-line p-2">
              <div className="text-slate-400">endorse</div>
              <div className="font-mono">{endorsements * SCORE.endorseBonus}</div>
            </div>
          </div>

          <table className="mt-3 w-full text-left text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1">Party</th>
                <th className="py-1 text-right">AGT payout</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              <tr className="border-t border-arena-line">
                <td className="py-1">Defender</td>
                <td className="py-1 text-right">{model.defenderPayout}</td>
              </tr>
              <tr className="border-t border-arena-line">
                <td className="py-1">Red-team challenger</td>
                <td className="py-1 text-right">{model.challengerReceives}</td>
              </tr>
              <tr className="border-t border-arena-line">
                <td className="py-1">Prize paid from vault</td>
                <td className="py-1 text-right">{model.prizePaid}</td>
              </tr>
              <tr className="border-t border-arena-line">
                <td className="py-1">Challenger bond forfeited</td>
                <td className="py-1 text-right">{model.challengerForfeit}</td>
              </tr>
            </tbody>
          </table>

          <p className="small muted mt-2">
            {model.slashed
              ? "Jailbroken: the defender bond and the challenger bond both leave the vault to the challenger, and the submission is disqualified from leading."
              : "Defense holds: the prize and defender bond leave the vault to the defender, and a failed challenge bond is forfeited to the defender."}
          </p>
        </div>
      </div>
    </section>
  );
}
