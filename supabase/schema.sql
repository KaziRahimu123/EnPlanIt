-- =============================================================================
-- EnPlanIt — Complete Supabase Database Schema (Reconciled)
-- Built for AI Builders Challenge (Space Exploration)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profiles Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub      TEXT        UNIQUE,
  email          TEXT,
  name           TEXT,
  role           TEXT        CHECK (role IN ('mission_controller', 'risk_analyst')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'user_id') THEN
    UPDATE profiles SET auth0_sub = user_id WHERE auth0_sub IS NULL;
  END IF;
END $$;

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
-- 2. Missions Table
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE missions ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS mission_type TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS duration TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS power_source TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS known_resources TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS mission_summary TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS objectives TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS required_resources TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS major_constraints TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS planning_considerations TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS missing_information TEXT;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE missions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'missions' AND column_name = 'user_id') THEN
    UPDATE missions SET auth0_sub = user_id WHERE auth0_sub IS NULL;
  END IF;
END $$;

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
-- 3. Mission Analyses Table
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS mission_summary TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS objectives TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS required_resources TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS major_constraints TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS planning_considerations TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS missing_information TEXT;
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE mission_analyses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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
-- 4. Scenario Runs Table
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS before_vars JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS after_vars JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS concerns_before JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS concerns_after JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS changes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS insights JSONB;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS variables JSONB;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS results JSONB;
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE scenario_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'scenario_runs' AND column_name = 'user_id') THEN
    UPDATE scenario_runs SET auth0_sub = user_id WHERE auth0_sub IS NULL;
  END IF;
END $$;

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
-- 5. Mission Documents Table
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'uploaded';
ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS page_count INTEGER;
ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS word_count INTEGER;
ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE mission_documents ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'mission_documents' AND column_name = 'user_id') THEN
    UPDATE mission_documents SET auth0_sub = user_id WHERE auth0_sub IS NULL;
  END IF;
END $$;

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
  auth0_sub    TEXT,
  chunk_index  INTEGER     NOT NULL,
  page_number  INTEGER,
  text         TEXT        NOT NULL,
  word_count   INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS page_number INTEGER;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS text TEXT;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS word_count INTEGER;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_chunks' AND column_name = 'user_id') THEN
    UPDATE document_chunks SET auth0_sub = user_id WHERE auth0_sub IS NULL;
  END IF;
END $$;

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
-- 7. Document Facts Table
-- ─────────────────────────────────────────────────────────────────────────────
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

ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS auth0_sub TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS field_key TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS value TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS numeric_value FLOAT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'extracted';
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS source_text TEXT;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS page_number INTEGER;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS chunk_index INTEGER;
ALTER TABLE document_facts ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'document_facts' AND column_name = 'user_id') THEN
    UPDATE document_facts SET auth0_sub = user_id WHERE auth0_sub IS NULL;
  END IF;
END $$;

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
