/**
 * Preservation harness.
 *
 * Reads the source spreadsheet a SECOND time, independently of the importer,
 * and asserts that every row, name, ordering and word survived the import. This
 * is the evidence behind "the customer's content survived" — it compares the
 * parser's output against the raw cells rather than against its own assumptions.
 *
 *   npx tsx scripts/verify-import.ts ["path/to/export.xls"]
 *
 * Exits non-zero if any check fails.
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { parseSpectoraExport } from "../src/lib/spectora/parse";
import { htmlToText } from "../src/lib/spectora/sanitize";
import { normalizeHeader } from "../src/lib/spectora/columns";
import type { ParsedComment } from "../src/lib/types";

const DEFAULT_FILE = "InterNACHI Residential -2026-09-16.xls";

const failures: string[] = [];
const notes: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

/** Normalise text for comparison: entities, nbsp and whitespace only. */
function norm(s: string): string {
  return s
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.richText)) {
    return (v.richText as { text: string }[]).map((r) => r.text).join("");
  }
  if ("result" in v) return cellToString(v.result);
  if ("text" in v) return String(v.text);
  return String(value);
}

async function main() {
  const file = path.resolve(process.argv[2] ?? DEFAULT_FILE);
  console.log(`\nVerifying import preservation for:\n  ${file}\n`);

  // ---- Independent read of the source ------------------------------------
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];

  const headers: string[] = [];
  for (let c = 1; c <= ws.columnCount; c++) {
    headers[c] = cellToString(ws.getRow(1).getCell(c).value).trim();
  }
  const colOf = (name: string) => {
    const target = normalizeHeader(name);
    for (let c = 1; c <= ws.columnCount; c++) {
      if (normalizeHeader(headers[c] ?? "") === target) return c;
    }
    throw new Error(`Column not found in source: ${name}`);
  };
  const cSection = colOf("Section Name");
  const cItem = colOf("Item Name");
  const cComment = colOf("Comment Name");
  const cText = colOf("Comment Text");

  type RawRow = { row: number; section: string; item: string; comment: string; text: string };
  const raw: RawRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(cellToString(row.getCell(c).value));
    if (!cells.some((c) => c.trim())) continue;
    raw.push({
      row: r,
      section: cellToString(row.getCell(cSection).value).trim(),
      item: cellToString(row.getCell(cItem).value).trim(),
      comment: cellToString(row.getCell(cComment).value).trim(),
      text: cellToString(row.getCell(cText).value),
    });
  }

  // ---- Run the importer ---------------------------------------------------
  const buf = await (await import("node:fs/promises")).readFile(file);
  const parsed = await parseSpectoraExport(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    path.basename(file),
  );

  const flat: ParsedComment[] = [];
  for (const s of parsed.sections) for (const i of s.items) for (const c of i.comments) flat.push(c);

  console.log("SOURCE");
  console.log(`  non-blank data rows: ${raw.length}`);
  console.log("IMPORTED");
  console.log(
    `  sections=${parsed.stats.sectionCount} items=${parsed.stats.itemCount} comments=${parsed.stats.commentCount}\n`,
  );

  console.log("CHECKS");

  // 1. Row conservation: one comment per source row, nothing dropped or invented.
  check(
    "every non-blank source row produced exactly one comment",
    flat.length === raw.length,
    `source=${raw.length} imported=${flat.length}`,
  );

  const importedRows = new Set(flat.map((c) => c.sourceRow));
  const missing = raw.filter((r) => !importedRows.has(r.row));
  check("no source row was dropped", missing.length === 0, `missing rows: ${missing.slice(0, 5).map((m) => m.row).join(", ")}`);
  check("no comment was invented", flat.length === importedRows.size, "duplicate sourceRow detected");

  // 2. Hierarchy matches first-appearance order in the sheet.
  const expectedSections: string[] = [];
  for (const r of raw) if (!expectedSections.includes(r.section)) expectedSections.push(r.section);
  check(
    "section names and order match source first-appearance order",
    JSON.stringify(expectedSections) === JSON.stringify(parsed.sections.map((s) => s.name)),
    `expected ${expectedSections.length}, got ${parsed.sections.length}`,
  );

  let itemOrderOk = true;
  for (const section of parsed.sections) {
    const expectedItems: string[] = [];
    for (const r of raw) {
      if (r.section === section.name && !expectedItems.includes(r.item)) expectedItems.push(r.item);
    }
    if (JSON.stringify(expectedItems) !== JSON.stringify(section.items.map((i) => i.name))) {
      itemOrderOk = false;
      notes.push(`item order mismatch in "${section.name}"`);
    }
  }
  check("item names and order match source order within every section", itemOrderOk);

  // 3. Ordering: traversal order equals sheet order.
  const traversal = flat.map((c) => c.sourceRow);
  const withinItemAscending = (() => {
    for (const s of parsed.sections) {
      for (const i of s.items) {
        const rows = i.comments.map((c) => c.sourceRow);
        for (let k = 1; k < rows.length; k++) if (rows[k] < rows[k - 1]) return false;
      }
    }
    return true;
  })();
  check("comments appear in source row order within each item", withinItemAscending);
  check(
    "comment positions are contiguous from 0 within each item",
    parsed.sections.every((s) =>
      s.items.every((i) => i.comments.every((c, idx) => c.position === idx)),
    ),
  );

  // 4. Text preservation — the important one.
  const byRow = new Map(flat.map((c) => [c.sourceRow, c]));
  let nameMismatch = 0;
  let textMismatch = 0;
  const textExamples: string[] = [];
  for (const r of raw) {
    const c = byRow.get(r.row);
    if (!c) continue;
    const expectedName = r.comment || "(Untitled comment)";
    if (norm(c.name) !== norm(expectedName)) nameMismatch++;

    const expectedText = norm(htmlToText(r.text));
    const actualText = norm(htmlToText(c.bodyHtml));
    if (expectedText !== actualText) {
      textMismatch++;
      if (textExamples.length < 3) {
        textExamples.push(
          `row ${r.row}: expected "${expectedText.slice(0, 90)}" got "${actualText.slice(0, 90)}"`,
        );
      }
    }
  }
  check("every comment name preserved verbatim", nameMismatch === 0, `${nameMismatch} mismatched`);
  check(
    "every comment's visible text preserved word-for-word",
    textMismatch === 0,
    textExamples.join(" | "),
  );

  // 5. Links survive sanitisation.
  const sourceLinks = raw.reduce((n, r) => n + (r.text.match(/<a\b/gi) ?? []).length, 0);
  check(
    "all hyperlinks preserved",
    sourceLinks === parsed.stats.linkCount,
    `source=${sourceLinks} imported=${parsed.stats.linkCount}`,
  );
  const hrefsIn = new Set<string>();
  raw.forEach((r) => {
    for (const m of r.text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) hrefsIn.add(m[1]);
  });
  const hrefsOut = new Set<string>();
  flat.forEach((c) => {
    for (const m of c.bodyHtml.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) hrefsOut.add(m[1]);
  });
  const lostHrefs = [...hrefsIn].filter((h) => !hrefsOut.has(h));
  check("every distinct link URL survived", lostHrefs.length === 0, lostHrefs.slice(0, 3).join(", "));

  // 6. Duplicates kept, not merged.
  const dupKeys = new Map<string, number>();
  raw.forEach((r) => {
    const k = `${r.section}|${r.item}|${r.comment}`;
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1);
  });
  const expectedDupes = [...dupKeys.entries()].filter(([, n]) => n > 1);
  let dupesKept = true;
  for (const [key, n] of expectedDupes) {
    const [sec, item, name] = key.split("|");
    const found = flat.filter(
      (c) => norm(c.name) === norm(name) &&
        parsed.sections.some((s) => s.name === sec && s.items.some((i) => i.name === item && i.comments.includes(c))),
    ).length;
    if (found !== n) dupesKept = false;
  }
  check(
    `duplicate comment names kept as separate comments (${expectedDupes.length} case(s))`,
    dupesKept,
  );

  // ---- Report -------------------------------------------------------------
  console.log("\nISSUES RAISED BY THE IMPORTER");
  const byCode = new Map<string, number>();
  parsed.issues.forEach((i) => byCode.set(`${i.severity}/${i.code}`, (byCode.get(`${i.severity}/${i.code}`) ?? 0) + 1));
  [...byCode.entries()].sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}  ${k}`));

  console.log("\nRICH CONTENT");
  console.log(`  HTML bodies: ${parsed.stats.htmlBodyCount}`);
  console.log(`  plain-text bodies: ${parsed.stats.plainTextBodyCount}`);
  console.log(`  links: ${parsed.stats.linkCount}`);
  console.log(`  columns present but empty: ${parsed.stats.emptyColumns.length}`);
  console.log(`  columns unrecognised: ${parsed.stats.unknownColumns.length}`);

  if (notes.length) {
    console.log("\nNOTES");
    notes.forEach((n) => console.log(`  - ${n}`));
  }

  console.log(
    failures.length === 0
      ? "\nRESULT: all preservation checks passed.\n"
      : `\nRESULT: ${failures.length} check(s) FAILED.\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nVERIFICATION ERROR:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
