"use client";

import { useActionState, useRef, useState } from "react";
import { importTemplateAction, type ActionState } from "@/app/actions";

const INITIAL: ActionState = { ok: true };

export function UploadCard() {
  const [state, formAction, pending] = useActionState(importTemplateAction, INITIAL);
  const [filename, setFilename] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      action={formAction}
      className="rounded-xl border border-line bg-surface p-6 shadow-sm"
    >
      <h2 className="text-base font-semibold text-ink">Import a Spectora template</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Use <span className="font-medium text-ink">Export to spreadsheet &rarr; Export HTML Text</span>{" "}
        in Spectora, then drop the file here. <code className="rounded bg-paper px-1">.xls</code>,{" "}
        <code className="rounded bg-paper px-1">.xlsx</code> and{" "}
        <code className="rounded bg-paper px-1">.csv</code> are accepted.
      </p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped && inputRef.current) {
            const dt = new DataTransfer();
            dt.items.add(dropped);
            inputRef.current.files = dt.files;
            setFilename(dropped.name);
          }
        }}
        className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-paper hover:border-accent hover:bg-accent-soft/40"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".xls,.xlsx,.csv,.tsv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
        />
        <span className="text-sm font-medium text-ink">
          {filename ?? "Drop the export here, or click to choose"}
        </span>
        <span className="mt-1 text-xs text-ink-soft">
          Nothing is imported until you press Import.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import template"}
      </button>

      {state.error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-defect/30 bg-defect-soft p-3"
        >
          <p className="text-sm font-medium text-defect">Import rejected</p>
          <p className="mt-1 text-sm text-ink">{state.error}</p>
          {state.detail && state.detail.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-soft">
              {state.detail.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
