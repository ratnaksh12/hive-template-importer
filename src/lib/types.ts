/** Severity of an import issue. Nothing is dropped silently; it is recorded. */
export type IssueSeverity = "info" | "warning" | "error";

export interface ImportIssue {
  severity: IssueSeverity;
  /** Stable machine code, e.g. "UNKNOWN_COLUMN". Grouped in the import report. */
  code: string;
  message: string;
  /** 1-based row number in the source sheet, when the issue is row-scoped. */
  sourceRow?: number;
  columnName?: string;
  rawValue?: string;
}

export interface PhotoRef {
  url: string;
  caption: string;
}

export interface ParsedComment {
  name: string;
  /** Sanitised HTML fragment. Plain-text sources are HTML-escaped, never reworded. */
  bodyHtml: string;
  /** True when the source cell actually contained markup. */
  sourceWasHtml: boolean;

  commentType: string;
  category: string;
  recommendation: string;
  answerType: string;

  multipleChoiceOptions: string[];
  unitTypeOptions: string[];

  defaultValue: string;
  defaultValue2: string;
  defaultUnitType: string;
  defaultLocation: string;
  estimateMin: string;
  estimateMax: string;
  locked: string;
  simpleFormat: string;
  disablePhotos: string;
  uses: string;
  lastModified: string;

  defaultPhotos: PhotoRef[];
  /** Columns the importer had no first-class home for — preserved, not discarded. */
  extra: Record<string, string>;

  /** Spectora's "Order (w/i item)". NOT unique, so never used as the sort key. */
  spectoraOrder: number | null;
  sourceRow: number;
  /** Authoritative ordering, assigned from source sheet order. */
  position: number;
}

export interface ParsedItem {
  name: string;
  position: number;
  comments: ParsedComment[];
}

export interface ParsedSection {
  name: string;
  position: number;
  items: ParsedItem[];
}

export interface ImportStats {
  totalSheetRows: number;
  headerRow: number;
  dataRows: number;
  blankRowsSkipped: number;
  sectionCount: number;
  itemCount: number;
  commentCount: number;
  /** canonical field -> source header text actually matched. */
  mappedColumns: Record<string, string>;
  /** Headers present in the file that the importer did not recognise. */
  unknownColumns: string[];
  /** Headers recognised but empty for every row: missing DATA, not unsupported. */
  emptyColumns: string[];
  /** Canonical fields the importer supports that this file did not provide. */
  absentColumns: string[];
  linkCount: number;
  htmlBodyCount: number;
  plainTextBodyCount: number;
}

export interface ParsedTemplate {
  name: string;
  sourceFilename: string;
  sheetName: string;
  sections: ParsedSection[];
  issues: ImportIssue[];
  stats: ImportStats;
}

/* ------------------------------------------------------------------ */
/* Persisted shapes (what comes back out of the database)              */
/* ------------------------------------------------------------------ */

export interface TemplateRow {
  id: string;
  name: string;
  origin: "import" | "copy";
  copied_from_id: string | null;
  source_filename: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentRow {
  id: string;
  item_id: string;
  name: string;
  body_html: string;
  comment_type: string | null;
  category: string | null;
  recommendation: string | null;
  answer_type: string | null;
  multiple_choice_options: string[];
  unit_type_options: string[];
  default_value: string | null;
  default_value_2: string | null;
  default_unit_type: string | null;
  default_location: string | null;
  estimate_min: string | null;
  estimate_max: string | null;
  locked: string | null;
  simple_format: string | null;
  disable_photos: string | null;
  uses: string | null;
  last_modified: string | null;
  default_photos: PhotoRef[];
  extra: Record<string, string>;
  spectora_order: number | null;
  source_row: number | null;
  position: number;
}

export interface ItemRow {
  id: string;
  section_id: string;
  name: string;
  position: number;
  comments: CommentRow[];
}

export interface SectionRow {
  id: string;
  template_id: string;
  name: string;
  position: number;
  items: ItemRow[];
}

export interface TemplateTree extends TemplateRow {
  sections: SectionRow[];
}
