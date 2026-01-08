CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intakes (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  consent_given BOOLEAN DEFAULT FALSE,
  name TEXT,
  phone TEXT,
  email TEXT,
  jurisdiction TEXT,
  case_type TEXT,
  description TEXT,
  summary TEXT,
  urgency TEXT,
  lead_score NUMERIC,
  lead_tier TEXT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_tenant_id_idx ON sessions (tenant_id);
CREATE INDEX IF NOT EXISTS messages_tenant_session_idx ON messages (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS intakes_tenant_id_idx ON intakes (tenant_id);
