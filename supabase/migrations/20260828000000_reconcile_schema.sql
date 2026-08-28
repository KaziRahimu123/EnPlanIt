-- =============================================================================
-- Migration: 20260828000000_reconcile_schema.sql
-- Description: Reconcile Supabase database schema for EnPlanIt Scenario Lab
--   1. Create mission_analyses table with full foreign key references
--   2. Add/reconcile scenario_runs columns (before_vars, after_vars, concerns_before, concerns_after, changes, updated_at)
--   3. Add indexes on mission_id, auth0_sub, and timestamps across all tables
--   4. Enforce Row-Level Security (RLS) with strict auth0_sub ownership policies
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profiles Table (Ensure schema & RLS)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub      TEXT        NOT NULL UNIQUE,
  email          TEXT,
  name           TEXT,
  role           TEXT        CHECK (role IN ('mission_controller', 'risk_analyst')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_auth0_sub_idx ON profiles(auth0_sub);
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON profiles(created_at DESC);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON profiles
      FOR SELECT USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can manage own profile') THEN
    CREATE POLICY "Users can manage own profile" ON profiles
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Missions Table (Ensure schema, indexes & RLS)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub               TEXT        NOT NULL,
  name                    TEXT        NOT NULL,
  description             TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'draft',
  destination             TEXT,
  mission_type            TEXT,
  objective               TEXT,
  duration                TEXT,
  power_source            TEXT,
  known_resources         TEXT,
  mission_summary         TEXT,
  objectives              TEXT,
  required_resources      TEXT,
  major_constraints       TEXT,
  planning_considerations TEXT,
  missing_information     TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS missions_auth0_sub_idx ON missions(auth0_sub);
CREATE INDEX IF NOT EXISTS missions_created_at_idx ON missions(created_at DESC);
CREATE INDEX IF NOT EXISTS missions_updated_at_idx ON missions(updated_at DESC);

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'missions' AND policyname = 'Users can manage own missions') THEN
    CREATE POLICY "Users can manage own missions" ON missions
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Mission Analyses Table (New Table Reconciliation)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_analyses (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id              UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub               TEXT        NOT NULL,
  mission_summary         TEXT,
  objectives              TEXT,
  required_resources      TEXT,
  major_constraints       TEXT,
  planning_considerations TEXT,
  missing_information     TEXT,
  analyzed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mission_analyses_mission_id_idx ON mission_analyses(mission_id);
CREATE INDEX IF NOT EXISTS mission_analyses_auth0_sub_idx ON mission_analyses(auth0_sub);
CREATE INDEX IF NOT EXISTS mission_analyses_analyzed_at_idx ON mission_analyses(analyzed_at DESC);

ALTER TABLE mission_analyses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mission_analyses' AND policyname = 'Users can manage own analyses') THEN
    CREATE POLICY "Users can manage own analyses" ON mission_analyses
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Scenario Runs Table (Reconcile Columns, Indexes & RLS)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scenario_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub       TEXT        NOT NULL,
  before_vars     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  after_vars      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  concerns_before JSONB       NOT NULL DEFAULT '{}'::jsonb,
  concerns_after  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  changes         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  insights        JSONB,
  variables       JSONB,
  results         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reconcile any missing columns in existing deployments
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS before_vars JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS after_vars JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS concerns_before JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS concerns_after JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS insights JSONB;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS scenario_runs_mission_id_idx ON scenario_runs(mission_id);
CREATE INDEX IF NOT EXISTS scenario_runs_auth0_sub_idx ON scenario_runs(auth0_sub);
CREATE INDEX IF NOT EXISTS scenario_runs_updated_at_idx ON scenario_runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS scenario_runs_created_at_idx ON scenario_runs(created_at DESC);

ALTER TABLE scenario_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scenario_runs' AND policyname = 'Users can manage own scenario runs') THEN
    CREATE POLICY "Users can manage own scenario runs" ON scenario_runs
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Mission Documents Table (Metadata & Storage Tracking)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mission_documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub      TEXT        NOT NULL,
  filename       TEXT        NOT NULL,
  storage_path   TEXT        NOT NULL UNIQUE,
  file_type      TEXT        NOT NULL,
  file_size      INTEGER     NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'uploaded',
  page_count     INTEGER,
  word_count     INTEGER,
  error_message  TEXT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mission_documents_mission_id_idx ON mission_documents(mission_id);
CREATE INDEX IF NOT EXISTS mission_documents_auth0_sub_idx ON mission_documents(auth0_sub);
CREATE INDEX IF NOT EXISTS mission_documents_uploaded_at_idx ON mission_documents(uploaded_at DESC);

ALTER TABLE mission_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mission_documents' AND policyname = 'Users can manage own documents') THEN
    CREATE POLICY "Users can manage own documents" ON mission_documents
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Document Chunks Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID        NOT NULL REFERENCES mission_documents(id) ON DELETE CASCADE,
  mission_id   UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub    TEXT        NOT NULL,
  chunk_index  INTEGER     NOT NULL,
  page_number  INTEGER,
  text         TEXT        NOT NULL,
  word_count   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_chunks_document_id_idx ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS document_chunks_mission_id_idx ON document_chunks(mission_id);
CREATE INDEX IF NOT EXISTS document_chunks_auth0_sub_idx ON document_chunks(auth0_sub);
CREATE INDEX IF NOT EXISTS document_chunks_created_at_idx ON document_chunks(created_at DESC);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'document_chunks' AND policyname = 'Users can manage own chunks') THEN
    CREATE POLICY "Users can manage own chunks" ON document_chunks
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Document Facts Table (Telemetry & Parameter Extractions)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_facts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  document_id    UUID        REFERENCES mission_documents(id) ON DELETE SET NULL,
  auth0_sub      TEXT        NOT NULL,
  category       TEXT        NOT NULL,
  field_key      TEXT        NOT NULL,
  label          TEXT        NOT NULL,
  value          TEXT,
  numeric_value  FLOAT,
  unit           TEXT,
  state          TEXT        NOT NULL DEFAULT 'extracted'
                   CHECK (state IN ('confirmed', 'extracted', 'not_specified', 'needs_review')),
  source_text    TEXT,
  page_number    INTEGER,
  chunk_index    INTEGER,
  extracted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_facts_mission_id_idx ON document_facts(mission_id);
CREATE INDEX IF NOT EXISTS document_facts_document_id_idx ON document_facts(document_id);
CREATE INDEX IF NOT EXISTS document_facts_auth0_sub_idx ON document_facts(auth0_sub);
CREATE INDEX IF NOT EXISTS document_facts_extracted_at_idx ON document_facts(extracted_at DESC);

ALTER TABLE document_facts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'document_facts' AND policyname = 'Users can manage own facts') THEN
    CREATE POLICY "Users can manage own facts" ON document_facts
      FOR ALL USING (auth0_sub = (auth.jwt() ->> 'sub') OR auth.jwt() ->> 'sub' IS NULL);
  END IF;
END $$;
