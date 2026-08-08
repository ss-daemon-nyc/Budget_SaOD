# Budget Reporting — proof of concept

Upload the monthly **Budget Detail YTD** export; the report page renders from
the database rather than from a file baked at build time. This is Phase 1 of the build plan, minus authentication and the
review/diff screen.

Verified end to end against the real FY26 export: 814 journal lines, 58
accounts, activity 2025-09-01 → 2026-07-15.

## Run it

```bash
npm install
npm run db          # throwaway local Postgres + schema (needs a local postgres install)
cp .env.example .env.local
npm run build && npm start
```

Then open <http://localhost:3000/upload> and drop in the `.xlsx`.

## Pointing it at Supabase

Nothing in the code changes. Apply `db/001_schema.sql` in the Supabase SQL
editor, then set `DATABASE_URL` to the **Connection pooling** URI from
Project Settings → Database. TLS is enabled automatically for hosted URLs.

## How it is put together

| Path | What it does |
|---|---|
| `db/001_schema.sql` | The five tables. Runs unchanged locally and on Supabase. |
| `src/lib/xlsx-reader.ts` | Minimal OOXML reader (see note below). |
| `src/lib/parse-workbook.ts` | Maps columns **by header name**, validates, aggregates. |
| `src/lib/ingest.ts` | Writes one immutable snapshot inside a single transaction. |
| `src/app/api/upload/route.ts` | Upload endpoint; every failure returns a readable message. |
| `src/app/page.tsx` | The report, read from `account_totals` / `period_totals`. |

### Why there is a hand-written xlsx reader

The finance system's export omits the optional `r` position attributes on
`<row>` and `<c>` elements and writes every string inline. That is legal
OOXML — position is implied by document order — but **exceljs rejects the file
outright** (`Invalid row number in model`), and the SheetJS build published to
npm carries unpatched advisories. `src/lib/xlsx-reader.ts` reads the export as
written, and still supports `r` attributes and shared strings so a future
export that adds them keeps working.

Because column position is inferred from order, a row whose cell count differs
from the header is rejected rather than read — otherwise every value would
shift one column across, silently.

## Import rules

- **Snapshots are immutable.** Each upload is a separate `snapshots` row with
  its own copy of every journal line. Nothing is merged or deduplicated, so a
  restated prior period stays visible as a change between snapshots.
- **Columns are matched by header name.** A renamed or moved column fails the
  upload with a message naming the column; it never mis-reads.
- **All or nothing.** Parse and insert happen in one transaction.
- **The same file twice is refused** on a SHA-256 of its bytes.
- **One snapshot per fiscal year + as-of date.**

## Verified behaviour

| Case | Result |
|---|---|
| Real FY26 export | Imported; totals match an independent parse to the cent |
| Two columns physically swapped | Imported; **identical** totals (names, not positions) |
| A column renamed | Rejected, naming the missing column |
| A row missing one cell | Rejected, naming the line number |
| Same file re-uploaded | Rejected as a duplicate |
| Not a spreadsheet | Rejected with a readable reason |

## Not built yet

Authentication, Supabase Storage for the original workbooks, the pre-publish
diff screen, month-over-month comparison, and projections. See the build plan.
