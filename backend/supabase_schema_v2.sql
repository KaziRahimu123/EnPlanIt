-- =============================================================================
-- EnPlanIt Database Schema v2 (Strict RLS & Tenant Isolation)
-- =============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub      TEXT        UNIQUE,
  email          TEXT,
  name           TEXT,
  role           TEXT        CHECK (role IN ('mission_controller', 'risk_analyst')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can manage own profile" ON profiles;
CREATE POLICY "Users can manage own profile" ON profiles
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS missions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub               TEXT,
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

ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own missions" ON missions;
CREATE POLICY "Users can manage own missions" ON missions
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS mission_analyses (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id              UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub               TEXT,
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

ALTER TABLE mission_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own analyses" ON mission_analyses;
CREATE POLICY "Users can manage own analyses" ON mission_analyses
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS scenario_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id      UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub       TEXT,
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

ALTER TABLE scenario_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own scenario runs" ON scenario_runs;
CREATE POLICY "Users can manage own scenario runs" ON scenario_runs
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS mission_documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub      TEXT,
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

ALTER TABLE mission_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own documents" ON mission_documents;
CREATE POLICY "Users can manage own documents" ON mission_documents
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS document_chunks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID        NOT NULL REFERENCES mission_documents(id) ON DELETE CASCADE,
  mission_id   UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub    TEXT,
  chunk_index  INTEGER     NOT NULL,
  page_number  INTEGER,
  text         TEXT        NOT NULL,
  word_count   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own chunks" ON document_chunks;
CREATE POLICY "Users can manage own chunks" ON document_chunks
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

CREATE TABLE IF NOT EXISTS document_facts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  document_id    UUID        REFERENCES mission_documents(id) ON DELETE SET NULL,
  auth0_sub      TEXT,
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

ALTER TABLE document_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own facts" ON document_facts;
CREATE POLICY "Users can manage own facts" ON document_facts
  FOR ALL
  TO authenticated
  USING (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'))
  WITH CHECK (auth0_sub IS NOT NULL AND auth0_sub = (auth.jwt() ->> 'sub'));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;
