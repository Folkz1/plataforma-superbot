-- ============================================================
-- 012: Pipeline de Vendas - Schema completo
-- Papéis, etapas customizáveis, atribuições, handoffs
-- REVERSIVEL:
--   DROP TABLE handoff_history CASCADE;
--   DROP TABLE conversation_assignments CASCADE;
--   DROP TABLE pipeline_stages CASCADE;
--   DROP TABLE sales_team_members CASCADE;
-- ============================================================

-- Membros da equipe de vendas/atendimento
CREATE TABLE IF NOT EXISTS sales_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'vendedor',  -- 'vendedor', 'gerente', 'admin'
    max_concurrent_conversations INT DEFAULT 10,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_stm_project ON sales_team_members (project_id);
CREATE INDEX IF NOT EXISTS idx_stm_user ON sales_team_members (user_id);

-- Etapas customizáveis do pipeline por projeto
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    color TEXT DEFAULT '#6366f1',
    auto_assign BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_ps_project ON pipeline_stages (project_id, position);

-- Atribuição de conversas a vendedores
CREATE TABLE IF NOT EXISTS conversation_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    assigned_to UUID REFERENCES sales_team_members(id),
    assigned_by UUID REFERENCES dashboard_users(id),
    pipeline_stage_id UUID REFERENCES pipeline_stages(id),
    status TEXT DEFAULT 'active',  -- 'active', 'completed', 'reassigned'
    notes TEXT,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_active_unique
    ON conversation_assignments (project_id, conversation_id, channel_type)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ca_project ON conversation_assignments (project_id, status);
CREATE INDEX IF NOT EXISTS idx_ca_assigned ON conversation_assignments (assigned_to, status);
CREATE INDEX IF NOT EXISTS idx_ca_stage ON conversation_assignments (pipeline_stage_id);

-- Histórico de handoffs (bot -> vendedor -> gerente, etc)
CREATE TABLE IF NOT EXISTS handoff_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    from_type TEXT NOT NULL,  -- 'bot', 'vendedor', 'gerente', 'pool'
    from_id UUID,
    to_type TEXT NOT NULL,    -- 'bot', 'vendedor', 'gerente', 'pool'
    to_id UUID,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hh_project ON handoff_history (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hh_conversation ON handoff_history (project_id, conversation_id);

-- Seed default pipeline stages para projetos existentes
-- (executar manualmente por projeto se necessário)
-- INSERT INTO pipeline_stages (project_id, name, slug, position, color) VALUES
--   ('PROJECT_UUID', 'Novo Lead', 'novo', 0, '#6366f1'),
--   ('PROJECT_UUID', 'Qualificado', 'qualificado', 1, '#8b5cf6'),
--   ('PROJECT_UUID', 'Proposta', 'proposta', 2, '#f59e0b'),
--   ('PROJECT_UUID', 'Negociação', 'negociacao', 3, '#3b82f6'),
--   ('PROJECT_UUID', 'Fechado', 'fechado', 4, '#10b981'),
--   ('PROJECT_UUID', 'Perdido', 'perdido', 5, '#ef4444');
