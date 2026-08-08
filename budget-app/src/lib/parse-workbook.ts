import { readFirstSheet, XlsxError, type CellValue } from "./xlsx-reader";

/**
 * Parser for the "Budget Detail YTD Report" export.
 *
 * Design rule, from the build plan: columns are matched BY HEADER NAME, never
 * by position, and a sheet whose headers don't match is REJECTED rather than
 * parsed on a best guess. A failed upload you can fix in five minutes is
 * infinitely better than a published report that is quietly wrong.
 */

/** Columns we read. Every one of these must be present or the parse fails. */
const COLUMNS = {
  accountCode: "Account Code",
  accountDescription: "Account Description",
  fund: "Fund",
  org: "Org",
  program: "Program",
  project: "Project",
  accountingPeriod: "Accounting Period",
  fiscalYear: "Fiscal Year",
  vendor: "Vendor",
  journalDate: "Journal Date",
  journalId: "Journal Id",
  lineDescription: "Line Description",
  source: "Source",
  journalRef: "Jrnl Ref / PO / Vchr",
  amountPostedGl: "Amount Posted to GL",
  revisedBudget: "Revised Budget",
  encumbrance: "Encumbrance",
  accountType: "Account Type",
  accountCategory: "Account Category",
  preEncumbrance: "Pre Encumbrance",
} as const;

type ColumnKey = keyof typeof COLUMNS;

/**
 * Columns present in the export that we deliberately ignore. Listing them
 * explicitly means a genuinely unexpected column still surfaces as a warning
 * instead of passing unnoticed.
 */
const IGNORED_COLUMNS = ["Account Class Sort", "Account Category Sort"];

/** Fiscal year runs September (1) through August (12). */
const FISCAL_MONTHS = [
  "September", "October", "November", "December",
  "January", "February", "March", "April",
  "May", "June", "July", "August",
];

export class WorkbookError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "WorkbookError";
    this.detail = detail;
  }
}

export const periodIndex = (month: string): number => {
  const i = FISCAL_MONTHS.indexOf(month);
  if (i === -1) throw new WorkbookError(`Unrecognised accounting period "${month}".`);
  return i + 1;
};

export interface LedgerLine {
  accountCode: string;
  accountDescription: string;
  fund: string | null;
  org: string | null;
  program: string | null;
  project: string | null;
  accountingPeriod: string | null;
  fiscalYear: number | null;
  vendor: string | null;
  journalDate: Date | null;
  journalId: string | null;
  lineDescription: string | null;
  source: string | null;
  journalRef: string | null;
  amountPostedGl: number;
  revisedBudget: number;
  encumbrance: number;
  preEncumbrance: number;
  accountType: string | null;
  accountCategory: string | null;
}

export interface AccountTotal {
  accountCode: string;
  accountDescription: string;
  accountType: string;
  accountCategory: string;
  postedGl: number;
  encumbrance: number;
  preEncumbrance: number;
  revisedBudget: number;
}

export interface PeriodTotal {
  accountingPeriod: string;
  periodIndex: number;
  accountCategory: string;
  postedGl: number;
}

export interface ParsedWorkbook {
  fiscalYear: number;
  asOfDate: Date;
  periodLabel: string;
  rowCount: number;
  lines: LedgerLine[];
  accountTotals: AccountTotal[];
  periodTotals: PeriodTotal[];
  warnings: string[];
}

/** Header comparison ignores case, surrounding space and repeated inner space. */
const normalise = (s: unknown): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The export writes "-" and " " where a value is absent. */
function asText(v: CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

function asNumber(v: CellValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (s === "" || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function asDate(v: CellValue): Date | null {
  if (v instanceof Date) return v;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function parseWorkbook(
  buffer: Buffer,
  filename: string,
): Promise<ParsedWorkbook> {
  let sheet;
  try {
    sheet = readFirstSheet(buffer);
  } catch (err) {
    if (err instanceof XlsxError) {
      throw new WorkbookError(`"${filename}" could not be read. ${err.message}`, err.detail);
    }
    throw new WorkbookError(
      `"${filename}" could not be opened as an Excel workbook.`,
      err instanceof Error ? err.message : undefined,
    );
  }

  if (sheet.rows.length < 2) {
    throw new WorkbookError(
      `"${filename}" has no data rows.`,
      "The sheet must have a header row followed by at least one journal line.",
    );
  }

  // ---- Header mapping: by name, never by position -------------------------
  const headerRow = sheet.rows[0];
  const found = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const key = normalise(asText(cell));
    if (key && !found.has(key)) found.set(key, i);
  });

  const index = {} as Record<ColumnKey, number>;
  const missing: string[] = [];
  for (const [key, header] of Object.entries(COLUMNS) as [ColumnKey, string][]) {
    const col = found.get(normalise(header));
    if (col === undefined) missing.push(header);
    else index[key] = col;
  }

  if (missing.length > 0) {
    throw new WorkbookError(
      `"${filename}" is missing ${missing.length} required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      `This usually means the finance system's export format changed. Nothing was imported. Columns found in the file: ${[...found.keys()].join(", ")}.`,
    );
  }

  const expected = new Set(
    [...Object.values(COLUMNS), ...IGNORED_COLUMNS].map(normalise),
  );
  const warnings: string[] = [];
  for (const key of found.keys()) {
    if (!expected.has(key)) warnings.push(`Unexpected column "${key}" was ignored.`);
  }

  // ---- Rows ---------------------------------------------------------------
  const headerWidth = headerRow.length;
  const lines: LedgerLine[] = [];
  const at = new Map<string, AccountTotal>();
  const pt = new Map<string, PeriodTotal>();
  const yearCounts = new Map<number, number>();
  let maxDate: Date | null = null;

  for (let r = 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (row.every((c) => c === null || c === "")) continue; // blank spacer

    /*
     * The export omits the optional cell-reference attributes, so a cell's
     * column is its position. A row of a different width would silently shift
     * every value one column across — reject it instead.
     */
    if (row.length !== headerWidth) {
      throw new WorkbookError(
        `"${filename}" has a malformed row at line ${r + 1}.`,
        `The header has ${headerWidth} columns but this row has ${row.length}. Because this export does not label cells with their column, a row of the wrong width cannot be read safely. Nothing was imported.`,
      );
    }

    const accountCode = asText(row[index.accountCode]);
    if (!accountCode) continue; // spacer or trailing total row

    const line: LedgerLine = {
      accountCode,
      accountDescription: asText(row[index.accountDescription]) ?? "",
      fund: asText(row[index.fund]),
      org: asText(row[index.org]),
      program: asText(row[index.program]),
      project: asText(row[index.project]),
      accountingPeriod: asText(row[index.accountingPeriod]),
      fiscalYear: (() => {
        const n = asNumber(row[index.fiscalYear]);
        return n > 0 ? Math.trunc(n) : null;
      })(),
      vendor: asText(row[index.vendor]),
      journalDate: asDate(row[index.journalDate]),
      journalId: asText(row[index.journalId]),
      lineDescription: asText(row[index.lineDescription]),
      source: asText(row[index.source]),
      journalRef: asText(row[index.journalRef]),
      amountPostedGl: round2(asNumber(row[index.amountPostedGl])),
      revisedBudget: round2(asNumber(row[index.revisedBudget])),
      encumbrance: round2(asNumber(row[index.encumbrance])),
      preEncumbrance: round2(asNumber(row[index.preEncumbrance])),
      accountType: asText(row[index.accountType]),
      accountCategory: asText(row[index.accountCategory]),
    };
    lines.push(line);

    if (line.fiscalYear) {
      yearCounts.set(line.fiscalYear, (yearCounts.get(line.fiscalYear) ?? 0) + 1);
    }
    if (line.journalDate && (!maxDate || line.journalDate > maxDate)) {
      maxDate = line.journalDate;
    }

    const a = at.get(accountCode) ?? {
      accountCode,
      accountDescription: line.accountDescription,
      accountType: line.accountType ?? "Unknown",
      accountCategory: line.accountCategory ?? "Unknown",
      postedGl: 0,
      encumbrance: 0,
      preEncumbrance: 0,
      revisedBudget: 0,
    };
    a.postedGl += line.amountPostedGl;
    a.encumbrance += line.encumbrance;
    a.preEncumbrance += line.preEncumbrance;
    a.revisedBudget += line.revisedBudget;
    at.set(accountCode, a);

    if (
      line.accountType === "Expense" &&
      line.accountingPeriod &&
      line.accountCategory &&
      line.amountPostedGl !== 0
    ) {
      const k = `${line.accountingPeriod}|${line.accountCategory}`;
      const p = pt.get(k) ?? {
        accountingPeriod: line.accountingPeriod,
        periodIndex: periodIndex(line.accountingPeriod),
        accountCategory: line.accountCategory,
        postedGl: 0,
      };
      p.postedGl += line.amountPostedGl;
      pt.set(k, p);
    }
  }

  if (lines.length === 0) {
    throw new WorkbookError(
      `"${filename}" has the right columns but no journal lines.`,
      "Every row had an empty Account Code. Check the report was run for a period with activity.",
    );
  }
  if (!maxDate) {
    throw new WorkbookError(
      `"${filename}" has no usable Journal Date values.`,
      "The as-of date is taken from the latest journal date, so at least one row must carry one.",
    );
  }

  const fiscalYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!fiscalYear) {
    throw new WorkbookError(
      `"${filename}" has no Fiscal Year values.`,
      "Every snapshot must be attributable to a fiscal year.",
    );
  }
  if (yearCounts.size > 1) {
    warnings.push(
      `Rows span ${yearCounts.size} fiscal years (${[...yearCounts.keys()].sort().join(", ")}); the snapshot is filed under ${fiscalYear}.`,
    );
  }

  for (const a of at.values()) {
    a.postedGl = round2(a.postedGl);
    a.encumbrance = round2(a.encumbrance);
    a.preEncumbrance = round2(a.preEncumbrance);
    a.revisedBudget = round2(a.revisedBudget);
  }
  for (const p of pt.values()) p.postedGl = round2(p.postedGl);

  return {
    fiscalYear,
    asOfDate: maxDate,
    periodLabel: maxDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    rowCount: lines.length,
    lines,
    accountTotals: [...at.values()],
    periodTotals: [...pt.values()],
    warnings,
  };
}
