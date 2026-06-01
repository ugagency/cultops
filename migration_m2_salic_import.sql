-- ============================================================================
-- M2 — Importação de Projeto via PDF do SALIC (OCR + IA)
-- ----------------------------------------------------------------------------
-- Substitui o fluxo n8n por processamento no server.js (endpoint
-- POST /api/m2/processar-pdf-salic). Este script cria:
--   1. project_salic_imports        -> controle do upload/OCR (status + json bruto)
--   2. project_etapas_trabalho       -> etapas do plano de trabalho
--   3. project_locais_realizacao     -> locais de realização
--   4. project_deslocamentos         -> deslocamentos
--   5. project_plano_divulgacao      -> plano de divulgação
--   6. project_dados_complementares  -> síntese/objetivos/produtos/ficha técnica
--
-- Padrão multi-tenant + RLS alinhado ao M1 (migration_m2_rls_align_m1.sql):
--   organization_id = public.current_user_org_id()  (lido do JWT)
--   O backend usa a service_role (bypassa RLS); o frontend lê via anon + RLS.
--
-- Idempotente: pode rodar mais de uma vez (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. project_salic_imports — controle do processamento
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_salic_imports (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL,
  file_path       text NOT NULL,
  status          text NOT NULL DEFAULT 'pendente'::text
                    CHECK (status = ANY (ARRAY['pendente'::text, 'processando'::text, 'processado'::text, 'erro'::text])),
  dados_extraidos jsonb,
  erro_mensagem   text,
  created_at      timestamp with time zone DEFAULT now(),
  updated_at      timestamp with time zone DEFAULT now(),
  CONSTRAINT project_salic_imports_pkey PRIMARY KEY (id),
  CONSTRAINT project_salic_imports_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_salic_imports_organization_id_fkey FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
);
CREATE INDEX IF NOT EXISTS idx_salic_imports_project ON public.project_salic_imports(project_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. project_etapas_trabalho
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_etapas_trabalho (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL,
  import_id       uuid,
  nome            text,
  duracao_meses   numeric,
  objetivo        text,
  atividades      jsonb DEFAULT '[]'::jsonb,
  ordem           integer,
  created_at      timestamp with time zone DEFAULT now(),
  CONSTRAINT project_etapas_trabalho_pkey PRIMARY KEY (id),
  CONSTRAINT project_etapas_trabalho_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_etapas_trabalho_import_id_fkey FOREIGN KEY (import_id)
    REFERENCES public.project_salic_imports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_etapas_project ON public.project_etapas_trabalho(project_id);
CREATE INDEX IF NOT EXISTS idx_etapas_import  ON public.project_etapas_trabalho(import_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. project_locais_realizacao
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_locais_realizacao (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL,
  import_id       uuid,
  pais            text,
  uf              text,
  cidade          text,
  created_at      timestamp with time zone DEFAULT now(),
  CONSTRAINT project_locais_realizacao_pkey PRIMARY KEY (id),
  CONSTRAINT project_locais_realizacao_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_locais_realizacao_import_id_fkey FOREIGN KEY (import_id)
    REFERENCES public.project_salic_imports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_locais_project ON public.project_locais_realizacao(project_id);
CREATE INDEX IF NOT EXISTS idx_locais_import  ON public.project_locais_realizacao(import_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. project_deslocamentos
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_deslocamentos (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL,
  import_id       uuid,
  origem_uf       text,
  origem_cidade   text,
  destino_uf      text,
  destino_cidade  text,
  quantidade      numeric,
  created_at      timestamp with time zone DEFAULT now(),
  CONSTRAINT project_deslocamentos_pkey PRIMARY KEY (id),
  CONSTRAINT project_deslocamentos_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_deslocamentos_import_id_fkey FOREIGN KEY (import_id)
    REFERENCES public.project_salic_imports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_desloc_project ON public.project_deslocamentos(project_id);
CREATE INDEX IF NOT EXISTS idx_desloc_import  ON public.project_deslocamentos(import_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. project_plano_divulgacao
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_plano_divulgacao (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid,
  project_id      uuid NOT NULL,
  import_id       uuid,
  tipo_midia      text,
  descricao       text,
  veiculo         text,
  quantidade      numeric,
  created_at      timestamp with time zone DEFAULT now(),
  CONSTRAINT project_plano_divulgacao_pkey PRIMARY KEY (id),
  CONSTRAINT project_plano_divulgacao_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_plano_divulgacao_import_id_fkey FOREIGN KEY (import_id)
    REFERENCES public.project_salic_imports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_divulg_project ON public.project_plano_divulgacao(project_id);
CREATE INDEX IF NOT EXISTS idx_divulg_import  ON public.project_plano_divulgacao(import_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. project_dados_complementares (1 linha por importação)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_dados_complementares (
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id       uuid,
  project_id            uuid NOT NULL,
  import_id             uuid,
  sintese               text,
  objetivo_geral        text,
  objetivos_especificos jsonb DEFAULT '[]'::jsonb,
  justificativa         text,
  periodo_inicio        date,
  periodo_fim           date,
  produtos              jsonb DEFAULT '[]'::jsonb,
  ficha_tecnica         jsonb DEFAULT '[]'::jsonb,
  created_at            timestamp with time zone DEFAULT now(),
  CONSTRAINT project_dados_complementares_pkey PRIMARY KEY (id),
  CONSTRAINT project_dados_complementares_project_id_fkey FOREIGN KEY (project_id)
    REFERENCES public.projects(id) ON DELETE CASCADE,
  CONSTRAINT project_dados_complementares_import_id_fkey FOREIGN KEY (import_id)
    REFERENCES public.project_salic_imports(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_complem_project ON public.project_dados_complementares(project_id);
CREATE INDEX IF NOT EXISTS idx_complem_import  ON public.project_dados_complementares(import_id);

-- ============================================================================
-- RLS — alinhado ao padrão M2 (organization_id = current_user_org_id()).
-- Tabelas com organization_id próprio filtram direto; as demais derivam pela
-- relação com projects (mesma estratégia de contract_parcelas).
-- ============================================================================

-- ─── project_salic_imports ───────────────────────────────────────────────
ALTER TABLE public.project_salic_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salic_imports_select" ON public.project_salic_imports;
DROP POLICY IF EXISTS "salic_imports_insert" ON public.project_salic_imports;
DROP POLICY IF EXISTS "salic_imports_update" ON public.project_salic_imports;
DROP POLICY IF EXISTS "salic_imports_delete" ON public.project_salic_imports;

CREATE POLICY "salic_imports_select" ON public.project_salic_imports
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "salic_imports_insert" ON public.project_salic_imports
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "salic_imports_update" ON public.project_salic_imports
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "salic_imports_delete" ON public.project_salic_imports
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));

-- ─── Helper macro replicado para cada tabela de destino ───────────────────
-- project_etapas_trabalho
ALTER TABLE public.project_etapas_trabalho ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "etapas_select" ON public.project_etapas_trabalho;
DROP POLICY IF EXISTS "etapas_insert" ON public.project_etapas_trabalho;
DROP POLICY IF EXISTS "etapas_update" ON public.project_etapas_trabalho;
DROP POLICY IF EXISTS "etapas_delete" ON public.project_etapas_trabalho;
CREATE POLICY "etapas_select" ON public.project_etapas_trabalho
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "etapas_insert" ON public.project_etapas_trabalho
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "etapas_update" ON public.project_etapas_trabalho
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "etapas_delete" ON public.project_etapas_trabalho
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));

-- project_locais_realizacao
ALTER TABLE public.project_locais_realizacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "locais_select" ON public.project_locais_realizacao;
DROP POLICY IF EXISTS "locais_insert" ON public.project_locais_realizacao;
DROP POLICY IF EXISTS "locais_update" ON public.project_locais_realizacao;
DROP POLICY IF EXISTS "locais_delete" ON public.project_locais_realizacao;
CREATE POLICY "locais_select" ON public.project_locais_realizacao
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "locais_insert" ON public.project_locais_realizacao
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "locais_update" ON public.project_locais_realizacao
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "locais_delete" ON public.project_locais_realizacao
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));

-- project_deslocamentos
ALTER TABLE public.project_deslocamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "desloc_select" ON public.project_deslocamentos;
DROP POLICY IF EXISTS "desloc_insert" ON public.project_deslocamentos;
DROP POLICY IF EXISTS "desloc_update" ON public.project_deslocamentos;
DROP POLICY IF EXISTS "desloc_delete" ON public.project_deslocamentos;
CREATE POLICY "desloc_select" ON public.project_deslocamentos
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "desloc_insert" ON public.project_deslocamentos
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "desloc_update" ON public.project_deslocamentos
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "desloc_delete" ON public.project_deslocamentos
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));

-- project_plano_divulgacao
ALTER TABLE public.project_plano_divulgacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "divulg_select" ON public.project_plano_divulgacao;
DROP POLICY IF EXISTS "divulg_insert" ON public.project_plano_divulgacao;
DROP POLICY IF EXISTS "divulg_update" ON public.project_plano_divulgacao;
DROP POLICY IF EXISTS "divulg_delete" ON public.project_plano_divulgacao;
CREATE POLICY "divulg_select" ON public.project_plano_divulgacao
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "divulg_insert" ON public.project_plano_divulgacao
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "divulg_update" ON public.project_plano_divulgacao
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "divulg_delete" ON public.project_plano_divulgacao
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));

-- project_dados_complementares
ALTER TABLE public.project_dados_complementares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "complem_select" ON public.project_dados_complementares;
DROP POLICY IF EXISTS "complem_insert" ON public.project_dados_complementares;
DROP POLICY IF EXISTS "complem_update" ON public.project_dados_complementares;
DROP POLICY IF EXISTS "complem_delete" ON public.project_dados_complementares;
CREATE POLICY "complem_select" ON public.project_dados_complementares
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "complem_insert" ON public.project_dados_complementares
  FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "complem_update" ON public.project_dados_complementares
  FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));
CREATE POLICY "complem_delete" ON public.project_dados_complementares
  FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE organization_id = public.current_user_org_id()));

-- ============================================================================
-- STORAGE — bucket 'salic-imports' (PDFs enviados pelo frontend)
-- ----------------------------------------------------------------------------
-- Cria o bucket (privado) caso ainda não exista. As policies de storage
-- seguem o mesmo padrão de migration_storage_rls.sql.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('salic-imports', 'salic-imports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "salic_imports_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "salic_imports_storage_select" ON storage.objects;
CREATE POLICY "salic_imports_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'salic-imports');
CREATE POLICY "salic_imports_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'salic-imports');
