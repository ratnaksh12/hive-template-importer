/**
 * Failure-case harness.
 *
 * The importer must fail loudly and usefully, never half-import or silently
 * accept a file it did not understand. This feeds it deliberately bad input and
 * asserts the error is specific enough for an inspector to act on.
 *
 *   npx tsx scripts/verify-failures.ts
 */
import ExcelJS from "exceljs";
import { parseSpectoraExport, SpectoraImportError } from "../src/lib/spectora/parse";

const failures: string[] = [];

async function expectReject(
  label: string,
  build: () => Promise<{ buf: ArrayBuffer; name: string }>,
  expectCode: string,
) {
  const { buf, name } = await build();
  try {
    const parsed = await parseSpectoraExport(buf, name);
    console.log(
      `  FAIL  ${label} — expected rejection but imported ${parsed.stats.commentCount} comment(s)`,
    );
    failures.push(label);
  } catch (err) {
    if (err instanceof SpectoraImportError) {
      const codes = err.issues.map((i) => i.code);
      const ok = codes.includes(expectCode);
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
      console.log(`          code: ${codes.join(", ") || "(none)"}`);
      console.log(`          says: ${err.message.slice(0, 150)}…`);
      if (!ok) failures.push(`${label} (got ${codes.join(",")}, wanted ${expectCode})`);
    } else {
      console.log(`  FAIL  ${label} — threw a non-import error: ${String(err)}`);
      failures.push(label);
    }
  }
}

const toArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

async function sheetToBuffer(rows: string[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r) => ws.addRow(r));
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

async function main() {
  console.log("\nFailure-case checks\n");

  await expectReject(
    "a PDF/binary that is not a spreadsheet",
    async () => ({
      buf: toArrayBuffer(Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n")),
      name: "not-a-template.pdf",
    }),
    "HEADER_NOT_FOUND",
  );

  await expectReject(
    "an empty file",
    async () => ({ buf: toArrayBuffer(Buffer.from("")), name: "empty.csv" }),
    "EMPTY_FILE",
  );

  await expectReject(
    "a spreadsheet with completely unrelated headers",
    async () => ({
      buf: await sheetToBuffer([
        ["Invoice No", "Customer", "Amount Due", "Paid On"],
        ["INV-1", "Acme", "120.00", "2026-01-04"],
      ]),
      name: "invoices.xlsx",
    }),
    "HEADER_NOT_FOUND",
  );

  await expectReject(
    "a Spectora-ish export missing Comment Name",
    async () => ({
      buf: await sheetToBuffer([
        ["Section Name", "Comment Text", "Comment Type"],
        ["Roof", "<p>Worn shingles.</p>", "defect"],
      ]),
      name: "partial.xlsx",
    }),
    "MISSING_REQUIRED_COLUMN",
  );

  await expectReject(
    "headers present but zero data rows",
    async () => ({
      buf: await sheetToBuffer([["Section Name", "Item Name", "Comment Name", "Comment Text"]]),
      name: "headers-only.xlsx",
    }),
    "NO_DATA_ROWS",
  );

  // --- Cases that must SUCCEED, proving robustness beyond the committed file ---
  console.log("\nRobustness checks (these must import, not reject)\n");

  const ok = async (label: string, rows: string[][], assertFn: (p: Awaited<ReturnType<typeof parseSpectoraExport>>) => boolean) => {
    try {
      const parsed = await parseSpectoraExport(await sheetToBuffer(rows), "variant.xlsx");
      const good = assertFn(parsed);
      console.log(`  ${good ? "PASS" : "FAIL"}  ${label}`);
      if (!good) failures.push(label);
    } catch (err) {
      console.log(`  FAIL  ${label} — ${err instanceof Error ? err.message : String(err)}`);
      failures.push(label);
    }
  };

  await ok(
    "reordered columns still map correctly",
    [
      ["Comment Text", "Comment Name", "Item Name", "Section Name"],
      ["<p>Cracked.</p>", "Cracking", "Siding", "Exterior"],
    ],
    (p) =>
      p.sections[0].name === "Exterior" &&
      p.sections[0].items[0].comments[0].name === "Cracking",
  );

  await ok(
    "an unrecognised extra column is preserved, not dropped",
    [
      ["Section Name", "Item Name", "Comment Name", "Comment Text", "Inspector Notes"],
      ["Roof", "Coverings", "Worn", "<p>Worn.</p>", "check next visit"],
    ],
    (p) =>
      p.sections[0].items[0].comments[0].extra["Inspector Notes"] === "check next visit" &&
      p.issues.some((i) => i.code === "UNKNOWN_COLUMN"),
  );

  await ok(
    "a title row above the header is skipped",
    [
      ["InterNACHI Residential — exported 2026-09-16", "", "", ""],
      ["Section Name", "Item Name", "Comment Name", "Comment Text"],
      ["Roof", "Coverings", "Worn", "Worn shingles."],
    ],
    (p) => p.stats.headerRow === 2 && p.stats.commentCount === 1,
  );

  {
    const csv =
      "Section Name,Item Name,Comment Name,Comment Text\n" +
      'Roof,Coverings,Worn,"<p>Worn shingles &amp; moss.</p>"\n';
    const parsed = await parseSpectoraExport(toArrayBuffer(Buffer.from(csv)), "export.csv");
    const good = parsed.stats.commentCount === 1 && parsed.sections[0].name === "Roof";
    console.log(`  ${good ? "PASS" : "FAIL"}  CSV variant of the same export shape`);
    if (!good) failures.push("CSV variant");
  }

  {
    const parsed = await parseSpectoraExport(
      await sheetToBuffer([
        ["Section Name", "Item Name", "Comment Name", "Comment Text"],
        ["Attic", "Clearance", "Low headroom", "Crawl height attic < 6 ft, use caution."],
      ]),
      "angle.xlsx",
    );
    const body = parsed.sections[0].items[0].comments[0].bodyHtml;
    const good = body.includes("&lt; 6 ft");
    console.log(`  ${good ? "PASS" : "FAIL"}  plain text containing "<" is escaped, not parsed as a tag`);
    if (!good) failures.push("angle-bracket escaping");
  }

  console.log(
    failures.length === 0
      ? "\nRESULT: all failure-case checks passed.\n"
      : `\nRESULT: ${failures.length} check(s) FAILED: ${failures.join("; ")}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
