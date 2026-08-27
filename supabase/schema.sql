-- EnPlanIt — Comprehensive Supabase Database Schema
-- Built for AI Builders Challenge (IBM Bob)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Profiles Table
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


-- 2. Missions Table
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


-- 3. Scenario Runs Table
CREATE TABLE IF NOT EXISTS scenario_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     UUID        NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  auth0_sub      TEXT        NOT NULL,
  variables      JSONB       NOT NULL,
  results        JSONB       NOT NULL,
  insights       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scenario_runs_mission_id_idx ON scenario_runs(mission_id);
CREATE INDEX IF NOT EXISTS scenario_runs_auth0_sub_idx ON scenario_runs(auth0_sub);


-- 4. Mission Documents Table (Storage Metadata)
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


-- 5. Document Chunks Table
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


-- 6. Document Facts Table (Telemetry & Parameter Extractions)
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
CREATE INDEX IF NOT EXISTS document_facts_auth0_sub_idx ON document_facts(auth0_sub);
