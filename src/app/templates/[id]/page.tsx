import Link from "next/link";
import { notFound } from "next/navigation";
import { getImportReport, getTemplateTree } from "@/lib/db/templates";
import { ImportReportPanel } from "@/components/ImportReportPanel";
import { TemplateActions } from "@/components/TemplateActions";
import { TemplateEditor } from "@/components/TemplateEditor";
import { TemplateTitle } from "@/components/TemplateTitle";

export const dynamic = "force-dynamic";

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imported?: string; copied?: string }>;
}) {
  const { id } = await params;
  const flags = await searchParams;

  const template = await getTemplateTree(id);
  if (!template) notFound();

  const report = await getImportReport(id);

  const commentCount = template.sections.reduce(
    (n, s) => n + s.items.reduce((m, i) => m + i.comments.length, 0),
    0,
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/"
        className="text-sm text-ink-soft transition-colors hover:text-accent"
      >
        &larr; All templates
      </Link>

      {flags.imported && (
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink">
          Imported {commentCount} comments. Open the import report below to see exactly
          what came across and what the export did not contain.
        </p>
      )}
      {flags.copied && (
        <p className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink">
          This is an independent copy. Editing it will not change the original.
        </p>
      )}

      <header className="mt-5 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div className="min-w-0">
          <TemplateTitle id={template.id} name={template.name} />
          <p className="mt-1 text-sm text-ink-soft">
            {template.sections.length} sections &middot; {commentCount} comments
            {template.origin === "copy" && " · copy of another template"}
          </p>
        </div>
        <TemplateActions templateId={template.id} templateName={template.name} />
      </header>

      {report && (
        <div className="mt-6">
          <ImportReportPanel
            summary={{
              sourceFilename: report.source_filename,
              sheetName: report.sheet_name,
              stats: report.stats,
              issues: report.issues,
            }}
          />
        </div>
      )}

      <div className="mt-8">
        <TemplateEditor template={template} />
      </div>
    </main>
  );
}
