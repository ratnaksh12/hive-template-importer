"use client";

import { useActionState, useState } from "react";
import {
  copyTemplateAction,
  deleteTemplateAction,
  type ActionState,
} from "@/app/actions";

const INITIAL: ActionState = { ok: true };

export function TemplateActions({
  templateId,
  templateName,
}: {
  templateId: string;
  templateName: string;
}) {
  const [copyState, copyAction, copying] = useActionState(copyTemplateAction, INITIAL);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={copyAction} className="flex items-center gap-2">
        <input type="hidden" name="id" value={templateId} />
        <input type="hidden" name="name" value={`${templateName} (copy)`} />
        <button
          type="submit"
          disabled={copying}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {copying ? "Duplicating…" : "Duplicate"}
        </button>
      </form>

      {confirmingDelete ? (
        <form action={deleteTemplateAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={templateId} />
          <span className="text-sm text-ink-soft">Delete permanently?</span>
          <button
            type="submit"
            className="rounded-lg bg-defect px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Yes, delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:text-ink"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-defect hover:text-defect"
        >
          Delete
        </button>
      )}

      {copyState.error && (
        <p role="alert" className="w-full text-sm text-defect">
          {copyState.error}
        </p>
      )}
    </div>
  );
}
