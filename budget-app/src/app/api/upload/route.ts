import { NextResponse } from "next/server";
import { ingestWorkbook, IngestConflict } from "@/lib/ingest";
import { WorkbookError } from "@/lib/parse-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return NextResponse.json(
      { error: "The upload could not be read.", detail: "Try selecting the file again." },
      { status: 400 },
    );
  }

  if (!file || file.size === 0) {
    return NextResponse.json(
      { error: "No file was attached.", detail: "Choose the Budget Detail YTD .xlsx export and try again." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is larger than the 25 MB limit.`,
        detail: "This report is normally well under 1 MB — check the right file was selected.",
      },
      { status: 413 },
    );
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json(
      {
        error: `"${file.name}" is not a .xlsx file.`,
        detail: "Export the report from the finance system as Excel, not CSV or PDF.",
      },
      { status: 415 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingestWorkbook(buffer, file.name);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof WorkbookError) {
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: 422 },
      );
    }
    if (err instanceof IngestConflict) {
      return NextResponse.json(
        { error: err.message, detail: err.detail },
        { status: 409 },
      );
    }
    console.error("upload failed", err);
    return NextResponse.json(
      {
        error: "The file could not be imported.",
        detail: err instanceof Error ? err.message : "Unexpected error.",
      },
      { status: 500 },
    );
  }
}
