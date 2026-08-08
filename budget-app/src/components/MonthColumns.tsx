import type { MonthRow } from "@/lib/queries";
import { compact, money, niceTicks, roundedTop } from "@/lib/format";

const FISCAL_MONTHS = [
  "September", "October", "November", "December",
  "January", "February", "March", "April",
  "May", "June", "July", "August",
];

const WIDTH = 1090;
const LEFT = 56;
const RIGHT = 12;
const TOP = 14;
const PLOT_H = 210;
const AXIS = 26;

export function MonthColumns({ months }: { months: MonthRow[] }) {
  // Roll the per-category rows up to one value per fiscal month.
  const byMonth = new Map<string, number>();
  for (const m of months) {
    byMonth.set(m.period, (byMonth.get(m.period) ?? 0) + m.postedGl);
  }
  const series = FISCAL_MONTHS.map((name) => ({
    name,
    short: name.slice(0, 3),
    value: byMonth.get(name) ?? 0,
  }));

  const height = TOP + PLOT_H + AXIS;
  const plotW = WIDTH - LEFT - RIGHT;
  const maxV = Math.max(...series.map((s) => s.value), 1);
  const ticks = niceTicks(maxV, 4);
  const scaleMax = ticks[ticks.length - 1];
  const y = (v: number) => TOP + PLOT_H - (v / scaleMax) * PLOT_H;
  const band = plotW / series.length;
  const colW = Math.min(24, band * 0.55);
  const peak = series.reduce((best, s, i) => (s.value > series[best].value ? i : best), 0);

  return (
    <svg
      width={WIDTH}
      height={height}
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label="Expense dollars posted to the general ledger by fiscal month"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={LEFT} x2={WIDTH - RIGHT} y1={y(t)} y2={y(t)}
            className={t === 0 ? "axisline" : "gridline"}
          />
          <text x={LEFT - 8} y={y(t) + 4} textAnchor="end" className="tick-label">
            {compact(t)}
          </text>
        </g>
      ))}

      {series.map((s, i) => {
        const cx = LEFT + i * band + band / 2;
        return (
          <g className="bcol" key={s.name}>
            {s.value > 0 && (
              <path
                d={roundedTop(cx - colW / 2, y(s.value), colW, y(0) - y(s.value), 4)}
                className="seg seg-gl"
              />
            )}
            {i === peak && s.value > 0 && (
              <text x={cx} y={y(s.value) - 6} textAnchor="middle" className="end-label">
                {compact(s.value)}
              </text>
            )}
            <text x={cx} y={TOP + PLOT_H + 17} textAnchor="middle" className="tick-label">
              {s.short}
            </text>
            <rect
              x={LEFT + i * band} y={TOP} width={band} height={PLOT_H + AXIS}
              className="hit" tabIndex={0}
            >
              <title>{`${s.name} — posted to GL ${money(s.value)}`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}
