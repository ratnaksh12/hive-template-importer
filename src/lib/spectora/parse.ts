import ExcelJS from "exceljs";
import Papa from "papaparse";
import {
  REQUIRED_FIELDS,
  resolveHeaders,
  scoreHeaderRow,
  splitOptions,
  type CanonicalField,
  type HeaderResolution,
} from "./columns";
import { sanitizeCommentBody } from "./sanitize";
import type {
  ImportIssue,
  ImportStats,
  ParsedComment,
  ParsedSection,
  ParsedTemplate,
  PhotoRef,
} from "@/lib/types";

/** How many leading rows to search for the header row. */
const MAX_HEADER_SCAN = 15;
/** Minimum recognised headers before we accept a row as the header row. */
const MIN_HEADER_SCORE = 3;

/** Thrown when the file cannot be imported at all. Carries reportable issues. */
export class SpectoraImportError extends Error {
  issues: ImportIssue[];
  constructor(message: string, issues: ImportIssue[] = []) {
    super(message);
    this.name = "SpectoraImportError";
    this.issues = issues;
  }
}

/* ------------------------------------------------------------------ */
/* Cell + grid loading                                                 */
/* ------------------------------------------------------------------ */

type Grid = { rows: string[][]; sheetName: string };

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();

  const v = value as Record<string, unknown>;
  // Rich text: concatenate runs, preserving the author's words.
  if (Array.isArray(v.richText)) {
    return (v.richText as { text: string }[]).map((r) => r.text).join("");
  }
  // Formula cells expose their cached result.
  if ("result" in v) return cellToString(v.result);
  if ("hyperlink" in v) return String(v.text ?? v.hyperlink ?? "");
  if ("text" in v) return String(v.text);
  return String(value);
}

function isXlsx(bytes: Uint8Array): boolean {
  // OOXML is a zip archive. Spectora names the file .xls but writes .xlsx.
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function loadGrid(buffer: ArrayBuffer, filename: string): Promise<Grid> {
  const bytes = new Uint8Array(buffer);

  if (isXlsx(bytes)) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch (err) {
      throw new SpectoraImportError(
        "This file looks like a spreadsheet but could not be opened. It may be " +
          "corrupt, password-protected, or a legacy .xls (BIFF) file. Re-export " +
          "from Spectora using Export to spreadsheet -> Export HTML Text.",
        [
          {
            severity: "error",
            code: "WORKBOOK_UNREADABLE",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
      );
    }
    const ws = wb.worksheets[0];
    if (!ws) {
      throw new SpectoraImportError("The workbook contains no worksheets.", [
        { severity: "error", code: "NO_WORKSHEET", message: "No worksheets found." },
      ]);
    }
    const rows: string[][] = [];
    const colCount = Math.max(ws.columnCount, 1);
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= colCount; c++) {
        cells.push(cellToString(row.getCell(c).value));
      }
      rows.push(cells);
    }
    return { rows, sheetName: ws.name };
  }

  // Not a zip: treat as delimited text. Papaparse auto-detects the delimiter,
  // which covers both the .csv and .tsv variants of the same export.
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  if (!text.trim()) {
    throw new SpectoraImportError("The uploaded file is empty.", [
      { severity: "error", code: "EMPTY_FILE", message: "No content." },
    ]);
  }
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return {
    rows: result.data.map((r) => (Array.isArray(r) ? r.map((c) => c ?? "") : [])),
    sheetName: filename,
  };
}

/* ------------------------------------------------------------------ */
/* Template naming                                                     */
/* ------------------------------------------------------------------ */

export function templateNameFromFilename(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  // Spectora appends an export date, e.g. "InterNACHI Residential -2026-09-16".
  return base.replace(/\s*-\s*\d{4}-\d{2}-\d{2}\s*$/, "").trim() || base.trim() || "Imported template";
}

/* ------------------------------------------------------------------ */
/* Main parse                                                          */
/* ------------------------------------------------------------------ */

export async function parseSpectoraExport(
  buffer: ArrayBuffer,
  filename: string,
): Promise<ParsedTemplate> {
  const issues: ImportIssue[] = [];
  const { rows, sheetName } = await loadGrid(buffer, filename);

  if (rows.length === 0) {
    throw new SpectoraImportError("The file contains no rows.", [
      { severity: "error", code: "NO_ROWS", message: "No rows found." },
    ]);
  }

  // --- Locate the header row ------------------------------------------------
  let headerRowIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i++) {
    const score = scoreHeaderRow(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      headerRowIndex = i;
    }
  }

  if (headerRowIndex === -1 || bestScore < MIN_HEADER_SCORE) {
    throw new SpectoraImportError(
      "This does not look like a Spectora template export. No header row with " +
        "recognisable columns (Section Name, Item Name, Comment Name, ...) was " +
        "found in the first " +
        MAX_HEADER_SCAN +
        " rows.",
      [
        {
          severity: "error",
          code: "HEADER_NOT_FOUND",
          message: `Best candidate row matched only ${bestScore} known column(s).`,
          rawValue: rows[0]?.slice(0, 8).join(" | ").slice(0, 300),
        },
      ],
    );
  }

  if (headerRowIndex > 0) {
    issues.push({
      severity: "info",
      code: "HEADER_ROW_OFFSET",
      message: `Header row found at row ${headerRowIndex + 1}; rows above it were ignored.`,
      sourceRow: headerRowIndex + 1,
    });
  }

  const resolution = resolveHeaders(rows[headerRowIndex]);
  const { fields, photos, unknown, matchedHeaders } = resolution;

  const missingRequired = REQUIRED_FIELDS.filter((f) => fields[f] === undefined);
  if (missingRequired.length > 0) {
    throw new SpectoraImportError(
      `The export is missing required column(s): ${missingRequired.join(", ")}. ` +
        "An export without section, item and comment names cannot be turned into " +
        "a structured template.",
      [
        {
          severity: "error",
          code: "MISSING_REQUIRED_COLUMN",
          message: `Missing: ${missingRequired.join(", ")}`,
          rawValue: rows[headerRowIndex].filter(Boolean).join(" | ").slice(0, 500),
        },
      ],
    );
  }

  for (const [col, header] of unknown) {
    issues.push({
      severity: "warning",
      code: "UNKNOWN_COLUMN",
      message:
        `Column "${header}" is not one the importer maps to a field. Its values ` +
        "are preserved on each comment and shown in the editor, but they are not " +
        "given dedicated behaviour.",
      columnName: header,
      sourceRow: headerRowIndex + 1,
      rawValue: `column ${col}`,
    });
  }

  // --- Walk the data rows ---------------------------------------------------
  const get = (row: string[], field: CanonicalField): string => {
    const col = fields[field];
    if (col === undefined) return "";
    return (row[col - 1] ?? "").trim();
  };

  const sections: ParsedSection[] = [];
  const sectionByName = new Map<string, ParsedSection>();
  const itemByKey = new Map<string, { item: ParsedSection["items"][number] }>();
  const seenCommentNames = new Map<string, Set<string>>();

  const columnHadValue = new Set<number>();
  let blankRowsSkipped = 0;
  let dataRows = 0;
  let commentCount = 0;
  let linkCount = 0;
  let htmlBodyCount = 0;
  let plainTextBodyCount = 0;
  let lastSectionName: string | null = null;

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const sourceRow = i + 1;

    row.forEach((cell, zeroBased) => {
      if ((cell ?? "").trim()) columnHadValue.add(zeroBased + 1);
    });

    if (!row.some((c) => (c ?? "").trim())) {
      blankRowsSkipped++;
      continue;
    }
    dataRows++;

    let sectionName = get(row, "sectionName");
    let itemName = get(row, "itemName");
    let commentName = get(row, "commentName");

    if (!sectionName) {
      sectionName = "(Untitled section)";
      issues.push({
        severity: "warning",
        code: "MISSING_SECTION_NAME",
        message:
          "Row has no Section Name. It was placed in a section named " +
          '"(Untitled section)" rather than dropped.',
        sourceRow,
      });
    }
    if (!itemName) {
      itemName = "(Untitled item)";
      issues.push({
        severity: "warning",
        code: "MISSING_ITEM_NAME",
        message:
          'Row has no Item Name. It was placed in "(Untitled item)" rather than dropped.',
        sourceRow,
      });
    }
    if (!commentName) {
      commentName = "(Untitled comment)";
      issues.push({
        severity: "warning",
        code: "MISSING_COMMENT_NAME",
        message:
          'Row has no Comment Name. It was imported as "(Untitled comment)" so its ' +
          "text is not lost.",
        sourceRow,
      });
    }

    // Section
    let section = sectionByName.get(sectionName);
    if (!section) {
      section = { name: sectionName, position: sections.length, items: [] };
      sections.push(section);
      sectionByName.set(sectionName, section);
    } else if (lastSectionName !== sectionName) {
      issues.push({
        severity: "info",
        code: "SECTION_ROWS_NOT_CONTIGUOUS",
        message:
          `Rows for section "${sectionName}" are not contiguous in the export. ` +
          "They were merged into the single section, preserving row order.",
        sourceRow,
      });
    }
    lastSectionName = sectionName;

    // Item
    const itemKey = `${sectionName} ${itemName}`;
    let entry = itemByKey.get(itemKey);
    if (!entry) {
      const item = { name: itemName, position: section.items.length, comments: [] };
      section.items.push(item);
      entry = { item };
      itemByKey.set(itemKey, entry);
    }
    const item = entry.item;

    // Duplicate comment names are legal in Spectora; keep both, flag once.
    const nameSet = seenCommentNames.get(itemKey) ?? new Set<string>();
    if (nameSet.has(commentName.toLowerCase())) {
      issues.push({
        severity: "warning",
        code: "DUPLICATE_COMMENT_NAME",
        message:
          `"${sectionName} > ${itemName}" contains more than one comment named ` +
          `"${commentName}". Both were imported — they are separate comments in ` +
          "the export and merging them would lose text.",
        sourceRow,
      });
    }
    nameSet.add(commentName.toLowerCase());
    seenCommentNames.set(itemKey, nameSet);

    // Body
    const rawBody = fields.commentText ? (row[fields.commentText - 1] ?? "") : "";
    const body = sanitizeCommentBody(rawBody);
    for (const issue of body.issues) {
      issues.push({ ...issue, sourceRow });
    }
    linkCount += body.linkCount;
    if (rawBody.trim()) {
      if (body.sourceWasHtml) htmlBodyCount++;
      else plainTextBodyCount++;
    }

    // Photos
    const photoSlots = new Map<number, PhotoRef>();
    for (const [col, slot] of photos) {
      const val = (row[col - 1] ?? "").trim();
      if (!val) continue;
      const ref = photoSlots.get(slot.index) ?? { url: "", caption: "" };
      if (slot.isCaption) ref.caption = val;
      else ref.url = val;
      photoSlots.set(slot.index, ref);
    }
    const defaultPhotos = [...photoSlots.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, ref]) => ref)
      .filter((r) => r.url || r.caption);

    // Unrecognised columns are preserved verbatim.
    const extra: Record<string, string> = {};
    for (const [col, header] of unknown) {
      const val = (row[col - 1] ?? "").trim();
      if (val) extra[header] = val;
    }

    const orderRaw = get(row, "order");
    const spectoraOrder = orderRaw !== "" && Number.isFinite(Number(orderRaw))
      ? Number(orderRaw)
      : null;

    const comment: ParsedComment = {
      name: commentName,
      bodyHtml: body.html,
      sourceWasHtml: body.sourceWasHtml,
      commentType: get(row, "commentType"),
      category: get(row, "category"),
      recommendation: get(row, "recommendation"),
      answerType: get(row, "answerType"),
      multipleChoiceOptions: splitOptions(get(row, "multipleChoiceOptions")),
      unitTypeOptions: splitOptions(get(row, "unitTypeOptions")),
      defaultValue: get(row, "defaultValue"),
      defaultValue2: get(row, "defaultValue2"),
      defaultUnitType: get(row, "defaultUnitType"),
      defaultLocation: get(row, "defaultLocation"),
      estimateMin: get(row, "estimateMin"),
      estimateMax: get(row, "estimateMax"),
      locked: get(row, "locked"),
      simpleFormat: get(row, "simpleFormat"),
      disablePhotos: get(row, "disablePhotos"),
      uses: get(row, "uses"),
      lastModified: get(row, "lastModified"),
      defaultPhotos,
      extra,
      spectoraOrder,
      sourceRow,
      position: item.comments.length,
    };
    item.comments.push(comment);
    commentCount++;
  }

  if (commentCount === 0) {
    throw new SpectoraImportError(
      "The header row was recognised but the file contains no data rows to import.",
      [
        {
          severity: "error",
          code: "NO_DATA_ROWS",
          message: "Zero importable rows below the header.",
          sourceRow: headerRowIndex + 1,
        },
      ],
    );
  }

  // --- Columns present but empty vs columns the importer supports ----------
  const emptyColumns: string[] = [];
  const reportEmpty = (col: number, label: string) => {
    if (!columnHadValue.has(col)) emptyColumns.push(label);
  };
  for (const [field, col] of Object.entries(fields)) {
    if (col === undefined) continue;
    reportEmpty(col, matchedHeaders[field] ?? field);
  }
  for (const [col] of photos) {
    reportEmpty(col, rows[headerRowIndex][col - 1] ?? `column ${col}`);
  }
  if (emptyColumns.length > 0) {
    issues.push({
      severity: "info",
      code: "COLUMN_PRESENT_BUT_EMPTY",
      message:
        `${emptyColumns.length} column(s) exist in the export but hold no value on ` +
        "any row, so there was nothing to import. This is data the export did not " +
        `include, not a limitation of the importer: ${emptyColumns.join(", ")}.`,
      rawValue: emptyColumns.join(", "),
    });
  }

  const allFields: CanonicalField[] = [
    "sectionName", "itemName", "commentName", "commentText", "commentType",
    "category", "multipleChoiceOptions", "unitTypeOptions", "recommendation",
    "order", "answerType", "defaultValue", "defaultValue2", "defaultUnitType",
    "defaultLocation", "estimateMin", "estimateMax", "locked", "simpleFormat",
    "disablePhotos", "uses", "lastModified",
  ];
  const absentColumns = allFields.filter((f) => fields[f] === undefined);
  if (absentColumns.length > 0) {
    issues.push({
      severity: "info",
      code: "COLUMN_ABSENT_FROM_EXPORT",
      message:
        "The importer supports these fields but the export did not contain them: " +
        `${absentColumns.join(", ")}.`,
      rawValue: absentColumns.join(", "),
    });
  }

  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);

  const stats: ImportStats = {
    totalSheetRows: rows.length,
    headerRow: headerRowIndex + 1,
    dataRows,
    blankRowsSkipped,
    sectionCount: sections.length,
    itemCount,
    commentCount,
    mappedColumns: matchedHeaders,
    unknownColumns: [...unknown.values()],
    emptyColumns,
    absentColumns,
    linkCount,
    htmlBodyCount,
    plainTextBodyCount,
  };

  return {
    name: templateNameFromFilename(filename),
    sourceFilename: filename,
    sheetName,
    sections,
    issues,
    stats,
  };
}
