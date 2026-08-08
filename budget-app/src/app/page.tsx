import Link from "next/link";
import { listSnapshots, getAccounts, getMonths } from "@/lib/queries";
import { AccountBars } from "@/components/AccountBars";
import { MonthColumns } from "@/components/MonthColumns";
import { compact, money, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const CAT_SHORT: Record<string, string> = {
  "Personnel Expense": "Personnel",
  OTPS: "OTPS",
  "Uncontrollable OTPS": "Uncontrollable",
};

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ snapshot?: string }>;
}) {
  const { snapshot: requested } = await searchParams;
  const snapshots = await listSnapshots();

  if (snapshots.length === 0) {
    return (
      <div className="empty">
        <div className="big">No report has been uploaded yet</div>
        <p>
          Once the first Budget Detail YTD export is uploaded, this page shows
          it — and every month after that stays available here.
        </p>
        <Link className="btn" href="/upload">Upload a report</Link>
      </div>
    );
  }

  const current =
    snapshots.find((s) => s.id === requested) ?? snapshots[0];

  const [accounts, months] = await Promise.all([
    getAccounts(current.id),
    getMonths(current.id),
  ]);

  const expenses = accounts.filter((a) => a.type === "Expense");
  const revenue = accounts.filter((a) => a.type === "Revenue");

  const postedGl = expenses.reduce((t, a) => t + a.postedGl, 0);
  const encumbrance = expenses.reduce((t, a) => t + a.encumbrance, 0);
  const preEncumbrance = expenses.reduce((t, a) => t + a.preEncumbrance, 0);
  const budget = expenses.reduce((t, a) => t + a.revisedBudget, 0);
  const available = budget - postedGl - encumbrance - preEncumbrance;
  const totalCommitted = expenses.reduce((t, a) => t + a.committed, 0);

  const tiles: [string, number, string][] = [
    ["Revised budget", budget, `FY${String(current.fiscalYear).slice(-2)} · ${expenses.length} expense accounts`],
    ["Posted to GL", postedGl, `${money(postedGl)} · ${pct(postedGl, budget)} of budget`],
    ["Encumbered", encumbrance, `${money(encumbrance)} · ${pct(encumbrance, budget)} of budget`],
    ["Pre-encumbered", preEncumbrance, `${money(preEncumbrance)} · ${pct(preEncumbrance, budget)} of budget`],
    ["Available balance", available, `${money(available)} · ${pct(available, budget)} of budget`],
  ];

  return (
    <>
      <div className="page-head">
        <h1>Where the Money Is Going — FY{String(current.fiscalYear).slice(-2)} Year to Date</h1>
        <p className="sub">
          Office of Global Inclusion (Org 01006) · Fund 10 – Operating · Activity
          through {current.asOfDate} · Expenses posted to the general ledger plus
          open encumbrances, by account.
        </p>
      </div>

      {snapshots.length > 1 && (
        <nav className="snapbar" aria-label="Choose a month">
          <span className="lbl">Snapshot</span>
          {snapshots.map((s) => (
            <Link
              key={s.id}
              href={`/?snapshot=${s.id}`}
              className="chip"
              data-active={s.id === current.id}
            >
              {s.periodLabel}
            </Link>
          ))}
        </nav>
      )}

      <section className="kpis" aria-label="Summary figures">
        {tiles.map(([label, value, sub]) => (
          <div className="tile" key={label}>
            <div className="label">{label}</div>
            <div className="value">{compact(value)}</div>
            <div className="subv">{sub}</div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Top accounts by committed spend</h2>
          <div className="legend">
            <span className="key"><span className="swatch s1" />Posted to GL</span>
            <span className="key"><span className="swatch s2" />Encumbered</span>
          </div>
        </div>
        <p className="desc">
          Largest expense accounts by posted + encumbered dollars; remaining
          accounts are folded into one bar. Full detail in the table below.
        </p>
        <div className="chart-scroll">
          <AccountBars accounts={accounts} />
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Posted to GL by month</h2></div>
        <p className="desc">
          Fiscal year runs September through August. The final month is partial
          where activity stops mid-month.
        </p>
        <div className="chart-scroll">
          <MonthColumns months={months} />
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>All expense accounts</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="txt">Code</th>
                <th className="txt">Account description</th>
                <th className="txt">Category</th>
                <th>Posted to GL</th>
                <th>Encumbered</th>
                <th>Pre-enc.</th>
                <th>Committed</th>
                <th>Share</th>
                <th>Budget</th>
                <th>Available</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((a) => (
                <tr key={a.code}>
                  <td className="code">{a.code}</td>
                  <td className="txt">{a.description}</td>
                  <td className="cat">{CAT_SHORT[a.category] ?? a.category}</td>
                  <td>{money(a.postedGl)}</td>
                  <td>{money(a.encumbrance)}</td>
                  <td>{a.preEncumbrance ? money(a.preEncumbrance) : "—"}</td>
                  <td>{money(a.committed)}</td>
                  <td>{pct(a.committed, totalCommitted)}</td>
                  <td>{a.revisedBudget ? money(a.revisedBudget) : "—"}</td>
                  <td>{a.revisedBudget ? money(a.available) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="txt" colSpan={3}>Total ({expenses.length} accounts)</td>
                <td>{money(postedGl)}</td>
                <td>{money(encumbrance)}</td>
                <td>{money(preEncumbrance)}</td>
                <td>{money(totalCommitted)}</td>
                <td>100.0%</td>
                <td>{money(budget)}</td>
                <td>{money(available)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="footnote">
          <p>
            Committed = posted to GL + encumbrances. Available = revised budget −
            posted − encumbered − pre-encumbered. Negative amounts are credits,
            refunds, or reversals. Accounts with no budget line show &ldquo;—&rdquo;.
          </p>
          {revenue.length > 0 && (
            <p>
              {revenue.length} revenue line{revenue.length === 1 ? "" : "s"} excluded
              above:{" "}
              {revenue.map((r) => `${r.code} · ${r.description}, ${money(r.postedGl)} posted`).join("; ")}.
            </p>
          )}
          <p>
            Source: {current.sourceFilename} ({current.rowCount.toLocaleString("en-US")} journal
            lines) · Snapshot {current.periodLabel}.
          </p>
        </div>
      </section>
    </>
  );
}
