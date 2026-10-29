-- Myntmore Lead Engine: Supabase schema (Step 1)
-- Design notes:
--  * Tool sources live in a lookup table (FK), not a hardcoded CHECK list.
--    Adding an 11th tool = one INSERT, no migration. (This avoids the Task 3a bug.)
--  * Rows are never deleted. Cleaning sets status + reason columns.
--  * Raw CSV values are kept untouched next to cleaned values for auditability.

create extension if not exists pgcrypto;

-- 1. Tools registry --------------------------------------------------------
create table if not exists tools (
  slug        text primary key,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into tools (slug, name) values
  ('roi_calculator','ROI Calculator'),
  ('icp_builder','ICP Builder'),
  ('profile_optimizer','LinkedIn Profile Optimizer'),
  ('dm_angle_generator','DM Angle Generator'),
  ('lead_magnet_ideas','Lead Magnet Ideas'),
  ('posting_rhythm_builder','Posting Rhythm Builder'),
  ('founder_presence_analyzer','Founder Presence Analyzer'),
  ('battle_card','Battle Card'),
  ('case_study','Case Study'),
  ('hook_grader','LinkedIn Hook Grader')
on conflict (slug) do nothing;

-- Raw names that arrive from forms/CSV, mapped to a canonical tool.
-- leads.csv uses 'battle_card_generator' and 'case_study_generator'.
create table if not exists tool_aliases (
  alias      text primary key,
  tool_slug  text not null references tools(slug)
);
insert into tool_aliases (alias, tool_slug)
select slug, slug from tools on conflict do nothing;
insert into tool_aliases (alias, tool_slug) values
  ('battle_card_generator','battle_card'),
  ('case_study_generator','case_study')
on conflict do nothing;

-- 2. Enums -----------------------------------------------------------------
do $$ begin
  create type clean_status as enum ('pending','clean','duplicate','test_entry','invalid','non_buyer','competitor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_tier as enum ('hot','warm','not_a_fit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type process_status as enum ('new','processing','done','error');
exception when duplicate_object then null; end $$;

-- 3. Leads (one row = one tool session) -------------------------------------
create table if not exists leads (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  origin             text not null default 'csv_import',  -- csv_import | hook_grader | webhook
  source_row_number  int,                                  -- row in leads.csv, for traceability

  -- raw, exactly as received
  raw_payload        jsonb not null default '{}'::jsonb,

  external_lead_id   text unique,          -- L01..L20 from the CSV
  session_at         timestamptz,          -- created_at from the source form
  source_tool_raw    text not null,        -- stored as received, never rejected

  -- cleaned contact fields
  tool_slug          text references tools(slug),  -- null = unknown tool, flagged
  first_name         text,
  last_name          text,
  name               text,
  linkedin_url       text,
  account_domain     text,                 -- groups people from the same company (L02 + L15)
  flags              text[] not null default '{}',  -- e.g. incomplete_session, no_email, suspicious_input
  email              text,
  email_normalized   text generated always as (lower(trim(email))) stored,
  designation        text,
  company            text,
  company_website    text,

  -- what they typed / what the tool returned
  tool_input         jsonb,
  tool_output        jsonb,

  -- cleaning
  clean_status       clean_status not null default 'pending',
  clean_reason       text,                 -- required when status <> clean
  duplicate_of       uuid references leads(id),

  -- scoring (rules + Gemini, kept separate on purpose)
  rule_score         int check (rule_score between 0 and 10),
  rule_breakdown     jsonb,                -- which rules fired
  ai_score           int check (ai_score between 1 and 10),
  ai_reason          text,
  final_score        int check (final_score between 1 and 10),
  score_reason       text,                 -- the one-line reason
  matched_service    text check (matched_service in
                       ('personal_branding','linkedin_outreach','cold_email','lead_generation','none')),

  -- routing + output
  tier               lead_tier,
  not_fit_reason     text,
  email_subject      text,
  email_body         text,
  email_word_count   int,
  email_checks       jsonb,                -- results of no-em-dash / word-limit / link checks
  alert_sent_at      timestamptz,
  crm_synced_at      timestamptz,

  -- enrichment (bonus)
  enrichment         jsonb,

  -- pipeline health: failures are visible, not just logged
  process_status     process_status not null default 'new',
  last_error         text,
  attempts           int not null default 0,

  constraint reason_required check (
    clean_status in ('pending','clean') or clean_reason is not null
  ),
  constraint not_fit_needs_reason check (
    tier is distinct from 'not_a_fit' or not_fit_reason is not null
  )
);

create index if not exists leads_email_idx  on leads (email_normalized);
create index if not exists leads_status_idx on leads (process_status);
create index if not exists leads_tier_idx   on leads (tier);

-- 4. Hook Grader sessions (Task 02) ----------------------------------------
create table if not exists hook_sessions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  lead_id         uuid references leads(id),
  name            text not null,
  designation     text,
  email           text not null,
  hook_text       text not null,
  rule_score      int not null check (rule_score between 0 and 100),
  rule_results    jsonb not null,        -- per-rule pass/fail + one-line message
  rewrites        jsonb,                 -- 3 Gemini rewrites
  ai_error        text,                  -- set if Gemini failed (score still saved)
  webhook_status  text default 'pending',-- pending | sent | failed
  webhook_error   text
);

-- 5. Error log: every failed step lands here --------------------------------
create table if not exists pipeline_errors (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  stage       text not null,     -- insert | clean | score | email | route | crm | webhook
  lead_id     uuid,
  payload     jsonb,
  error       text not null
);

-- 6. updated_at trigger ------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at before update on leads
  for each row execute function set_updated_at();

-- 7. Security: lock tables down; server code uses the service role key ------
alter table leads           enable row level security;
alter table hook_sessions   enable row level security;
alter table pipeline_errors enable row level security;
alter table tools           enable row level security;
alter table tool_aliases    enable row level security;
create policy "tools readable" on tools for select using (true);
-- No anon insert policies: the Next.js API route writes with the
-- service role key from a server-side env var, never from the browser.

-- 8. Ops view: what needs attention ------------------------------------------
create or replace view leads_needing_attention with (security_invoker = true) as
select id, name, email, tool_slug, process_status, last_error, attempts
from leads
where process_status = 'error'
   or (clean_status = 'clean' and tier is null and created_at < now() - interval '15 minutes');
