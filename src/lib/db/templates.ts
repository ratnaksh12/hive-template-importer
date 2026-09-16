import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  ImportIssue,
  ParsedTemplate,
  SectionRow,
  TemplateRow,
  TemplateTree,
} from "@/lib/types";

/** Supabase rejects very large single inserts; chunk bulk writes. */
const CHUNK = 400;

async function insertChunked(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  const db = getSupabaseAdmin();
  for (let i = 0; i < rows.length; i += CHUNK) {
    // The table names are internal constants, not user input; supabase-js cannot
    // infer a row type without generated database typings.
    const { error } = await db.from(table).insert(rows.slice(i, i + CHUNK) as never);
    if (error) throw new Error(`Insert into ${table} failed: ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listTemplates(): Promise<
  (TemplateRow & { section_count: number; comment_count: number })[]
> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("templates")
    .select("*, sections(id, items(id, comments(id)))")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not list templates: ${error.message}`);

  type Nested = TemplateRow & {
    sections: { id: string; items: { id: string; comments: { id: string }[] }[] }[];
  };

  return (data as Nested[]).map((t) => {
    const { sections, ...rest } = t;
    return {
      ...rest,
      section_count: sections?.length ?? 0,
      comment_count:
        sections?.reduce(
          (n, s) => n + s.items.reduce((m, i) => m + (i.comments?.length ?? 0), 0),
          0,
        ) ?? 0,
    };
  });
}

export async function getTemplateTree(id: string): Promise<TemplateTree | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("templates")
    .select("*, sections(*, items(*, comments(*)))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load template: ${error.message}`);
  if (!data) return null;

  const tree = data as TemplateTree;
  // Postgres does not guarantee nested ordering; sort explicitly by position.
  tree.sections.sort((a, b) => a.position - b.position);
  for (const s of tree.sections) {
    s.items.sort((a, b) => a.position - b.position);
    for (const i of s.items) i.comments.sort((a, b) => a.position - b.position);
  }
  return tree;
}

export interface ImportReport {
  id: string;
  source_filename: string | null;
  sheet_name: string | null;
  stats: Record<string, unknown>;
  created_at: string;
  issues: (ImportIssue & { id: string })[];
}

export async function getImportReport(templateId: string): Promise<ImportReport | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("import_runs")
    .select("*, import_issues(*)")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not load import report: ${error.message}`);
  if (!data) return null;

  const run = data as ImportReport & { import_issues: Record<string, unknown>[] };
  const order = { error: 0, warning: 1, info: 2 } as const;
  const issues = (run.import_issues ?? []).map((i) => ({
    id: i.id as string,
    severity: i.severity as ImportIssue["severity"],
    code: i.code as string,
    message: i.message as string,
    sourceRow: (i.source_row as number) ?? undefined,
    columnName: (i.column_name as string) ?? undefined,
    rawValue: (i.raw_value as string) ?? undefined,
  }));
  issues.sort(
    (a, b) => order[a.severity] - order[b.severity] || (a.sourceRow ?? 0) - (b.sourceRow ?? 0),
  );
  return { ...run, issues };
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export async function saveImportedTemplate(parsed: ParsedTemplate): Promise<string> {
  const db = getSupabaseAdmin();

  const { data: template, error: tErr } = await db
    .from("templates")
    .insert({
      name: parsed.name,
      origin: "import",
      source_filename: parsed.sourceFilename,
    })
    .select("id")
    .single();
  if (tErr || !template) {
    throw new Error(`Could not create template: ${tErr?.message ?? "unknown error"}`);
  }
  const templateId = template.id as string;

  try {
    // Sections
    const { data: sectionRows, error: sErr } = await db
      .from("sections")
      .insert(
        parsed.sections.map((s) => ({
          template_id: templateId,
          name: s.name,
          position: s.position,
        })),
      )
      .select("id, position");
    if (sErr || !sectionRows) throw new Error(sErr?.message ?? "section insert failed");
    const sectionIdByPos = new Map<number, string>(
      sectionRows.map((r) => [r.position as number, r.id as string]),
    );

    // Items — position is only unique within a section, so key on both.
    const itemPayload = parsed.sections.flatMap((s) =>
      s.items.map((i) => ({
        section_id: sectionIdByPos.get(s.position)!,
        name: i.name,
        position: i.position,
      })),
    );
    const { data: itemRows, error: iErr } = await db
      .from("items")
      .insert(itemPayload)
      .select("id, section_id, position");
    if (iErr || !itemRows) throw new Error(iErr?.message ?? "item insert failed");
    const itemIdByKey = new Map<string, string>(
      itemRows.map((r) => [`${r.section_id}:${r.position}`, r.id as string]),
    );

    // Comments
    const commentPayload = parsed.sections.flatMap((s) =>
      s.items.flatMap((i) => {
        const itemId = itemIdByKey.get(`${sectionIdByPos.get(s.position)}:${i.position}`)!;
        return i.comments.map((c) => ({
          item_id: itemId,
          name: c.name,
          body_html: c.bodyHtml,
          comment_type: c.commentType || null,
          category: c.category || null,
          recommendation: c.recommendation || null,
          answer_type: c.answerType || null,
          multiple_choice_options: c.multipleChoiceOptions,
          unit_type_options: c.unitTypeOptions,
          default_value: c.defaultValue || null,
          default_value_2: c.defaultValue2 || null,
          default_unit_type: c.defaultUnitType || null,
          default_location: c.defaultLocation || null,
          estimate_min: c.estimateMin || null,
          estimate_max: c.estimateMax || null,
          locked: c.locked || null,
          simple_format: c.simpleFormat || null,
          disable_photos: c.disablePhotos || null,
          uses: c.uses || null,
          last_modified: c.lastModified || null,
          default_photos: c.defaultPhotos,
          extra: c.extra,
          spectora_order: c.spectoraOrder,
          source_row: c.sourceRow,
          position: c.position,
        }));
      }),
    );
    await insertChunked("comments", commentPayload);

    // Import run + issues
    const { data: run, error: rErr } = await db
      .from("import_runs")
      .insert({
        template_id: templateId,
        source_filename: parsed.sourceFilename,
        sheet_name: parsed.sheetName,
        stats: parsed.stats,
      })
      .select("id")
      .single();
    if (rErr || !run) throw new Error(rErr?.message ?? "import_run insert failed");

    if (parsed.issues.length > 0) {
      await insertChunked(
        "import_issues",
        parsed.issues.map((i) => ({
          import_run_id: run.id as string,
          severity: i.severity,
          code: i.code,
          message: i.message,
          source_row: i.sourceRow ?? null,
          column_name: i.columnName ?? null,
          raw_value: i.rawValue ? i.rawValue.slice(0, 2000) : null,
        })),
      );
    }

    return templateId;
  } catch (err) {
    // Don't leave a half-imported template behind; cascades clean the children.
    await db.from("templates").delete().eq("id", templateId);
    throw new Error(
      `Import failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

export async function renameTemplate(id: string, name: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("templates").update({ name }).eq("id", id);
  if (error) throw new Error(`Could not rename template: ${error.message}`);
}

export async function renameSection(id: string, name: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("sections").update({ name }).eq("id", id);
  if (error) throw new Error(`Could not rename section: ${error.message}`);
}

export async function renameItem(id: string, name: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("items").update({ name }).eq("id", id);
  if (error) throw new Error(`Could not rename item: ${error.message}`);
}

export interface CommentPatch {
  name?: string;
  body_html?: string;
  comment_type?: string | null;
  category?: string | null;
  recommendation?: string | null;
}

export async function updateComment(id: string, patch: CommentPatch): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("comments").update(patch).eq("id", id);
  if (error) throw new Error(`Could not save comment: ${error.message}`);
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("templates").delete().eq("id", id);
  if (error) throw new Error(`Could not delete template: ${error.message}`);
}

/* ------------------------------------------------------------------ */
/* Copy                                                                */
/* ------------------------------------------------------------------ */

/**
 * Deep-clone a template. Every section, item and comment is re-inserted with a
 * fresh id, so the copy shares no rows with the original and editing one can
 * never affect the other.
 */
export async function copyTemplate(sourceId: string, newName?: string): Promise<string> {
  const db = getSupabaseAdmin();
  const source = await getTemplateTree(sourceId);
  if (!source) throw new Error("Template to copy was not found.");

  const { data: template, error: tErr } = await db
    .from("templates")
    .insert({
      name: newName?.trim() || `${source.name} (copy)`,
      origin: "copy",
      copied_from_id: source.id,
      source_filename: source.source_filename,
    })
    .select("id")
    .single();
  if (tErr || !template) {
    throw new Error(`Could not create copy: ${tErr?.message ?? "unknown error"}`);
  }
  const newId = template.id as string;

  try {
    const { data: sectionRows, error: sErr } = await db
      .from("sections")
      .insert(
        source.sections.map((s: SectionRow) => ({
          template_id: newId,
          name: s.name,
          position: s.position,
        })),
      )
      .select("id, position");
    if (sErr || !sectionRows) throw new Error(sErr?.message ?? "section copy failed");
    const sectionIdByPos = new Map<number, string>(
      sectionRows.map((r) => [r.position as number, r.id as string]),
    );

    const { data: itemRows, error: iErr } = await db
      .from("items")
      .insert(
        source.sections.flatMap((s) =>
          s.items.map((i) => ({
            section_id: sectionIdByPos.get(s.position)!,
            name: i.name,
            position: i.position,
          })),
        ),
      )
      .select("id, section_id, position");
    if (iErr || !itemRows) throw new Error(iErr?.message ?? "item copy failed");
    const itemIdByKey = new Map<string, string>(
      itemRows.map((r) => [`${r.section_id}:${r.position}`, r.id as string]),
    );

    const comments = source.sections.flatMap((s) =>
      s.items.flatMap((i) => {
        const itemId = itemIdByKey.get(`${sectionIdByPos.get(s.position)}:${i.position}`)!;
        return i.comments.map((c) => {
          const { id: _id, item_id: _itemId, ...rest } = c;
          return { ...rest, item_id: itemId };
        });
      }),
    );
    await insertChunked("comments", comments);

    return newId;
  } catch (err) {
    await db.from("templates").delete().eq("id", newId);
    throw new Error(
      `Copy failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
