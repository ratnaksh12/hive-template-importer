"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseSpectoraExport, SpectoraImportError } from "@/lib/spectora/parse";
import {
  copyTemplate,
  deleteTemplate,
  renameItem,
  renameSection,
  renameTemplate,
  saveImportedTemplate,
  updateComment,
  type CommentPatch,
} from "@/lib/db/templates";
import { sanitizeCommentBody } from "@/lib/spectora/sanitize";

export interface ActionState {
  ok: boolean;
  error?: string;
  /** Issue detail surfaced when an import is rejected outright. */
  detail?: string[];
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function importTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let templateId: string;

  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a Spectora export file to import." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`,
      };
    }

    const parsed = await parseSpectoraExport(await file.arrayBuffer(), file.name);
    templateId = await saveImportedTemplate(parsed);
  } catch (err) {
    if (err instanceof SpectoraImportError) {
      return {
        ok: false,
        error: err.message,
        detail: err.issues.map((i) => `${i.code}: ${i.message}`),
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The import failed unexpectedly.",
    };
  }

  revalidatePath("/");
  redirect(`/templates/${templateId}?imported=1`);
}

export async function copyTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let newId: string;
  try {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing template id." };
    newId = await copyTemplate(id, String(formData.get("name") ?? "") || undefined);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not copy the template.",
    };
  }
  revalidatePath("/");
  redirect(`/templates/${newId}?copied=1`);
}

export async function deleteTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) {
    await deleteTemplate(id);
    revalidatePath("/");
  }
  redirect("/");
}

/* ------------------------------------------------------------------ */
/* Inline edits                                                        */
/* ------------------------------------------------------------------ */

function requireName(value: unknown, label: string): string {
  const name = String(value ?? "").trim();
  if (!name) throw new Error(`${label} cannot be empty.`);
  if (name.length > 500) throw new Error(`${label} is too long (500 characters max).`);
  return name;
}

export async function renameTemplateAction(
  id: string,
  name: string,
): Promise<ActionState> {
  try {
    await renameTemplate(id, requireName(name, "Template name"));
    revalidatePath(`/templates/${id}`);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed." };
  }
}

export async function renameSectionAction(
  id: string,
  name: string,
  templateId: string,
): Promise<ActionState> {
  try {
    await renameSection(id, requireName(name, "Section name"));
    revalidatePath(`/templates/${templateId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed." };
  }
}

export async function renameItemAction(
  id: string,
  name: string,
  templateId: string,
): Promise<ActionState> {
  try {
    await renameItem(id, requireName(name, "Item name"));
    revalidatePath(`/templates/${templateId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed." };
  }
}

export interface CommentEdit {
  name?: string;
  bodyHtml?: string;
  commentType?: string;
  category?: string;
}

export async function updateCommentAction(
  id: string,
  edit: CommentEdit,
  templateId: string,
): Promise<ActionState & { bodyHtml?: string }> {
  try {
    const patch: CommentPatch = {};

    if (edit.name !== undefined) patch.name = requireName(edit.name, "Comment name");

    if (edit.bodyHtml !== undefined) {
      // Editor input is untrusted: run it through the same policy as import so a
      // saved body can never contain markup the importer would have rejected.
      patch.body_html = sanitizeCommentBody(edit.bodyHtml).html;
    }
    if (edit.commentType !== undefined) patch.comment_type = edit.commentType || null;
    if (edit.category !== undefined) patch.category = edit.category || null;

    if (Object.keys(patch).length === 0) return { ok: true };

    await updateComment(id, patch);
    revalidatePath(`/templates/${templateId}`);
    return { ok: true, bodyHtml: patch.body_html };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed." };
  }
}
