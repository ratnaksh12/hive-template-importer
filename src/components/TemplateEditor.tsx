"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  renameItemAction,
  renameSectionAction,
  renameTemplateAction,
  updateCommentAction,
} from "@/app/actions";
import type { CommentRow, TemplateTree } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";

/* ------------------------------------------------------------------ */
/* Save indicator                                                      */
/* ------------------------------------------------------------------ */

function useSaveIndicator() {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setState("saving");
    setMessage(null);
    const result = await fn();
    if (result.ok) {
      setState("saved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), 1800);
    } else {
      setState("error");
      setMessage(result.error ?? "Save failed.");
    }
  };

  return { state, message, run };
}

function SaveDot({ state, message }: { state: SaveState; message: string | null }) {
  if (state === "idle") return null;
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : message ?? "Save failed";
  const tone =
    state === "error" ? "text-defect" : state === "saved" ? "text-accent" : "text-ink-soft";
  return (
    <span role="status" className={`text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Editable single-line text                                           */
/* ------------------------------------------------------------------ */

function EditableName({
  value,
  onSave,
  className,
  ariaLabel,
}: {
  value: string;
  onSave: (next: string) => Promise<{ ok: boolean; error?: string }>;
  className?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(value);
  const { state, message, run } = useSaveIndicator();

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    if (!next) {
      setDraft(value);
      return;
    }
    void run(() => onSave(next));
  };

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <input
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
        className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 hover:border-line focus:border-accent focus:bg-surface focus:outline-none ${className ?? ""}`}
      />
      <SaveDot state={state} message={message} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Rich text body editor                                               */
/* ------------------------------------------------------------------ */

const TOOLS: { label: string; title: string; command: string; value?: string }[] = [
  { label: "B", title: "Bold", command: "bold" },
  { label: "I", title: "Italic", command: "italic" },
  { label: "• List", title: "Bulleted list", command: "insertUnorderedList" },
  { label: "1. List", title: "Numbered list", command: "insertOrderedList" },
];

/**
 * A deliberately small rich-text field.
 *
 * Inspectors write prose with bold, lists and the occasional link — not
 * arbitrary markup. Keeping the surface small means what they can produce is
 * always inside the importer's sanitisation policy, so an edited comment can
 * never become something the import path would have rejected.
 */
function CommentBodyEditor({
  comment,
  templateId,
}: {
  comment: CommentRow;
  templateId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { state, message, run } = useSaveIndicator();
  const lastSaved = useRef(comment.body_html);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== comment.body_html) {
      ref.current.innerHTML = comment.body_html;
      lastSaved.current = comment.body_html;
    }
  }, [comment.body_html]);

  const commit = () => {
    const html = ref.current?.innerHTML ?? "";
    if (html === lastSaved.current) return;
    lastSaved.current = html;
    void run(async () => {
      const result = await updateCommentAction(comment.id, { bodyHtml: html }, templateId);
      // The server sanitises; reflect the stored result so the editor never
      // shows markup that was not actually persisted.
      if (result.ok && result.bodyHtml !== undefined && ref.current) {
        ref.current.innerHTML = result.bodyHtml;
        lastSaved.current = result.bodyHtml;
      }
      return result;
    });
  };

  const exec = (command: string) => {
    ref.current?.focus();
    document.execCommand(command);
  };

  const addLink = () => {
    const url = window.prompt("Link URL (https://…)");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      window.alert("Links must start with http:// or https://");
      return;
    }
    ref.current?.focus();
    document.execCommand("createLink", false, url);
  };

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        {TOOLS.map((t) => (
          <button
            key={t.command}
            type="button"
            title={t.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(t.command)}
            className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          title="Add link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLink}
          className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent"
        >
          Link
        </button>
        <span className="ml-auto">
          <SaveDot state={state} message={message} />
        </span>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={`Comment text for ${comment.name}`}
        onBlur={commit}
        className="comment-html min-h-[3.5rem] rounded-lg border border-line bg-surface px-3 py-2 text-sm leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Comment card                                                        */
/* ------------------------------------------------------------------ */

const TYPE_STYLE: Record<string, string> = {
  defect: "border-defect/30 bg-defect-soft text-defect",
  limit: "border-limit/40 bg-limit-soft text-limit",
  info: "border-info/30 bg-info-soft text-info",
};

function CommentCard({
  comment,
  templateId,
}: {
  comment: CommentRow;
  templateId: string;
}) {
  const extras = Object.entries(comment.extra ?? {});

  return (
    <li className="rounded-lg border border-line bg-paper p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            TYPE_STYLE[comment.comment_type ?? ""] ?? "border-line bg-surface text-ink-soft"
          }`}
        >
          {comment.comment_type || "—"}
        </span>
        <EditableName
          ariaLabel="Comment name"
          value={comment.name}
          className="text-sm font-semibold text-ink"
          onSave={(name) => updateCommentAction(comment.id, { name }, templateId)}
        />
        <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-soft">
          row {comment.source_row ?? "—"}
        </span>
      </div>

      <div className="mt-3">
        <CommentBodyEditor comment={comment} templateId={templateId} />
      </div>

      {(comment.multiple_choice_options?.length > 0 ||
        comment.unit_type_options?.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[...comment.multiple_choice_options, ...comment.unit_type_options].map((o, i) => (
            <span
              key={`${o}-${i}`}
              className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft"
            >
              {o}
            </span>
          ))}
        </div>
      )}

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-soft">
        {comment.answer_type && (
          <div className="flex gap-1">
            <dt>answer</dt>
            <dd className="font-medium text-ink">{comment.answer_type}</dd>
          </div>
        )}
        {comment.category && (
          <div className="flex gap-1">
            <dt>category</dt>
            <dd className="font-medium text-ink">{comment.category}</dd>
          </div>
        )}
        {comment.recommendation && (
          <div className="flex gap-1">
            <dt>recommendation</dt>
            <dd className="font-medium text-ink">{comment.recommendation}</dd>
          </div>
        )}
        {extras.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt>{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function TemplateEditor({ template }: { template: TemplateTree }) {
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(template.sections.slice(0, 1).map((s) => s.id)),
  );
  const [, startTransition] = useTransition();

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!needle) return template.sections;
    const text = (html: string) => html.replace(/<[^>]+>/g, " ").toLowerCase();
    return template.sections
      .map((s) => ({
        ...s,
        items: s.items
          .map((i) => ({
            ...i,
            comments: i.comments.filter(
              (c) =>
                c.name.toLowerCase().includes(needle) ||
                text(c.body_html).includes(needle),
            ),
          }))
          .filter(
            (i) => i.comments.length > 0 || i.name.toLowerCase().includes(needle),
          ),
      }))
      .filter((s) => s.items.length > 0 || s.name.toLowerCase().includes(needle));
  }, [template.sections, needle]);

  const matchCount = filtered.reduce(
    (n, s) => n + s.items.reduce((m, i) => m + i.comments.length, 0),
    0,
  );

  const toggle = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-4 bg-paper/90 px-1 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              const v = e.target.value;
              startTransition(() => setQuery(v));
            }}
            placeholder="Search comments and items…"
            aria-label="Search this template"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() =>
              setOpenSections((prev) =>
                prev.size === template.sections.length
                  ? new Set()
                  : new Set(template.sections.map((s) => s.id)),
              )
            }
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
          >
            {openSections.size === template.sections.length ? "Collapse all" : "Expand all"}
          </button>
        </div>
        {needle && (
          <p className="mt-2 text-xs text-ink-soft">
            {matchCount} matching comment{matchCount === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {filtered.map((section) => {
          const isOpen = openSections.has(section.id) || Boolean(needle);
          const commentCount = section.items.reduce((n, i) => n + i.comments.length, 0);
          return (
            <section
              key={section.id}
              className="overflow-hidden rounded-xl border border-line bg-surface"
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${section.name}`}
                  className="shrink-0 text-ink-soft transition-transform hover:text-accent"
                  style={{ transform: isOpen ? "rotate(90deg)" : undefined }}
                >
                  &#9656;
                </button>
                <EditableName
                  ariaLabel="Section name"
                  value={section.name}
                  className="text-lg font-semibold text-ink"
                  onSave={(name) => renameSectionAction(section.id, name, template.id)}
                />
                <span className="ml-auto shrink-0 text-sm text-ink-soft">
                  {section.items.length} items &middot; {commentCount} comments
                </span>
              </div>

              {isOpen && (
                <div className="space-y-5 border-t border-line bg-paper/40 px-5 py-5">
                  {section.items.map((item) => (
                    <div key={item.id}>
                      <EditableName
                        ariaLabel="Item name"
                        value={item.name}
                        className="text-sm font-semibold uppercase tracking-wide text-ink-soft"
                        onSave={(name) => renameItemAction(item.id, name, template.id)}
                      />
                      <ul className="mt-2 space-y-2">
                        {item.comments.map((comment) => (
                          <CommentCard
                            key={comment.id}
                            comment={comment}
                            templateId={template.id}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-soft">
            Nothing matches &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
