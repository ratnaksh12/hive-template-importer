import Link from "next/link";
import { UploadCard } from "@/components/UploadCard";
import { isSupabaseConfigured } from "@/lib/supabase";
import { listTemplates } from "@/lib/db/templates";

export const dynamic = "force-dynamic";

function SetupNotice() {
  return (
    <div className="rounded-xl border border-limit/40 bg-limit-soft p-6">
      <h2 className="text-base font-semibold text-ink">Supabase is not configured</h2>
      <p className="mt-2 text-sm text-ink-soft">
        Copy <code className="rounded bg-surface px-1">.env.example</code> to{" "}
        <code className="rounded bg-surface px-1">.env.local</code>, fill in{" "}
        <code className="rounded bg-surface px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="rounded bg-surface px-1">SUPABASE_SERVICE_ROLE_KEY</code>, then run{" "}
        <code className="rounded bg-surface px-1">supabase/schema.sql</code> in the Supabase SQL
        editor. See the README for the full walkthrough.
      </p>
    </div>
  );
}

export default async function HomePage() {
  const configured = isSupabaseConfigured();
  let templates: Awaited<ReturnType<typeof listTemplates>> = [];
  let loadError: string | null = null;

  if (configured) {
    try {
      templates = await listTemplates();
    } catch (err) {
      loadError = err instanceof Error ? err.message : "Could not load templates.";
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="border-b border-line pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-soft">
          Hive Inspect
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-ink">
          Template importer
        </h1>
        <p className="mt-3 max-w-2xl text-base text-ink-soft">
          Bring a Spectora template across without retyping it. Sections, items,
          comment text, formatting and links are preserved in a structured schema
          you can edit, duplicate and keep.
        </p>
      </header>

      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-ink">Your templates</h2>
            <span className="text-sm text-ink-soft">
              {templates.length} {templates.length === 1 ? "template" : "templates"}
            </span>
          </div>

          {!configured && (
            <div className="mt-4">
              <SetupNotice />
            </div>
          )}

          {loadError && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-defect/30 bg-defect-soft p-4 text-sm text-ink"
            >
              <p className="font-medium text-defect">Could not load templates</p>
              <p className="mt-1">{loadError}</p>
            </div>
          )}

          {configured && !loadError && templates.length === 0 && (
            <p className="mt-4 rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-soft">
              No templates yet. Import a Spectora export to get started.
            </p>
          )}

          <ul className="mt-4 space-y-3">
            {templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/templates/${t.id}`}
                  className="group flex items-center justify-between rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent hover:bg-accent-soft/30"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-ink">{t.name}</h3>
                      {t.origin === "copy" && (
                        <span className="shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                          copy
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">
                      {t.section_count} sections &middot; {t.comment_count} comments
                      {t.source_filename ? ` · ${t.source_filename}` : ""}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className="ml-4 shrink-0 text-ink-soft transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
                  >
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <aside>
          <UploadCard />
        </aside>
      </div>
    </main>
  );
}
