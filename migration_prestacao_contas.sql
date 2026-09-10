-- ================================================
-- PRESTAÇÃO DE CONTAS - SCHEMA SETUP
-- Tabelas necessárias para o módulo de Prestação de Contas
-- ================================================

-- 1. Garantir que as colunas existam em projects
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS status_prestacao text DEFAULT 'em_execucao' CHECK (status_prestacao IN ('em_execucao', 'em_encerramento', 'enviado_minc', 'aprovado')),
ADD COLUMN IF NOT EXISTS checklist_liberado boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS data_envio_minc timestamp with time zone;

-- 2. Tabela project_checklist (Se não existir no setup inicial)
CREATE TABLE IF NOT EXISTS public.project_checklist (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  liberado_envio_minc boolean DEFAULT false,
  criado_em timestamp with time zone DEFAULT now(),
  CONSTRAINT project_checklist_pkey PRIMARY KEY (id),
  CONSTRAINT project_checklist_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);

-- RLS para project_checklist
ALTER TABLE public.project_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_checklist_all" ON public.project_checklist;
CREATE POLICY "project_checklist_all" ON public.project_checklist
FOR ALL TO authenticated
USING (
  project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
);


-- 3. Tabela relatorio_prestacao_contas
CREATE TABLE IF NOT EXISTS public.relatorio_prestacao_contas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  versao integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'gerando' CHECK (status IN ('gerando', 'pronto', 'autorizado', 'substituido', 'erro')),
  file_path text,
  gerado_por uuid NOT NULL,
  autorizado_por uuid,
  data_autorizacao timestamp with time zone,
  criado_em timestamp with time zone DEFAULT now(),
  CONSTRAINT relatorio_prestacao_contas_pkey PRIMARY KEY (id),
  CONSTRAINT relatorio_prestacao_contas_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT relatorio_prestacao_contas_gerado_por_fkey FOREIGN KEY (gerado_por) REFERENCES auth.users(id),
  CONSTRAINT relatorio_prestacao_contas_autorizado_por_fkey FOREIGN KEY (autorizado_por) REFERENCES auth.users(id)
);

-- RLS para relatorio_prestacao_contas
ALTER TABLE public.relatorio_prestacao_contas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relatorio_prestacao_contas_all" ON public.relatorio_prestacao_contas;
CREATE POLICY "relatorio_prestacao_contas_all" ON public.relatorio_prestacao_contas
FOR ALL TO authenticated
USING (
  project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
);
