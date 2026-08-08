import { pool, num } from "./db";

export interface Snapshot {
  id: string;
  fiscalYear: number;
  asOfDate: string;
  periodLabel: string;
  sourceFilename: string;
  rowCount: number;
  uploadedAt: string;
}

export interface AccountRow {
  code: string;
  description: string;
  type: string;
  category: string;
  postedGl: number;
  encumbrance: number;
  preEncumbrance: number;
  revisedBudget: number;
  committed: number;
  available: number;
}

export interface MonthRow {
  period: string;
  periodIndex: number;
  category: string;
  postedGl: number;
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const { rows } = await pool.query(
    `select id, fiscal_year, as_of_date, period_label,
            source_filename, row_count, uploaded_at
       from snapshots
      where status = 'published'
      order by fiscal_year desc, as_of_date desc`,
  );
  return rows.map((r) => ({
    id: r.id,
    fiscalYear: r.fiscal_year,
    asOfDate: r.as_of_date.toISOString().slice(0, 10),
    periodLabel: r.period_label,
    sourceFilename: r.source_filename,
    rowCount: r.row_count,
    uploadedAt: r.uploaded_at.toISOString(),
  }));
}

export async function getAccounts(snapshotId: string): Promise<AccountRow[]> {
  const { rows } = await pool.query(
    `select account_code, account_description, account_type, account_category,
            posted_gl, encumbrance, pre_encumbrance, revised_budget,
            committed, available
       from account_totals
      where snapshot_id = $1
      order by committed desc`,
    [snapshotId],
  );
  return rows.map((r) => ({
    code: r.account_code,
    description: r.account_description,
    type: r.account_type,
    category: r.account_category,
    postedGl: num(r.posted_gl),
    encumbrance: num(r.encumbrance),
    preEncumbrance: num(r.pre_encumbrance),
    revisedBudget: num(r.revised_budget),
    committed: num(r.committed),
    available: num(r.available),
  }));
}

export async function getMonths(snapshotId: string): Promise<MonthRow[]> {
  const { rows } = await pool.query(
    `select accounting_period, period_index, account_category, posted_gl
       from period_totals
      where snapshot_id = $1
      order by period_index`,
    [snapshotId],
  );
  return rows.map((r) => ({
    period: r.accounting_period,
    periodIndex: r.period_index,
    category: r.account_category,
    postedGl: num(r.posted_gl),
  }));
}
