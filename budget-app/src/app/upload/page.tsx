"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Success {
  ok: true;
  periodLabel: string;
  fiscalYear: number;
  asOfDate: string;
  rowCount: number;
  accountCount: number;
  warnings: string[];
}
interface Failure {
  ok?: false;
  error: string;
  detail?: string;
}
type Result = Success | Failure | null;

const isSuccess = (r: Result): r is Success => !!r && "ok" in r && r.ok === true;

export default function UploadPage() {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [result, setResult] = useState<Result>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function send(file: File) {
    setBusy(true);
    setResult(null);
    setName(file.name);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const json = await res.json();
      setResult(json);
      if (res.ok) router.refresh();
    } catch {
      setResult({
        error: "The upload did not reach the server.",
        detail: "Check your connection and try again — nothing was imported.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uploader">
      <div className="page-head">
        <h1>Upload the month&rsquo;s report</h1>
        <p className="sub">
          Drop in the Budget Detail YTD export. It is checked column by column
          before anything is imported, and the whole file lands as one snapshot
          or not at all.
        </p>
      </div>

      <div
        className={over ? "dropzone over" : "dropzone"}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) void send(f);
        }}
      >
        <div className="big">{busy ? `Reading ${name}…` : "Drop the .xlsx here"}</div>
        <div className="small">or choose it from your computer</div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void send(f);
            e.target.value = "";
          }}
        />
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Working…" : "Choose file"}
        </button>
      </div>

      {isSuccess(result) && (
        <div className="result ok" role="status">
          <div className="r-title">Imported {result.periodLabel}</div>
          <div className="r-detail">
            The report now shows this snapshot. Nothing was overwritten — earlier
            months are still available.
          </div>
          <dl>
            <dt>Journal lines</dt><dd>{result.rowCount.toLocaleString("en-US")}</dd>
            <dt>Accounts</dt><dd>{result.accountCount}</dd>
            <dt>Fiscal year</dt><dd>FY{String(result.fiscalYear).slice(-2)}</dd>
            <dt>Activity through</dt><dd>{result.asOfDate}</dd>
          </dl>
          {result.warnings.length > 0 && (
            <ul>
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <button className="btn ghost" type="button" onClick={() => router.push("/")}>
            View the report
          </button>
        </div>
      )}

      {result && !isSuccess(result) && (
        <div className="result bad" role="alert">
          <div className="r-title">{(result as Failure).error}</div>
          {(result as Failure).detail && (
            <div className="r-detail">{(result as Failure).detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
