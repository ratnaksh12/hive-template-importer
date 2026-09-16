/**
 * Seed the database with the committed Spectora export, so a fresh deployment
 * opens on a real imported template.
 *
 *   npm run seed              # skips if the template is already present
 *   npm run seed -- --force   # import again regardless
 *   npm run seed -- "path/to/other-export.xls"
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSpectoraExport, SpectoraImportError } from "../src/lib/spectora/parse";
import { listTemplates, saveImportedTemplate } from "../src/lib/db/templates";
import { loadEnv } from "./load-env";

const DEFAULT_FILE = "InterNACHI Residential -2026-09-16.xls";

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const fileArg = args.find((a) => !a.startsWith("--"));
  const file = path.resolve(fileArg ?? DEFAULT_FILE);

  const buf = await fs.readFile(file);
  const parsed = await parseSpectoraExport(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    path.basename(file),
  );

  if (!force) {
    const existing = await listTemplates();
    const match = existing.find(
      (t) => t.name === parsed.name && t.origin === "import",
    );
    if (match) {
      console.log(
        `Template "${parsed.name}" is already seeded (id ${match.id}).\n` +
          "Pass --force to import it again.",
      );
      return;
    }
  }

  const id = await saveImportedTemplate(parsed);

  console.log(`Seeded "${parsed.name}"`);
  console.log(`  id:       ${id}`);
  console.log(
    `  content:  ${parsed.stats.sectionCount} sections, ` +
      `${parsed.stats.itemCount} items, ${parsed.stats.commentCount} comments`,
  );
  console.log(`  issues:   ${parsed.issues.length} recorded in the import report`);
  console.log(`\nOpen /templates/${id}`);
}

main().catch((err) => {
  if (err instanceof SpectoraImportError) {
    console.error(`\nImport rejected: ${err.message}`);
    err.issues.forEach((i) => console.error(`  ${i.code}: ${i.message}`));
  } else {
    console.error("\nSeed failed:", err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
