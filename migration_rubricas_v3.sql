-- ==============================================================
-- MIGRATION: RUBRICAS - ESTRUTURA COMPLETA (BRIEFING BACKEND)
-- ==============================================================

-- 1. Garantir que a tabela existe com as colunas corretas
-- Se a tabela já existir, adicionamos apenas o que falta
CREATE TABLE IF NOT EXISTS public.rubricas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
    nome            TEXT NOT NULL,
    valor_aprovado  NUMERIC(12, 2) DEFAULT 0,
    valor_utilizado NUMERIC(12, 2) DEFAULT 0,
    quantidade      NUMERIC(12, 2) DEFAULT 0,
    valor_unitario  NUMERIC(12, 2) DEFAULT 0,
    etapa           TEXT,
    uf_municipio    TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    -- Constraint única: (project_id, nome)
    UNIQUE(project_id, nome)
);

-- Caso as colunas não existam em uma instalação prévia:
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS valor_aprovado NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS valor_utilizado NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS quantidade NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS valor_unitario NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS etapa TEXT;
ALTER TABLE public.rubricas ADD COLUMN IF NOT EXISTS uf_municipio TEXT;

-- Garantir RLS (Row Level Security)
ALTER TABLE public.rubricas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access rubricas of their projects" ON public.rubricas;
CREATE POLICY "Users can access rubricas of their projects" 
ON public.rubricas FOR ALL USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
);
