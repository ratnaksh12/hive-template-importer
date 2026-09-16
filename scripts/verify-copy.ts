/**
 * Copy-independence harness.
 *
 * "Changes to the copy must leave the original unchanged" is a correctness
 * claim, so it gets a test rather than a click-through. This imports a small
 * template, duplicates it, edits every editable level of the copy, and asserts
 * the original is byte-identical afterwards. It cleans up after itself.
 *
 *   npm run verify:copy
 */
import ExcelJS from "exceljs";
import { parseSpectoraExport } from "../src/lib/spectora/parse";
import {
  copyTemplate,
  deleteTemplate,
  getTemplateTree,
  renameItem,
  renameSection,
  saveImportedTemplate,
  updateComment,
} from "../src/lib/db/templates";
import type { TemplateTree } from "../src/lib/types";
import { loadEnv } from "./load-env";

const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
}

/** Structural fingerprint: names, order and bodies, ignoring ids and timestamps. */
function fingerprint(t: TemplateTree): string {
  return JSON.stringify(
    t.sections.map((s) => ({
      n: s.name,
      p: s.position,
      items: s.items.map((i) => ({
        n: i.name,
        p: i.position,
        comments: i.comments.map((c) => ({
          n: c.name,
          b: c.body_html,
          p: c.position,
          r: c.source_row,
        })),
      })),
    })),
  );
}

async function buildFixture(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Section Name", "Item Name", "Comment Name", "Comment Text", "Comment Type"]);
  ws.addRow(["Roof", "Coverings", "Worn shingles", "<p>Shingles are worn.</p>", "defect"]);
  ws.addRow(["Roof", "Coverings", "Moss", "<p>Moss present.</p>", "defect"]);
  ws.addRow(["Exterior", "Siding", "Cracking", "<p>Minor cracking.</p>", "defect"]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

async function main() {
  loadEnv();
  console.log("\nCopy-independence checks\n");

  const parsed = await parseSpectoraExport(await buildFixture(), "copy-fixture.xlsx");
  parsed.name = `__verify-copy ${new Date().toISOString()}`;

  const originalId = await saveImportedTemplate(parsed);
  let copyId: string | null = null;

  try {
    const before = await getTemplateTree(originalId);
    if (!before) throw new Error("original not found after import");
    const beforePrint = fingerprint(before);

    copyId = await copyTemplate(originalId, "Copy under test");
    const copy = await getTemplateTree(copyId);
    if (!copy) throw new Error("copy not found");

    check("the copy has identical content to the original", fingerprint(copy) === beforePrint);

    // No shared rows at any level.
    const originalIds = new Set<string>();
    before.sections.forEach((s) => {
      originalIds.add(s.id);
      s.items.forEach((i) => {
        originalIds.add(i.id);
        i.comments.forEach((c) => originalIds.add(c.id));
      });
    });
    let shared = 0;
    copy.sections.forEach((s) => {
      if (originalIds.has(s.id)) shared++;
      s.items.forEach((i) => {
        if (originalIds.has(i.id)) shared++;
        i.comments.forEach((c) => { if (originalIds.has(c.id)) shared++; });
      });
    });
    check("the copy shares no section, item or comment rows with the original", shared === 0, `${shared} shared`);
    check("the copy records its provenance", copy.copied_from_id === originalId);
    check("the copy is marked as a copy", copy.origin === "copy");

    // --- Edit every level of the copy ---------------------------------------
    await renameSection(copy.sections[0].id, "Roof — EDITED IN COPY");
    await renameItem(copy.sections[0].items[0].id, "Coverings — EDITED IN COPY");
    await updateComment(copy.sections[0].items[0].comments[0].id, {
      name: "Worn shingles — EDITED",
      body_html: "<p>Rewritten in the copy only.</p>",
    });

    const copyAfter = await getTemplateTree(copyId);
    const originalAfter = await getTemplateTree(originalId);
    if (!copyAfter || !originalAfter) throw new Error("reload failed");

    check(
      "the copy's section rename persisted",
      copyAfter.sections[0].name === "Roof — EDITED IN COPY",
      copyAfter.sections[0].name,
    );
    check(
      "the copy's item rename persisted",
      copyAfter.sections[0].items[0].name === "Coverings — EDITED IN COPY",
    );
    check(
      "the copy's comment edit persisted",
      copyAfter.sections[0].items[0].comments[0].body_html.includes("Rewritten in the copy only"),
    );

    // --- The whole point ----------------------------------------------------
    check(
      "the ORIGINAL is completely unchanged after editing the copy",
      fingerprint(originalAfter) === beforePrint,
      "original content drifted",
    );
    check(
      "the original's section name is untouched",
      originalAfter.sections[0].name === "Roof",
      originalAfter.sections[0].name,
    );
    check(
      "the original's comment body is untouched",
      originalAfter.sections[0].items[0].comments[0].body_html === "<p>Shingles are worn.</p>",
      originalAfter.sections[0].items[0].comments[0].body_html,
    );
  } finally {
    if (copyId) await deleteTemplate(copyId).catch(() => {});
    await deleteTemplate(originalId).catch(() => {});
    console.log("\n  (test templates cleaned up)");
  }

  console.log(
    failures.length === 0
      ? "\nRESULT: copies are fully independent.\n"
      : `\nRESULT: ${failures.length} check(s) FAILED.\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nHARNESS ERROR:", err instanceof Error ? err.message : err);
  console.error("\nIs .env.local configured and supabase/schema.sql applied?");
  process.exit(1);
});
