# NOTES

Decisions, limits, and how the work was checked.

> **Before submitting**, fill in the three items marked `TODO(you)` — they are
> the only things that cannot be derived from the code: the live URL, the video
> link, and your own product-exploration findings.

---

## Supported input

The importer accepts a **Spectora "Export to spreadsheet → Export HTML Text"** file.

| | |
|---|---|
| Formats | `.xlsx` (including files Spectora names `.xls`), `.csv`, `.tsv` |
| Detection | Magic bytes (`PK…` = OOXML), not the file extension |
| Required columns | `Section Name`, `Item Name`, `Comment Name` |
| Optional columns | The other 39 columns in the standard export, all mapped by name |
| Header location | Auto-detected in the first 15 rows, so title/banner rows are tolerated |
| Column order | Irrelevant — columns are resolved by normalised header name, never by index |

Legacy binary `.xls` (BIFF, pre-2007) is **not** supported. Spectora does not emit
it; the file is named `.xls` but is really OOXML. If a true BIFF file is uploaded
it is rejected with an explanatory message rather than partially parsed.

---

## What the export contains vs. what the importer supports

The brief asks for this distinction explicitly, and the app surfaces it in the
**Import report** rather than burying it here.

### Missing from the export (nothing to import)

26 of the 42 columns in the committed InterNACHI export are present as headers
but **empty on all 392 rows** — `Default Location`, `Locked`, `Simple Format`,
`Disable Photos`, `Default Value 2`, `Default Unit Type`, and all 20
`Default Photo N` / `Default Photo N Caption` columns.

The importer maps every one of these. The data simply is not in the file.
Reported as `COLUMN_PRESENT_BUT_EMPTY`.

The sharpest example is **`Doors, Windows & Interior > Walls > Doorknob Hole`**
(source row 311), whose body is:

```html
<p>Wall had damage from doorknob. Recommend a qualified handyman…</p>
<div class="youtube-embed-wrapper" style="position:relative;padding-bottom:56.25%;…"> </div>
```

Spectora exported the embed's **styling shell but not the video URL**. There is
no media reference anywhere in the row. The text is preserved and the gap is
reported as `EMBED_PLACEHOLDER_WITHOUT_SOURCE` — the app states plainly that the
video is missing from the export rather than implying the importer dropped it.

### Deliberately not supported by the importer

| Content | Behaviour | Why |
|---|---|---|
| `class`, `style`, and other presentational attributes | Stripped; reported as `STRIPPED_ATTRIBUTE` | Imported markup must not restyle the host app. Text and structure are untouched |
| `<script>`, `<style>`, `<iframe>`, `<object>` | Removed; text content kept | Untrusted HTML from a file upload is an injection vector |
| `<img>` | Removed; reported as `INLINE_IMAGE_DROPPED` | Sources point at Spectora-hosted files this app cannot read |
| Link schemes other than `http`/`https`/`mailto`/`tel` | Link removed; reported as `LINK_DROPPED` | `javascript:` URLs are an XSS vector |
| Options containing a literal comma | Split into two options | Spectora neither quotes nor escapes option values, so this is genuinely ambiguous in the source format. Guessing would be worse than documenting |

All 43 links in the committed export survive, with `rel="noopener noreferrer"`
added.

---

## Decisions worth explaining

**Ordering does not use Spectora's `Order` column.** 38 of the 69 items reuse
`Order` values within the same item, so it is not a valid sort key. Source sheet
row order is authoritative (`position`); `Order` is preserved as `spectora_order`
for reference. Using it naively would silently scramble a four-year-old template.

**Duplicate comment names are kept, never merged.** The committed export contains
`Fireplace > Damper Doors > Damper Inoperable` **twice**, with different body text
and different `Order` values. They are two real comments that happen to share a
name. There is deliberately no unique constraint on `(item_id, name)`; the
duplicate is flagged as `DUPLICATE_COMMENT_NAME` so the inspector can decide.
De-duplicating would have destroyed customer content.

**No LLM in the import path.** The export is a well-specified grid, so a
deterministic parser is faithful, reproducible, instant, free, and testable. A
model here could invent sections or drop rows — exactly the failure the brief
warns about — and every guard against that would still be deterministic code.
The effort went into the preservation harness instead. AI tooling was used
heavily to *write* this project; none runs inside it.

**Unknown columns are preserved, not dropped.** A column the importer does not
recognise is stored per-comment in `comments.extra`, shown in the editor, and
reported as `UNKNOWN_COLUMN`. A future export with a new column loses nothing.

**Copies are deep clones.** Every section, item and comment is re-inserted with
fresh ids. No shared rows, no copy-on-write, no parent fallback — so the copy
cannot be affected by edits to the original, and this is asserted by a test.

---

## The improvement I chose: make the import trustworthy

Of the three suggested directions, I chose **making the import easier to trust**.

The customer's fear is not "will this app work" — it is *"will my four years of
work arrive intact, and would I even notice if it didn't?"* A silent 3% content
loss is far more damaging than a loud failure, because it is discovered months
later in front of a client.

So the app never reports a bare "success":

1. Every import writes an **import report** (`import_runs` + `import_issues`)
   with row counts, column mapping, and every decision the importer made.
2. Issues are **codes with severities**, grouped and linked to source row
   numbers, so a specific comment can be found in the spreadsheet.
3. The report distinguishes *missing from your export* from *not supported here*.
4. `scripts/verify-import.ts` proves preservation against the source file
   independently, so the claim is checkable rather than asserted.

---

## How I checked the work

Three harnesses, all exiting non-zero on failure (`npm test` runs the first two).

### `npm run verify` — preservation

Re-reads the spreadsheet with an **independent reader** and compares against the
importer's output row by row. All 12 checks pass on the committed export:

```
SOURCE   non-blank data rows: 392
IMPORTED sections=13 items=69 comments=392

PASS  every non-blank source row produced exactly one comment
PASS  no source row was dropped
PASS  no comment was invented
PASS  section names and order match source first-appearance order
PASS  item names and order match source order within every section
PASS  comments appear in source row order within each item
PASS  comment positions are contiguous from 0 within each item
PASS  every comment name preserved verbatim
PASS  every comment's visible text preserved word-for-word
PASS  all hyperlinks preserved
PASS  every distinct link URL survived
PASS  duplicate comment names kept as separate comments (1 case(s))

RESULT: all preservation checks passed.
```

### `npm run verify:failures` — failure cases and robustness

Rejections are specific, and variants of the format still import:

```
PASS  a PDF/binary that is not a spreadsheet          -> HEADER_NOT_FOUND
PASS  an empty file                                   -> EMPTY_FILE
PASS  a spreadsheet with completely unrelated headers -> HEADER_NOT_FOUND
PASS  a Spectora-ish export missing Comment Name      -> MISSING_REQUIRED_COLUMN
PASS  headers present but zero data rows              -> NO_DATA_ROWS

PASS  reordered columns still map correctly
PASS  an unrecognised extra column is preserved, not dropped
PASS  a title row above the header is skipped
PASS  CSV variant of the same export shape
PASS  plain text containing "<" is escaped, not parsed as a tag
```

**The failure case to demo:** upload any PDF or unrelated spreadsheet. The app
rejects it with *"This does not look like a Spectora template export…"*, lists
the diagnostic code, and writes **nothing** to the database. A partially-written
template is never left behind — `saveImportedTemplate` deletes the template row
on any downstream error, and the cascade removes its children.

### `npm run verify:copy` — copy independence

Imports a fixture, duplicates it, edits the section name, item name and a comment
body **in the copy**, then asserts the original is structurally identical to its
pre-copy fingerprint and shares no row ids. Cleans up after itself.

---

## What I cut, and why

| Cut | Why |
|---|---|
| **Auth / multi-tenancy** | The brief says reviewers should open a live URL and explore. Accounts add real time and protect nothing here — there is no customer data. RLS is on with no permissive policies; all writes use the service role key server-side |
| **Reordering / adding / deleting sections, items, comments** | The brief's baseline is *editing names and comment text*. Structural editing needs drag-and-drop, position rebalancing and undo to be safe on a 392-comment template. Renaming and rewriting were done properly instead |
| **Export back to Spectora format** | Out of scope. Migration is one-way for this customer |
| **A full WYSIWYG editor (TipTap/ProseMirror)** | A deliberately small toolbar (bold, italic, lists, links) keeps everything an inspector can produce inside the importer's sanitisation policy. A full editor would let users create markup the import path would have rejected. Uses `document.execCommand`, which is deprecated but universally supported and zero-dependency — a real product should move to ProseMirror |
| **Optimistic UI / autosave-while-typing** | Saves on blur with an explicit Saving/Saved indicator. Simpler and easier to trust than silent background writes |
| **Undo / version history** | Genuinely valuable for this customer, and the single thing I would build next. Needs a revisions table and real UI |
| **Photo import** | The committed export contains no photo data at all (all 20 photo columns are empty). The columns are mapped, so a populated export would carry them into `default_photos` |

---

## Known limitations

- Option lists containing a literal comma are split incorrectly (source format is ambiguous).
- Legacy BIFF `.xls` is rejected, not converted.
- `document.execCommand` is deprecated; the rich-text field should move to ProseMirror.
- No pagination — a very large template (thousands of comments) renders in one page. Sections are collapsed by default and a search filter is provided, but this would need virtualisation.
- The import runs in a single server action; a multi-megabyte export would be better handled as a background job.
- No concurrent-edit protection. Two people editing the same comment will last-write-win.

---

## Time spent

Approximately **two focused days**, roughly:

| | |
|---|---|
| Product exploration (Spectora export, Hive trial) | TODO(you) — adjust to your actual time |
| Format analysis and schema design | ~2h |
| Importer, sanitisation, column resolution | ~4h |
| Persistence, server actions, copy | ~3h |
| UI (library, editor, import report) | ~4h |
| Verification harnesses | ~2h |
| Docs, deployment, walkthrough | ~2h |

---

## Credits

Built from scratch — no starter template or scaffold generator.

| Dependency | Used for |
|---|---|
| [Next.js](https://nextjs.org) 15 + React 19 | App Router, Server Actions |
| [Supabase](https://supabase.com) | Postgres + client |
| [ExcelJS](https://github.com/exceljs/exceljs) | `.xlsx` reading |
| [PapaParse](https://www.papaparse.com/) | `.csv`/`.tsv` reading |
| [sanitize-html](https://github.com/apostrophecms/sanitize-html) | Comment rich-text policy |
| [Tailwind CSS](https://tailwindcss.com) 4 | Styling |

**AI tooling:** built with Claude (Claude Code). It was used for format analysis
of the export, schema and parser design, UI scaffolding, and the verification
harnesses. Every design decision recorded above — ordering, duplicates, the
no-LLM-at-runtime choice, the sanitisation policy — was reviewed and validated
against the real file rather than accepted on trust. No AI runs inside the
product.

---

## Links

- **Live URL:** TODO(you)
- **Walkthrough video:** TODO(you)
- **Hive / Binsr product feedback:** TODO(you) — capture notes while running your
  trial inspection so section 7 of the video is specific.
