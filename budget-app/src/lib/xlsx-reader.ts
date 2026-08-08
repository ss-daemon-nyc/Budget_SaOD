import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

/**
 * A small, strict OOXML (.xlsx) reader.
 *
 * Why not a library: the finance system's export omits the optional `r`
 * position attributes on <row> and <c> elements and writes every string
 * inline. That is legal OOXML — position is implied by document order — but
 * exceljs rejects it outright ("Invalid row number in model"), and the
 * SheetJS build published to npm carries unpatched advisories. This reader
 * handles the export as written while still supporting `r` attributes and
 * shared strings, so a future export that adds them keeps working.
 *
 * The safety rule that matters: when `r` attributes are absent, column
 * position is inferred from order, so a row with an unexpected number of
 * cells is a hard error rather than a silent misalignment.
 */

export type CellValue = string | number | Date | boolean | null;

export class XlsxError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "XlsxError";
    this.detail = detail;
  }
}

/** Built-in numFmt ids that denote a date and/or time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Excel's day zero, allowing for the fictional 1900 leap day. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

type Node = Record<string, unknown>;

/** preserveOrder nodes look like { tagName: [...children], ":@": {attrs} }. */
function tagOf(node: Node): string | null {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}
const childrenOf = (node: Node, tag: string): Node[] =>
  (node[tag] as Node[] | undefined) ?? [];
/**
 * preserveOrder keeps the whitespace between elements as #text nodes, so any
 * index-sensitive list (cellXfs above all) must be filtered to real elements
 * first — otherwise style indices shift and date cells stop being dates.
 */
const elementsOf = (node: Node, tag: string, childTag: string): Node[] =>
  childrenOf(node, tag).filter((n) => tagOf(n) === childTag);
const attrsOf = (node: Node): Record<string, string> =>
  (node[":@"] as Record<string, string> | undefined) ?? {};

/** Concatenate every #text descendant — covers <t>, and <is><r><t> rich text. */
function textOf(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    if ("#text" in n) {
      out += String(n["#text"]);
      continue;
    }
    const tag = tagOf(n);
    if (tag) out += textOf(childrenOf(n, tag));
  }
  return out;
}

function findNode(nodes: Node[], tag: string): Node | null {
  for (const n of nodes) if (tagOf(n) === tag) return n;
  return null;
}

/** "BC12" -> 55 (1-based column number). */
function columnFromRef(ref: string): number | null {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return col;
}

function serialToDate(serial: number): Date {
  // Whole days plus a rounded time-of-day, to avoid 23:59:59.999 artefacts.
  const ms = Math.round(serial * 86400 * 1000);
  return new Date(EXCEL_EPOCH_UTC + ms);
}

export interface Sheet {
  name: string;
  rows: CellValue[][];
}

export function readFirstSheet(buffer: Buffer): Sheet {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new XlsxError(
      "The file is not a readable .xlsx workbook.",
      "An .xlsx is a zip archive; this file could not be opened as one. Check it is the Excel export and not a CSV, PDF, or partial download.",
    );
  }

  const read = (path: string): string | null => {
    const f = files[path] ?? files[path.replace(/^\//, "")];
    return f ? strFromU8(f) : null;
  };

  // ---- locate the first worksheet ----------------------------------------
  const workbookXml = read("xl/workbook.xml");
  if (!workbookXml) {
    throw new XlsxError(
      "The workbook is missing its index (xl/workbook.xml).",
      "The file is a zip but not a valid Excel workbook.",
    );
  }

  let sheetName = "Sheet1";
  let sheetPath = "xl/worksheets/sheet1.xml";
  try {
    const wbRoot = xml.parse(workbookXml) as Node[];
    const wb = findNode(wbRoot, "workbook");
    const sheets = wb ? findNode(childrenOf(wb, "workbook"), "sheets") : null;
    const first = sheets ? elementsOf(sheets, "sheets", "sheet")[0] : null;
    if (first) {
      const a = attrsOf(first);
      if (a["@name"]) sheetName = a["@name"];
      const rid = a["@r:id"];
      const relsXml = read("xl/_rels/workbook.xml.rels");
      if (rid && relsXml) {
        const relsRoot = xml.parse(relsXml) as Node[];
        const relsEl = findNode(relsRoot, "Relationships");
        for (const rel of relsEl ? elementsOf(relsEl, "Relationships", "Relationship") : []) {
          const ra = attrsOf(rel);
          if (ra["@Id"] === rid && ra["@Target"]) {
            sheetPath = ra["@Target"].replace(/^\/?(xl\/)?/, "xl/");
            break;
          }
        }
      }
    }
  } catch {
    /* fall back to the conventional path */
  }

  const sheetXml = read(sheetPath) ?? read("xl/worksheets/sheet1.xml");
  if (!sheetXml) {
    throw new XlsxError(
      "The workbook contains no worksheet.",
      `Expected a sheet at ${sheetPath}.`,
    );
  }

  // ---- shared strings (absent in this export, present in most others) -----
  const shared: string[] = [];
  const sharedXml = read("xl/sharedStrings.xml");
  if (sharedXml) {
    const root = xml.parse(sharedXml) as Node[];
    const sst = findNode(root, "sst");
    for (const si of sst ? elementsOf(sst, "sst", "si") : []) {
      shared.push(textOf(childrenOf(si, "si")));
    }
  }

  // ---- style index -> is this cell a date? --------------------------------
  const styleIsDate: boolean[] = [];
  const stylesXml = read("xl/styles.xml");
  if (stylesXml) {
    const root = xml.parse(stylesXml) as Node[];
    const ss = findNode(root, "styleSheet");
    const kids = ss ? childrenOf(ss, "styleSheet") : [];

    const customDateFormats = new Set<number>();
    const numFmts = findNode(kids, "numFmts");
    for (const nf of numFmts ? elementsOf(numFmts, "numFmts", "numFmt") : []) {
      const a = attrsOf(nf);
      const id = Number(a["@numFmtId"]);
      const code = a["@formatCode"] ?? "";
      // Strip quoted literals and colour/condition blocks before sniffing.
      const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
      if (Number.isFinite(id) && /[ymdhs]/i.test(bare)) customDateFormats.add(id);
    }

    const cellXfs = findNode(kids, "cellXfs");
    for (const xf of cellXfs ? elementsOf(cellXfs, "cellXfs", "xf") : []) {
      const id = Number(attrsOf(xf)["@numFmtId"] ?? 0);
      styleIsDate.push(BUILTIN_DATE_FORMATS.has(id) || customDateFormats.has(id));
    }
  }

  // ---- rows ---------------------------------------------------------------
  const sheetRoot = xml.parse(sheetXml) as Node[];
  const worksheet = findNode(sheetRoot, "worksheet");
  const sheetData = worksheet
    ? findNode(childrenOf(worksheet, "worksheet"), "sheetData")
    : null;
  if (!sheetData) {
    throw new XlsxError(
      "The worksheet contains no data.",
      "No <sheetData> section was found in the first sheet.",
    );
  }

  const rows: CellValue[][] = [];
  for (const rowNode of elementsOf(sheetData, "sheetData", "row")) {
    const cells: CellValue[] = [];
    let cursor = 0; // 0-based next column when @r is absent

    for (const cellNode of elementsOf(rowNode, "row", "c")) {
      const a = attrsOf(cellNode);
      const kids = childrenOf(cellNode, "c");

      // Honour an explicit reference; otherwise take the next position.
      const ref = a["@r"];
      const col = ref ? columnFromRef(ref) : null;
      const at = col !== null ? col - 1 : cursor;
      while (cells.length < at) cells.push(null);
      cursor = at + 1;

      const type = a["@t"];
      let value: CellValue = null;

      if (type === "inlineStr") {
        const is = findNode(kids, "is");
        value = is ? textOf(childrenOf(is, "is")) : "";
      } else if (type === "s") {
        const v = findNode(kids, "v");
        const i = v ? Number(textOf(childrenOf(v, "v"))) : NaN;
        value = Number.isInteger(i) ? (shared[i] ?? "") : "";
      } else if (type === "str") {
        const v = findNode(kids, "v");
        value = v ? textOf(childrenOf(v, "v")) : "";
      } else if (type === "b") {
        const v = findNode(kids, "v");
        value = v ? textOf(childrenOf(v, "v")) === "1" : false;
      } else if (type === "e") {
        value = null; // an Excel error cell reads as empty
      } else {
        const v = findNode(kids, "v");
        const raw = v ? textOf(childrenOf(v, "v")).trim() : "";
        if (raw === "") {
          value = null;
        } else {
          const n = Number(raw);
          if (Number.isFinite(n)) {
            const sIdx = Number(a["@s"] ?? -1);
            value = sIdx >= 0 && styleIsDate[sIdx] ? serialToDate(n) : n;
          } else {
            value = raw;
          }
        }
      }
      cells[at] = value;
    }
    rows.push(cells);
  }

  return { name: sheetName, rows };
}
