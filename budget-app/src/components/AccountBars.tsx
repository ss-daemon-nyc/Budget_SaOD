import type { AccountRow } from "@/lib/queries";
import { compact, money, niceTicks, roundedRight } from "@/lib/format";

const WIDTH = 1090;
const GUTTER = 248;
const RIGHT = 74;
const BAND = 30;
const BAR = 18;
const AXIS = 26;
const TOP = 6;
const TOP_N = 15;

interface Row {
  label: string;
  code: string;
  postedGl: number;
  encumbrance: number;
  committed: number;
  revisedBudget: number;
  isOther?: boolean;
}

export function AccountBars({ accounts }: { accounts: AccountRow[] }) {
  const expenses = accounts
    .filter((a) => a.type === "Expense")
    .sort((a, b) => b.committed - a.committed);

  const top = expenses.filter((a) => a.committed > 0).slice(0, TOP_N);
  const rest = expenses.slice(top.length);

  const rows: Row[] = top.map((a) => ({
    label: a.description,
    code: a.code,
    postedGl: a.postedGl,
    encumbrance: a.encumbrance,
    committed: a.committed,
    revisedBudget: a.revisedBudget,
  }));

  if (rest.length) {
    const postedGl = rest.reduce((t, a) => t + a.postedGl, 0);
    const encumbrance = rest.reduce((t, a) => t + a.encumbrance, 0);
    rows.push({
      label: `All other accounts (${rest.length})`,
      code: "",
      postedGl,
      encumbrance,
      committed: postedGl + encumbrance,
      revisedBudget: rest.reduce((t, a) => t + a.revisedBudget, 0),
      isOther: true,
    });
  }

  if (!rows.length) return <p className="desc">No expense activity in this snapshot.</p>;

  const plotW = WIDTH - GUTTER - RIGHT;
  const height = TOP + rows.length * BAND + AXIS;
  const maxV = Math.max(...rows.map((r) => Math.max(r.committed, 0)), 1);
  const ticks = niceTicks(maxV, 5);
  const scaleMax = ticks[ticks.length - 1];
  const x = (v: number) => GUTTER + (v / scaleMax) * plotW;

  return (
    <svg
      width={WIDTH}
      height={height}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label="Top expense accounts by posted and encumbered dollars"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={x(t)} x2={x(t)} y1={TOP} y2={height - AXIS}
            className={t === 0 ? "axisline" : "gridline"}
          />
          <text x={x(t)} y={height - AXIS + 16} textAnchor="middle" className="tick-label">
            {compact(t)}
          </text>
        </g>
      ))}

      {rows.map((r, i) => {
        const y = TOP + i * BAND + (BAND - BAR) / 2;
        const glW = r.postedGl > 0 ? x(r.postedGl) - x(0) : 0;
        const encW = r.encumbrance > 0 ? x(r.encumbrance) - x(0) : 0;
        const label = r.label.length > 30 ? `${r.label.slice(0, 29)}…` : r.label;
        const detail = [
          r.isOther ? "Sum of accounts outside the top 15" : `Account ${r.code}`,
          `Posted to GL ${money(r.postedGl)}`,
          `Encumbered ${money(r.encumbrance)}`,
          `Committed ${money(r.committed)}`,
          `Revised budget ${money(r.revisedBudget)}`,
        ].join(" · ");

        return (
          <g className="brow" key={r.code || r.label}>
            <text x={GUTTER - 10} y={y + BAR / 2 + 4} textAnchor="end" className="row-label">
              {r.code && <tspan className="code">{r.code} </tspan>}
              {label}
            </text>

            {/* 2px surface gap separates the two segments — no stroke. */}
            {glW > 0 && encW > 0 ? (
              <>
                <rect x={x(0)} y={y} width={Math.max(glW - 1, 0.5)} height={BAR} className="seg seg-gl" />
                <path d={roundedRight(x(0) + glW + 1, y, Math.max(encW - 1, 1), BAR, 4)} className="seg seg-enc" />
              </>
            ) : glW > 0 ? (
              <path d={roundedRight(x(0), y, glW, BAR, 4)} className="seg seg-gl" />
            ) : encW > 0 ? (
              <path d={roundedRight(x(0), y, encW, BAR, 4)} className="seg seg-enc" />
            ) : null}

            {r.committed > 0 && (
              <text x={x(r.committed) + 8} y={y + BAR / 2 + 4} className="end-label">
                {compact(r.committed)}
              </text>
            )}

            <rect x={0} y={TOP + i * BAND} width={WIDTH} height={BAND} className="hit" tabIndex={0}>
              <title>{`${r.label} — ${detail}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
