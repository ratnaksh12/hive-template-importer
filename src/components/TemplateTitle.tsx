"use client";

import { useEffect, useRef, useState } from "react";
import { renameTemplateAction } from "@/app/actions";

/** Editable template name. Saves on blur or Enter; Escape reverts. */
export function TemplateTitle({ id, name }: { id: string; name: string }) {
  const [draft, setDraft] = useState(name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(name), [name]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = async () => {
    const next = draft.trim();
    if (!next) {
      setDraft(name);
      return;
    }
    if (next === name) return;

    setStatus("saving");
    setError(null);
    const result = await renameTemplateAction(id, next);
    if (result.ok) {
      setStatus("saved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus("idle"), 1800);
    } else {
      setStatus("error");
      setError(result.error ?? "Save failed.");
      setDraft(name);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          aria-label="Template name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setDraft(name);
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-3xl font-semibold tracking-tight text-ink hover:border-line focus:border-accent focus:bg-surface focus:outline-none"
        />
        {status !== "idle" && (
          <span
            role="status"
            className={`shrink-0 text-xs font-medium ${
              status === "error" ? "text-defect" : status === "saved" ? "text-accent" : "text-ink-soft"
            }`}
          >
            {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : error}
          </span>
        )}
      </div>
    </div>
  );
}
