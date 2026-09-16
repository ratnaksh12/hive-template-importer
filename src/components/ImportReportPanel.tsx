"use client";

import { useMemo, useState } from "react";
import type { ImportIssue } from "@/lib/types";

const SEVERITY_STYLE: Record<ImportIssue["severity"], string> = {
  error: "border-defect/30 bg-defect-soft text-defect",
  warning: "border-limit/40 bg-limit-soft text-limit",
  info: "border-info/30 bg-info-soft text-info",
};

export interface ImportSummary {
  sourceFilename: string | null;
  sheetName: string | null;
  stats: Record<string, unknown>;
  issues: (ImportIssue & { id: string })[];
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/**
 * The import report is the trust surface: it tells the inspector exactly what
 * came across, what did not, and — critically — whether something was missing
 * from their export or simply unsupported here.
 */
export function ImportReportPanel({ summary }: { summary: ImportSummary }) {
  const [open, setOpen] = useState(false);
  const s = summary.stats as Record<string, number | string[] | undefined>;

  const grouped = useMemo(() => {
    const map = new Map<string, (ImportIssue & { id: string })[]>();
    for (const issue of summary.issues) {
      const list = map.get(issue.code) ?? [];
      list.push(issue);
      map.set(issue.code, list);
    }
    return [...map.entries()];
  }, [summary.issues]);

  const counts = summary.issues.reduce(
    (acc, i) => ({ ...acc, [i.severity]: (acc[i.severity] ?? 0) + 1 }),
    {} as Record<string, number>,
  );

  return (
    <section className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-ink">Import report</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {String(s.commentCount ?? 0)} comments across {String(s.sectionCount ?? 0)} sections
            {summary.sourceFilename ? ` from ${summary.sourceFilename}` : ""}
            {counts.warning ? ` · ${counts.warning} warning${counts.warning > 1 ? "s" : ""}` : ""}
            {counts.error ? ` · ${counts.error} error${counts.error > 1 ? "s" : ""}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-sm text-ink-soft">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-5">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Source rows" value={String(s.dataRows ?? 0)} />
            <Stat label="Comments" value={String(s.commentCount ?? 0)} />
            <Stat label="With formatting" value={String(s.htmlBodyCount ?? 0)} />
            <Stat label="Links kept" value={String(s.linkCount ?? 0)} />
          </dl>

          <p className="mt-4 text-sm text-ink-soft">
            Every non-empty row in the export became exactly one comment. Ordering
            follows the source file rather than the{" "}
            <code className="rounded bg-paper px-1">Order</code> column, which repeats
            values within an item and cannot be trusted as a sort key.
          </p>

          {Array.isArray(s.emptyColumns) && s.emptyColumns.length > 0 && (
            <div className="mt-4 rounded-lg border border-line bg-paper p-4">
              <h3 className="text-sm font-medium text-ink">
                Missing from the export &mdash; not unsupported here
              </h3>
              <p className="mt-1 text-sm text-ink-soft">
                {s.emptyColumns.length} column(s) exist in the file but hold no value on
                any row, so there was nothing to bring across:
              </p>
              <p className="mt-2 text-xs text-ink-soft">{s.emptyColumns.join(", ")}</p>
            </div>
          )}

          {grouped.length === 0 ? (
            <p className="mt-4 text-sm text-ink-soft">
              No issues were raised during import.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {grouped.map(([code, issues]) => (
                <li
                  key={code}
                  className={`rounded-lg border p-4 ${SEVERITY_STYLE[issues[0].severity]}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold">{code}</span>
                    <span className="text-xs">
                      {issues.length} occurrence{issues.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink">{issues[0].message}</p>
                  {issues.some((i) => i.sourceRow) && (
                    <p className="mt-2 text-xs text-ink-soft">
                      Source row(s):{" "}
                      {issues
                        .filter((i) => i.sourceRow)
                        .slice(0, 12)
                        .map((i) => i.sourceRow)
                        .join(", ")}
                      {issues.filter((i) => i.sourceRow).length > 12 ? "…" : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
