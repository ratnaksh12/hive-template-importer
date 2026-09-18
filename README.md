# Spectora → Hive template importer

Import a Spectora **HTML-text spreadsheet export** into a structured, editable
schema, edit it, duplicate it, and keep every change in a real database.

**Live app: https://hive-template-importer-smoky.vercel.app**
— opens on the seeded InterNACHI Residential template. No login required.

Built for the Hive Inspect Forward Deployed Engineer exercise. The customer is an
inspection company leaving Spectora with a template they have tuned for four
years — so **preserving their work matters more than originality**.

---

## The committed export

| | |
|---|---|
| File | [`InterNACHI Residential -2026-09-16.xls`](./InterNACHI%20Residential%20-2026-09-16.xls) |
| Source | Spectora → *Export to spreadsheet → Export HTML Text* |
| Template | **InterNACHI Residential** (a stock Spectora template, no customer data) |
| Actual format | OOXML `.xlsx` despite the `.xls` extension — the importer sniffs the magic bytes rather than trusting the extension |
| Shape | 1 sheet, 393 rows (1 header + 392 data), 42 columns |
| Imports to | 13 sections · 69 items · 392 comments · 43 links |

---

## Stack

- **Next.js 15** (App Router, Server Actions) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- **Supabase** (Postgres) for persistence
- **ExcelJS** for `.xlsx`, **PapaParse** for `.csv`/`.tsv`
- **sanitize-html** for the comment rich-text policy

Scaffolded by hand (no starter template). Third-party code is limited to the
libraries above.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the database

Create a free project at [supabase.com](https://supabase.com/dashboard), then open
**SQL Editor** and run the contents of [`supabase/schema.sql`](./supabase/schema.sql).

It creates `templates`, `sections`, `items`, `comments`, `import_runs` and
`import_issues`, plus `updated_at` triggers. It is idempotent — safe to re-run.

### 3. Environment variables

```bash
cp .env.example .env.local
```

Fill in from **Supabase → Project Settings → API**:

| Variable | Where to find it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | e.g. `https://abc.supabase.co` |
| `SUPABASE_SECRET_KEY` | **API Keys → secret** (`sb_secret_…`, formerly `service_role`) | **Server-only.** Never prefix with `NEXT_PUBLIC_`. `SUPABASE_SERVICE_ROLE_KEY` is also accepted |

The **publishable** key (`sb_publishable_…`, formerly `anon`) will not work: RLS
is enabled on every table with no permissive policies, so it cannot read or write
any row. The app detects that key and fails with an explicit message rather than
appearing to have an empty database. All access goes through server actions using
the secret key. `.env.local` is gitignored; no credentials are in this repo.

### 4. Run

```bash
npm run dev
```

Open <http://localhost:3000> and import the committed `.xls` file.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run seed` | Import the committed export into the database (`-- --force` to re-import) |
| `npm run verify` | **Preservation harness** — re-reads the spreadsheet independently and asserts nothing was dropped, reordered or reworded |
| `npm run verify:failures` | **Failure + robustness harness** — asserts bad input is rejected clearly and that variant exports still import |
| `npm run verify:roundtrip` | **Database round-trip** — asserts the stored template matches the source file field by field |
| `npm run verify:copy` | **Copy independence** — asserts edits to a duplicate never touch the original |
| `npm test` | `typecheck` + `verify` + `verify:failures` (no database needed) |

Every harness exits non-zero on failure, so they all work in CI. `verify:roundtrip`
and `verify:copy` need `.env.local`; the rest run offline.

### Verified against the committed export

```
verify             12/12  392 source rows -> 392 comments, 13 sections, 69 items
verify:failures    10/10  5 rejection cases + 5 format variants
verify:roundtrip   11/11  stored template matches the file byte-for-byte
verify:copy        10/10  edits to a copy leave the original untouched
```

### Verifying preservation

```bash
npx tsx scripts/verify-import.ts
```

This does not trust the importer's own bookkeeping. It opens the workbook a
second time with an independent reader and checks, row by row, that:

- every non-blank source row produced exactly one comment (none dropped, none invented)
- section and item names and order match source first-appearance order
- comments appear in source row order within every item
- every comment name is preserved verbatim
- every comment's **visible text matches word-for-word** after formatting is normalised
- every hyperlink and every distinct URL survived sanitisation
- duplicate comment names remain separate comments rather than being merged

---

## How rich content is handled

| Content | Behaviour |
|---|---|
| `<p>`, `<strong>`, `<em>`, lists, headings, tables | Preserved |
| `<a href>` | Preserved; `rel="noopener noreferrer"` and `target="_blank"` added. Only `http`, `https`, `mailto`, `tel` allowed |
| `class`, `style` and other presentational attributes | Removed, and reported as `STRIPPED_ATTRIBUTE`. Text and structure unchanged |
| Plain-text cells (111 of them) | HTML-escaped, never parsed — so `attic < 6 ft` stays literal |
| Non-breaking spaces, curly quotes | Preserved |
| Unrecognised columns | Preserved per-comment in `comments.extra` and reported as `UNKNOWN_COLUMN` |
| Empty media-embed wrappers | Text kept; reported as `EMBED_PLACEHOLDER_WITHOUT_SOURCE` |

Nothing is dropped silently. Every decision is written to `import_issues` and
shown in the in-app **Import report**.

See [NOTES.md](./NOTES.md) for limitations and what was deliberately cut.

---

## Deployment (Vercel)

1. Push to GitHub and import the repo in Vercel.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as
   Environment Variables (Production + Preview).
3. Deploy. No build-time database access is required.

---

## Data model

```
templates ──< sections ──< items ──< comments
     │
     └──< import_runs ──< import_issues
```

The template is stored **structurally**; only an individual comment body holds
HTML. There is no opaque whole-template blob.

`position` is the authoritative ordering everywhere, assigned from source sheet
order. Spectora's `Order (w/i item)` column is preserved as `spectora_order` but
is **not** used for sorting: in the committed export 38 items reuse Order values
within the same item, so it cannot be trusted as a sort key.

A **copy** is a deep clone — every section, item and comment is re-inserted with
fresh ids, so the copy shares no rows with the original and editing one can never
affect the other.
