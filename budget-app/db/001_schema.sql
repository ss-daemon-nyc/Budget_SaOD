-- FY26 Budget Reporting — core schema
--
-- This file runs unchanged against a local Postgres (the demo) and against
-- Supabase (production). The only Supabase-specific piece is the reference
-- to auth.users in `profiles`, which is guarded below so the demo can run
-- without the Supabase auth schema present.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Access grants. A row here is what makes someone able to see anything.
-- On Supabase, id references auth.users(id).
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  full_name  text,
  role       text not null default 'viewer'
             check (role in ('viewer', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- One row per uploaded workbook. Immutable once published.
-- ---------------------------------------------------------------------------
create table if not exists snapshots (
  id              uuid primary key default gen_random_uuid(),
  fiscal_year     int  not null,
  as_of_date      date not null,
  period_label    text not null,
  source_filename text not null,
  storage_path    text,
  file_sha256     text not null unique,
  row_count       int,
  status          text not null default 'parsing'
                  check (status in ('parsing','review','published','failed','archived')),
  parse_error     text,
  uploaded_by     uuid references profiles(id),
  uploaded_at     timestamptz not null default now(),
  published_at    timestamptz,
  unique (fiscal_year, as_of_date)
);

-- ---------------------------------------------------------------------------
-- Raw journal lines, exactly as exported. Never edited, never deduplicated.
-- ---------------------------------------------------------------------------
create table if not exists ledger_lines (
  id                  bigserial primary key,
  snapshot_id         uuid not null references snapshots(id) on delete cascade,
  account_code        text not null,
  account_description text not null,
  fund                text,
  org                 text,
  program             text,
  project             text,
  accounting_period   text,
  fiscal_year         int,
  vendor              text,
  journal_date        date,
  journal_id          text,
  line_description    text,
  source              text,
  journal_ref         text,
  amount_posted_gl    numeric(14,2) not null default 0,
  revised_budget      numeric(14,2) not null default 0,
  encumbrance         numeric(14,2) not null default 0,
  pre_encumbrance     numeric(14,2) not null default 0,
  account_type        text,
  account_category    text
);
create index if not exists ledger_lines_snapshot_account_idx
  on ledger_lines (snapshot_id, account_code);
create index if not exists ledger_lines_snapshot_period_idx
  on ledger_lines (snapshot_id, accounting_period);

-- ---------------------------------------------------------------------------
-- Derived at parse time: one row per account per snapshot.
-- This is what the report pages read.
-- ---------------------------------------------------------------------------
create table if not exists account_totals (
  snapshot_id         uuid not null references snapshots(id) on delete cascade,
  account_code        text not null,
  account_description text not null,
  account_type        text not null,
  account_category    text not null,
  posted_gl           numeric(14,2) not null,
  encumbrance         numeric(14,2) not null,
  pre_encumbrance     numeric(14,2) not null,
  revised_budget      numeric(14,2) not null,
  committed numeric(14,2) generated always as (posted_gl + encumbrance) stored,
  available numeric(14,2) generated always as
            (revised_budget - posted_gl - encumbrance - pre_encumbrance) stored,
  primary key (snapshot_id, account_code)
);

-- ---------------------------------------------------------------------------
-- Derived: the monthly posting curve, split by category.
-- period_index exists because the fiscal year starts in September, so neither
-- alphabetical nor calendar ordering is correct.
-- ---------------------------------------------------------------------------
create table if not exists period_totals (
  snapshot_id       uuid not null references snapshots(id) on delete cascade,
  accounting_period text not null,
  period_index      int  not null,
  account_category  text not null,
  posted_gl         numeric(14,2) not null,
  primary key (snapshot_id, accounting_period, account_category)
);
