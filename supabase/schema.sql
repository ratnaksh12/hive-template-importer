-- Hive Template Importer — schema
--
-- Design notes
--  * The template is stored STRUCTURALLY: template -> section -> item -> comment.
--    Only the body of an individual comment holds HTML. There is no opaque
--    whole-template blob anywhere in this schema.
--  * `position` is the authoritative ordering everywhere and is assigned from the
--    order rows appear in the source sheet. The Spectora "Order (w/i item)" column
--    is preserved separately as `spectora_order` because it is NOT unique — in the
--    committed InterNACHI export 38 items reuse Order values within the same item,
--    so it cannot be trusted as a sort key.
--  * `extra` captures any source column the importer does not have a first-class
--    home for, so an unrecognised column in a future export is preserved rather
--    than silently dropped.
--  * Import issues are recorded, never swallowed: see import_runs / import_issues.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
create table if not exists templates (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  -- 'import' = created by parsing an export; 'copy' = duplicated from another template.
  origin          text        not null default 'import'
                              check (origin in ('import', 'copy')),
  -- Provenance only. A copy is a deep, fully independent clone; this column is a
  -- breadcrumb for the UI and never causes reads to fall through to the parent.
  copied_from_id  uuid        references templates (id) on delete set null,
  source_filename text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Sections
-- ---------------------------------------------------------------------------
create table if not exists sections (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid        not null references templates (id) on delete cascade,
  name        text        not null,
  position    integer     not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists sections_template_idx on sections (template_id, position);

-- ---------------------------------------------------------------------------
-- Items (a named group of comments inside a section)
-- ---------------------------------------------------------------------------
create table if not exists items (
  id         uuid primary key default gen_random_uuid(),
  section_id uuid        not null references sections (id) on delete cascade,
  name       text        not null,
  position   integer     not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_section_idx on items (section_id, position);

-- ---------------------------------------------------------------------------
-- Comments (the leaf: one source row == one comment)
-- ---------------------------------------------------------------------------
-- NOTE: deliberately NO unique constraint on (item_id, name). The committed
-- export contains a legitimate exact duplicate
-- ("Fireplace > Damper Doors > Damper Inoperable" twice). Both rows are kept and
-- flagged as a warning rather than being merged away.
create table if not exists comments (
  id                 uuid primary key default gen_random_uuid(),
  item_id            uuid        not null references items (id) on delete cascade,
  name               text        not null,
  -- Sanitised HTML fragment. Plain-text source rows are stored as plain text.
  body_html          text        not null default '',

  comment_type       text,  -- info | limit | defect (free text; unknown values preserved)
  category           text,  -- -1 Low | 0 Med | 1 High
  recommendation     text,
  answer_type        text,  -- boolean | checkbox | date | number | range | text

  multiple_choice_options text[] not null default '{}',
  unit_type_options       text[] not null default '{}',

  default_value      text,
  default_value_2    text,
  default_unit_type  text,
  default_location   text,
  estimate_min       text,
  estimate_max       text,
  locked             text,
  simple_format      text,
  disable_photos     text,
  uses               text,
  last_modified      text,

  -- [{ url, caption }] preserved in source order.
  default_photos     jsonb       not null default '[]'::jsonb,
  -- Any source column without a first-class column above.
  extra              jsonb       not null default '{}'::jsonb,

  spectora_order     integer,
  source_row         integer,     -- 1-based row number in the source sheet
  position           integer     not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists comments_item_idx on comments (item_id, position);

-- ---------------------------------------------------------------------------
-- Import runs + issues (make skipped/unsupported content visible)
-- ---------------------------------------------------------------------------
create table if not exists import_runs (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid        references templates (id) on delete cascade,
  source_filename text,
  sheet_name      text,
  -- Row/entity counts and the resolved header mapping, for the import report.
  stats           jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create table if not exists import_issues (
  id            uuid primary key default gen_random_uuid(),
  import_run_id uuid        not null references import_runs (id) on delete cascade,
  severity      text        not null check (severity in ('info', 'warning', 'error')),
  code          text        not null,
  message       text        not null,
  source_row    integer,
  column_name   text,
  raw_value     text,
  created_at    timestamptz not null default now()
);
create index if not exists import_issues_run_idx on import_issues (import_run_id, severity);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array['templates', 'sections', 'items', 'comments'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- This demo ships without auth (see NOTES.md). All writes go through server-side
-- code using the service role key, which bypasses RLS. RLS is enabled with no
-- permissive policies so that the public anon key cannot read or write directly.
alter table templates     enable row level security;
alter table sections      enable row level security;
alter table items         enable row level security;
alter table comments      enable row level security;
alter table import_runs   enable row level security;
alter table import_issues enable row level security;
