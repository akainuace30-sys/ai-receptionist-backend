CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  case_type TEXT,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intakes (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  consent_given BOOLEAN DEFAULT FALSE,
  name TEXT,
  phone TEXT,
  email TEXT,
  case_type TEXT,
  summary TEXT,
  urgency TEXT,
  missing_fields JSON,
  confidence JSON,
  data JSONB,
  submitted_to_make BOOLEAN DEFAULT FALSE,
  submitted_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION touch_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_touch_updated_at ON sessions;
CREATE TRIGGER sessions_touch_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE PROCEDURE touch_session_updated_at();
