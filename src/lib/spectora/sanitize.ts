import sanitizeHtml from "sanitize-html";
import type { ImportIssue } from "@/lib/types";

/**
 * Rich-text policy for imported comment bodies.
 *
 * Goal: keep everything an inspector actually typed (paragraphs, emphasis,
 * lists, links, tables) and drop only what is unsafe or purely presentational —
 * and report every drop rather than performing it quietly.
 */
export const ALLOWED_TAGS = [
  "p", "br", "div", "span",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li",
  "a",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "hr", "pre", "code",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
];

/** Attributes kept per tag. Everything else is stripped and reported. */
export const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel", "title"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

export function looksLikeHtml(value: string): boolean {
  return /<[a-zA-Z/][^>]*>/.test(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Visible text of an HTML fragment, used for preservation checks. */
export function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SanitizedBody {
  html: string;
  sourceWasHtml: boolean;
  linkCount: number;
  issues: Omit<ImportIssue, "sourceRow">[];
}

const TAG_RE = /<\s*([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([a-zA-Z_:][\w:.-]*)\s*=/g;

/**
 * Sanitise one comment body.
 *
 * Plain-text cells are escaped rather than parsed, so text that merely *looks*
 * like markup (e.g. `attic < 6 ft`) survives intact.
 */
export function sanitizeCommentBody(raw: string): SanitizedBody {
  const issues: Omit<ImportIssue, "sourceRow">[] = [];
  const value = raw ?? "";

  if (!value.trim()) {
    return { html: "", sourceWasHtml: false, linkCount: 0, issues };
  }

  if (!looksLikeHtml(value)) {
    // Preserve line breaks; escape everything else verbatim.
    const html = escapeHtml(value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join("");
    return {
      html: html || `<p>${escapeHtml(value.trim())}</p>`,
      sourceWasHtml: false,
      linkCount: 0,
      issues,
    };
  }

  // --- Pre-scan so we can report what sanitisation is about to remove. ------
  const seenTags = new Set<string>();
  const strippedAttrs = new Set<string>();
  let match: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((match = TAG_RE.exec(value)) !== null) {
    const tag = match[1].toLowerCase();
    seenTags.add(tag);
    const attrsAllowedHere = ALLOWED_ATTRS[tag] ?? [];
    const attrBlob = match[2] ?? "";
    ATTR_RE.lastIndex = 0;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = ATTR_RE.exec(attrBlob)) !== null) {
      const attr = attrMatch[1].toLowerCase();
      if (!attrsAllowedHere.includes(attr)) strippedAttrs.add(`${tag}[${attr}]`);
    }
  }

  for (const tag of seenTags) {
    if (!ALLOWED_TAGS.includes(tag)) {
      issues.push({
        severity: "warning",
        code: "UNSUPPORTED_TAG",
        message:
          `<${tag}> is not supported by the importer and was removed from the ` +
          `comment body. Its text content was kept.`,
        rawValue: tag,
      });
    }
  }

  if (strippedAttrs.size > 0) {
    issues.push({
      severity: "info",
      code: "STRIPPED_ATTRIBUTE",
      message:
        `Presentational or unsafe attributes were removed: ` +
        `${[...strippedAttrs].sort().join(", ")}. Text and structure are unchanged.`,
      rawValue: [...strippedAttrs].sort().join(", "),
    });
  }

  // Spectora emits an empty, styled wrapper where a video embed used to be.
  // The export contains no video URL at all, so there is nothing to import:
  // this is data missing from the EXPORT, not a gap in the importer.
  if (/class\s*=\s*["'][^"']*embed[^"']*["']/i.test(value) &&
      !/<\s*(iframe|video|source)\b/i.test(value)) {
    issues.push({
      severity: "warning",
      code: "EMBED_PLACEHOLDER_WITHOUT_SOURCE",
      message:
        "This comment contained an empty media-embed wrapper. The Spectora " +
        "export includes the embed's styling but not the video URL, so there " +
        "is no media to import. The comment's text was preserved.",
    });
  }

  if (/<\s*img\b/i.test(value)) {
    issues.push({
      severity: "warning",
      code: "INLINE_IMAGE_DROPPED",
      message:
        "An inline <img> was removed. Images are not imported because the " +
        "export references Spectora-hosted files this app cannot read.",
    });
  }

  const clean = sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ALLOWED_SCHEMES,
    // Keep the words from unsupported containers instead of deleting them.
    nonTextTags: ["style", "script", "textarea", "noscript"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.href ? { target: attribs.target || "_blank" } : {}),
          ...(attribs.href ? { rel: "noopener noreferrer" } : {}),
        },
      }),
    },
  }).trim();

  const linkCount = (clean.match(/<a\b/gi) ?? []).length;
  const droppedLinks =
    (value.match(/<a\b/gi) ?? []).length - linkCount;
  if (droppedLinks > 0) {
    issues.push({
      severity: "warning",
      code: "LINK_DROPPED",
      message: `${droppedLinks} link(s) used an unsupported URL scheme and were removed.`,
    });
  }

  if (!clean && value.trim()) {
    issues.push({
      severity: "error",
      code: "BODY_EMPTIED_BY_SANITIZER",
      message:
        "The comment body became empty after sanitisation. The original markup " +
        "was preserved as escaped text so no content is lost.",
      rawValue: value.slice(0, 500),
    });
    return {
      html: `<p>${escapeHtml(value.trim())}</p>`,
      sourceWasHtml: true,
      linkCount: 0,
      issues,
    };
  }

  return { html: clean, sourceWasHtml: true, linkCount, issues };
}
