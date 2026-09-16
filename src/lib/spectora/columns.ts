/**
 * Column mapping for Spectora "Export to spreadsheet -> Export HTML Text" files.
 *
 * The importer never addresses columns by index. It reads the header row and
 * resolves each header to a canonical field by normalised name, so a future
 * export that reorders, renames slightly, or omits columns still imports.
 * Anything it cannot resolve is reported and preserved in `extra`.
 */

export type CanonicalField =
  | "sectionName"
  | "itemName"
  | "commentName"
  | "commentText"
  | "commentType"
  | "category"
  | "multipleChoiceOptions"
  | "unitTypeOptions"
  | "recommendation"
  | "order"
  | "answerType"
  | "defaultValue"
  | "defaultValue2"
  | "defaultUnitType"
  | "defaultLocation"
  | "estimateMin"
  | "estimateMax"
  | "locked"
  | "simpleFormat"
  | "disablePhotos"
  | "uses"
  | "lastModified";

/** Without these three the file cannot be treated as a Spectora template. */
export const REQUIRED_FIELDS: CanonicalField[] = [
  "sectionName",
  "itemName",
  "commentName",
];

/**
 * Normalise a header for matching: strip parentheticals (Spectora puts the
 * legend in there, e.g. `Category (-1: Low, 0: Med, 1: High)`), fold curly
 * quotes, drop punctuation, collapse whitespace.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, " ")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Accepted normalised spellings per canonical field. Order matters only in that
 * a header matches at most one field; the first field claiming it wins.
 */
const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  sectionName: ["section name", "section"],
  itemName: ["item name", "item", "subsection", "sub section"],
  commentName: ["comment name", "comment title"],
  commentText: ["comment text", "comment html", "html text", "comment body"],
  commentType: ["comment type", "type"],
  category: ["category", "severity"],
  multipleChoiceOptions: [
    "multiple choice options",
    "multiple choice",
    "choices",
    "options",
  ],
  unitTypeOptions: ["unit type options", "unit types", "unit options"],
  recommendation: ["recommendation", "recommendations"],
  order: ["order", "sort order", "position"],
  answerType: ["answer type", "input type"],
  defaultValue: ["default value", "default value 1"],
  defaultValue2: ["default value 2"],
  defaultUnitType: ["default unit type"],
  defaultLocation: ["default location"],
  estimateMin: ["default estimate min", "estimate min"],
  estimateMax: ["default estimate max", "estimate max"],
  locked: ["locked"],
  simpleFormat: ["simple format"],
  disablePhotos: ["disable photos"],
  uses: ["uses", "use count"],
  lastModified: ["last modified", "modified", "updated at"],
};

const ALIAS_TO_FIELD: Map<string, CanonicalField> = (() => {
  const m = new Map<string, CanonicalField>();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (!m.has(alias)) m.set(alias, field as CanonicalField);
    }
  }
  return m;
})();

/** `Default Photo 3` / `Default Photo 3 Caption` -> { index, isCaption }. */
const PHOTO_RE = /^default photo (\d+)( caption)?$/;

export interface PhotoColumn {
  index: number;
  isCaption: boolean;
}

export interface HeaderResolution {
  /** canonical field -> column index (1-based). */
  fields: Partial<Record<CanonicalField, number>>;
  /** column index (1-based) -> photo slot. */
  photos: Map<number, PhotoColumn>;
  /** column index (1-based) -> original header text, for unrecognised columns. */
  unknown: Map<number, string>;
  /** canonical field -> the header text it matched. */
  matchedHeaders: Record<string, string>;
}

/**
 * Resolve a header row. Columns are 1-based to match spreadsheet addressing.
 * A blank header over a populated column is reported by the caller as unknown.
 */
export function resolveHeaders(headers: string[]): HeaderResolution {
  const fields: Partial<Record<CanonicalField, number>> = {};
  const photos = new Map<number, PhotoColumn>();
  const unknown = new Map<number, string>();
  const matchedHeaders: Record<string, string> = {};

  headers.forEach((raw, zeroBased) => {
    const col = zeroBased + 1;
    const text = (raw ?? "").trim();
    if (!text) return;

    const norm = normalizeHeader(text);
    if (!norm) return;

    const photo = PHOTO_RE.exec(norm);
    if (photo) {
      photos.set(col, {
        index: Number(photo[1]),
        isCaption: Boolean(photo[2]),
      });
      return;
    }

    const field = ALIAS_TO_FIELD.get(norm);
    // A duplicated header must not silently overwrite the first mapping.
    if (field && fields[field] === undefined) {
      fields[field] = col;
      matchedHeaders[field] = text;
      return;
    }

    unknown.set(col, text);
  });

  return { fields, photos, unknown, matchedHeaders };
}

/**
 * Split a Spectora comma-separated option list.
 *
 * Limitation: Spectora does not quote or escape option values, so an option
 * containing a literal comma is indistinguishable from two options. Documented
 * in NOTES.md rather than guessed at.
 */
export function splitOptions(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.replace(/ /g, " ").trim())
    .filter(Boolean);
}

/** A header row is one where enough known headers appear to be unambiguous. */
export function scoreHeaderRow(headers: string[]): number {
  let score = 0;
  for (const h of headers) {
    const norm = normalizeHeader((h ?? "").trim());
    if (!norm) continue;
    if (ALIAS_TO_FIELD.has(norm) || PHOTO_RE.test(norm)) score++;
  }
  return score;
}
