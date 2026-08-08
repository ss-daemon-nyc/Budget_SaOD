import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { parseWorkbook, WorkbookError, type ParsedWorkbook } from "./parse-workbook";

export interface IngestResult {
  snapshotId: string;
  fiscalYear: number;
  asOfDate: string;
  periodLabel: string;
  rowCount: number;
  accountCount: number;
  warnings: string[];
}

/** Thrown when the workbook is fine but this snapshot cannot be accepted. */
export class IngestConflict extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "IngestConflict";
    this.detail = detail;
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Parse a workbook and write it as one immutable snapshot.
 *
 * Everything happens in a single transaction: either the whole month lands or
 * nothing does. There is no partial import to clean up.
 */
export async function ingestWorkbook(
  buffer: Buffer,
  filename: string,
): Promise<IngestResult> {
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  // Reject a re-upload of the identical file before doing any parsing work.
  const dup = await pool.query<{ period_label: string; uploaded_at: Date }>(
    "select period_label, uploaded_at from snapshots where file_sha256 = $1",
    [sha256],
  );
  if (dup.rowCount) {
    const d = dup.rows[0];
    throw new IngestConflict(
      "This exact file has already been uploaded.",
      `It was imported as "${d.period_label}" on ${d.uploaded_at.toISOString().slice(0, 10)}. If the finance system reissued the report, re-run the export — a genuinely new report will differ.`,
    );
  }

  const parsed: ParsedWorkbook = await parseWorkbook(buffer, filename);

  const client = await pool.connect();
  try {
    await client.query("begin");

    const existing = await client.query(
      "select period_label from snapshots where fiscal_year = $1 and as_of_date = $2",
      [parsed.fiscalYear, iso(parsed.asOfDate)],
    );
    if (existing.rowCount) {
      throw new IngestConflict(
        `A snapshot for FY${parsed.fiscalYear} through ${iso(parsed.asOfDate)} already exists.`,
        `It is filed as "${existing.rows[0].period_label}". Archive that snapshot first if this upload is meant to replace it.`,
      );
    }

    const snap = await client.query<{ id: string }>(
      `insert into snapshots
         (fiscal_year, as_of_date, period_label, source_filename,
          file_sha256, row_count, status, published_at)
       values ($1, $2, $3, $4, $5, $6, 'published', now())
       returning id`,
      [
        parsed.fiscalYear,
        iso(parsed.asOfDate),
        parsed.periodLabel,
        filename,
        sha256,
        parsed.rowCount,
      ],
    );
    const snapshotId = snap.rows[0].id;

    await insertLines(client, snapshotId, parsed);
    await insertAccountTotals(client, snapshotId, parsed);
    await insertPeriodTotals(client, snapshotId, parsed);

    await client.query("commit");

    return {
      snapshotId,
      fiscalYear: parsed.fiscalYear,
      asOfDate: iso(parsed.asOfDate),
      periodLabel: parsed.periodLabel,
      rowCount: parsed.rowCount,
      accountCount: parsed.accountTotals.length,
      warnings: parsed.warnings,
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Bulk insert in chunks — one round trip per few hundred rows, not per row. */
async function insertLines(
  client: PoolClient,
  snapshotId: string,
  parsed: ParsedWorkbook,
) {
  const COLS = 21;
  const CHUNK = 200;
  for (let i = 0; i < parsed.lines.length; i += CHUNK) {
    const slice = parsed.lines.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = slice.map((l, n) => {
      const b = n * COLS;
      values.push(
        snapshotId, l.accountCode, l.accountDescription, l.fund, l.org,
        l.program, l.project, l.accountingPeriod, l.fiscalYear, l.vendor,
        l.journalDate, l.journalId, l.lineDescription, l.source, l.journalRef,
        l.amountPostedGl, l.revisedBudget, l.encumbrance, l.preEncumbrance,
        l.accountType, l.accountCategory,
      );
      return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(",")})`;
    });
    await client.query(
      `insert into ledger_lines
         (snapshot_id, account_code, account_description, fund, org,
          program, project, accounting_period, fiscal_year, vendor,
          journal_date, journal_id, line_description, source, journal_ref,
          amount_posted_gl, revised_budget, encumbrance, pre_encumbrance,
          account_type, account_category)
       values ${tuples.join(",")}`,
      values,
    );
  }
}

async function insertAccountTotals(
  client: PoolClient,
  snapshotId: string,
  parsed: ParsedWorkbook,
) {
  const COLS = 9;
  const values: unknown[] = [];
  const tuples = parsed.accountTotals.map((a, n) => {
    const b = n * COLS;
    values.push(
      snapshotId, a.accountCode, a.accountDescription, a.accountType,
      a.accountCategory, a.postedGl, a.encumbrance, a.preEncumbrance,
      a.revisedBudget,
    );
    return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(",")})`;
  });
  if (!tuples.length) return;
  await client.query(
    `insert into account_totals
       (snapshot_id, account_code, account_description, account_type,
        account_category, posted_gl, encumbrance, pre_encumbrance, revised_budget)
     values ${tuples.join(",")}`,
    values,
  );
}

async function insertPeriodTotals(
  client: PoolClient,
  snapshotId: string,
  parsed: ParsedWorkbook,
) {
  const COLS = 5;
  const values: unknown[] = [];
  const tuples = parsed.periodTotals.map((p, n) => {
    const b = n * COLS;
    values.push(
      snapshotId, p.accountingPeriod, p.periodIndex, p.accountCategory, p.postedGl,
    );
    return `(${Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(",")})`;
  });
  if (!tuples.length) return;
  await client.query(
    `insert into period_totals
       (snapshot_id, accounting_period, period_index, account_category, posted_gl)
     values ${tuples.join(",")}`,
    values,
  );
}

export { WorkbookError };
