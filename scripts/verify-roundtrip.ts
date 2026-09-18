/**
 * Database round-trip harness.
 *
 * verify-import proves the PARSER preserves the customer's content. This proves
 * the DATABASE does too: it re-parses the source file and compares it field by
 * field against what actually comes back out of Postgres, so a schema or
 * serialisation bug (arrays, jsonb, ordering, unicode) cannot hide.
 *
 *   npm run verify:roundtrip [-- "path/to/export.xls"]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSpectoraExport } from "../src/lib/spectora/parse";
import { getTemplateTree, listTemplates } from "../src/lib/db/templates";
import type { ParsedComment } from "../src/lib/types";
import { loadEnv } from "./load-env";

const DEFAULT_FILE = "InterNACHI Residential -2026-09-16.xls";

const failures: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
}

async function main() {
  loadEnv();

  const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const file = path.resolve(fileArg ?? DEFAULT_FILE);
  const buf = await fs.readFile(file);
  const parsed = await parseSpectoraExport(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    path.basename(file),
  );

  const all = await listTemplates();
  const seeded = all.find((t) => t.name === parsed.name && t.origin === "import");
  if (!seeded) {
    console.error(
      `\nNo imported template named "${parsed.name}" found in the database.\n` +
        "Run `npm run seed` first.\n",
    );
    process.exit(1);
  }

  const tree = await getTemplateTree(seeded.id);
  if (!tree) throw new Error("template disappeared between list and read");

  console.log(`\nRound-trip check for "${tree.name}" (${tree.id})\n`);

  check(
    "section count matches the source file",
    tree.sections.length === parsed.sections.length,
    `db=${tree.sections.length} file=${parsed.sections.length}`,
  );

  const dbItems = tree.sections.reduce((n, s) => n + s.items.length, 0);
  const dbComments = tree.sections.reduce(
    (n, s) => n + s.items.reduce((m, i) => m + i.comments.length, 0),
    0,
  );
  check("item count matches", dbItems === parsed.stats.itemCount, `db=${dbItems}`);
  check(
    "comment count matches",
    dbComments === parsed.stats.commentCount,
    `db=${dbComments} file=${parsed.stats.commentCount}`,
  );

  check(
    "section names and order survived the round trip",
    JSON.stringify(tree.sections.map((s) => s.name)) ===
      JSON.stringify(parsed.sections.map((s) => s.name)),
  );

  // Field-by-field comparison, walking both trees in stored order.
  let nameMiss = 0;
  let bodyMiss = 0;
  let orderMiss = 0;
  let optionMiss = 0;
  let metaMiss = 0;
  const examples: string[] = [];

  for (let si = 0; si < parsed.sections.length; si++) {
    const fileSection = parsed.sections[si];
    const dbSection = tree.sections[si];
    if (!dbSection) break;

    for (let ii = 0; ii < fileSection.items.length; ii++) {
      const fileItem = fileSection.items[ii];
      const dbItem = dbSection.items[ii];
      if (!dbItem) break;
      if (dbItem.name !== fileItem.name) nameMiss++;

      for (let ci = 0; ci < fileItem.comments.length; ci++) {
        const f: ParsedComment = fileItem.comments[ci];
        const d = dbItem.comments[ci];
        if (!d) {
          orderMiss++;
          continue;
        }
        if (d.name !== f.name) {
          nameMiss++;
          if (examples.length < 3) examples.push(`name row ${f.sourceRow}`);
        }
        if (d.body_html !== f.bodyHtml) {
          bodyMiss++;
          if (examples.length < 3) {
            examples.push(
              `body row ${f.sourceRow}: db=${JSON.stringify(d.body_html.slice(0, 60))} file=${JSON.stringify(f.bodyHtml.slice(0, 60))}`,
            );
          }
        }
        if (d.source_row !== f.sourceRow || d.position !== f.position) orderMiss++;
        if (
          JSON.stringify(d.multiple_choice_options ?? []) !==
            JSON.stringify(f.multipleChoiceOptions) ||
          JSON.stringify(d.unit_type_options ?? []) !== JSON.stringify(f.unitTypeOptions)
        ) {
          optionMiss++;
        }
        if (
          (d.comment_type ?? "") !== f.commentType ||
          (d.category ?? "") !== f.category ||
          (d.answer_type ?? "") !== f.answerType ||
          (d.recommendation ?? "") !== f.recommendation ||
          (d.spectora_order ?? null) !== f.spectoraOrder
        ) {
          metaMiss++;
        }
      }
    }
  }

  check("every comment name round-tripped exactly", nameMiss === 0, `${nameMiss} differ`);
  check(
    "every comment body round-tripped byte-for-byte",
    bodyMiss === 0,
    `${bodyMiss} differ: ${examples.join(" | ")}`,
  );
  check("source row and position round-tripped", orderMiss === 0, `${orderMiss} differ`);
  check(
    "multiple-choice and unit option arrays round-tripped",
    optionMiss === 0,
    `${optionMiss} differ`,
  );
  check(
    "comment type, category, answer type, recommendation, order round-tripped",
    metaMiss === 0,
    `${metaMiss} differ`,
  );

  // Unicode that databases and drivers commonly mangle.
  const nbsp = tree.sections.some((s) =>
    s.items.some((i) => i.comments.some((c) => c.body_html.includes(" ") || c.body_html.includes("&nbsp;"))),
  );
  check("non-breaking spaces preserved through Postgres", nbsp);

  const links = tree.sections.reduce(
    (n, s) =>
      n +
      s.items.reduce(
        (m, i) => m + i.comments.reduce((k, c) => k + (c.body_html.match(/<a\b/gi) ?? []).length, 0),
        0,
      ),
    0,
  );
  check("all links present in the database", links === parsed.stats.linkCount, `db=${links} file=${parsed.stats.linkCount}`);

  console.log(
    failures.length === 0
      ? "\nRESULT: the stored template matches the source file exactly.\n"
      : `\nRESULT: ${failures.length} check(s) FAILED.\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nHARNESS ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});
