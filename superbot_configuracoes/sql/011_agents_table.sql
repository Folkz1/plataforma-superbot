-- ============================================================
-- 011: Tabela de Agentes IA
-- Permite CRUD de agentes dinamicos vinculados a projetos.
-- REVERSIVEL: DROP TABLE agents CASCADE;
-- ============================================================

-- Agentes IA configuráveis por projeto
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    llm_model TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    first_message TEXT DEFAULT '',
    voice_id TEXT,
    send_audio BOOLEAN DEFAULT false,
    rag_store_id TEXT,
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Cada projeto tem no máximo 1 agente ativo por vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_active_per_project
    ON agents (project_id) WHERE is_active = true;

-- Index para busca por projeto
CREATE INDEX IF NOT EXISTS idx_agents_project_id ON agents (project_id);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agents_updated_at ON agents;
CREATE TRIGGER trg_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_agents_updated_at();
