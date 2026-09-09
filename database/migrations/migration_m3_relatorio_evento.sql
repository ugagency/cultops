-- ================================================
-- SPEC-III-01 — Relatório de Evento + Relatório Mensal Consolidado (M3)
-- ================================================

-- 1. Colunas de relatório em distribution_events (Seção 2 do relatório)
ALTER TABLE public.distribution_events
  ADD COLUMN IF NOT EXISTS resumo_evento text,
  ADD COLUMN IF NOT EXISTS quantitativo_atividades text,
  ADD COLUMN IF NOT EXISTS publico_por_dia jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS perfil_publico text,
  ADD COLUMN IF NOT EXISTS acoes_acessibilidade text,
  ADD COLUMN IF NOT EXISTS numero_fornecedores text,
  ADD COLUMN IF NOT EXISTS empregos_gerados text,
  ADD COLUMN IF NOT EXISTS acoes_ambientais text,
  ADD COLUMN IF NOT EXISTS desafios_evento text,
  ADD COLUMN IF NOT EXISTS relatorio_status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS relatorio_evento_file_path text,
  ADD COLUMN IF NOT EXISTS relatorio_evento_gerado_em timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'distribution_events'
      AND con.conname = 'distribution_events_relatorio_status_check'
  ) THEN
    ALTER TABLE public.distribution_events
      ADD CONSTRAINT distribution_events_relatorio_status_check
      CHECK (relatorio_status = ANY (ARRAY['pendente'::text, 'preenchido'::text, 'gerado'::text]));
  END IF;
END $$;

COMMENT ON COLUMN public.distribution_events.publico_por_dia IS
  'Array de objetos por dia do evento. Formato:
   [{"data":"2026-05-16","disponibilizado":2500,"retirado":598,"presente":356}, ...].
   Eventos de 1 dia só têm 1 item no array.';

-- 2. Tabela distribution_monthly_reports (Seções 1,3,4,5,6 do relatório)
CREATE TABLE IF NOT EXISTS public.distribution_monthly_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  mes_referencia date NOT NULL,

  especialista_nome text,
  especialista_funcao text,

  desafios_periodo text,
  gerenciamento_equipe text,

  comunicacao_seguidores_total integer,
  comunicacao_novos_seguidores integer,
  comunicacao_interacoes integer,
  comunicacao_visualizacoes integer,
  comunicacao_alcance integer,
  comunicacao_materias_qtd integer,
  comunicacao_materias_positivas_pct numeric(5,2),
  comunicacao_retorno_midia_valor numeric(12,2),

  custos_por_evento jsonb DEFAULT '[]'::jsonb,

  assinatura_cidade_data text,
  assinatura_nome text,
  assinatura_cargo text,
  assinatura_local_projeto text,

  relatorio_file_path text,
  relatorio_gerado_em timestamp with time zone,

  status text NOT NULL DEFAULT 'rascunho',
  criado_por uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT distribution_monthly_reports_pkey PRIMARY KEY (id),
  CONSTRAINT distribution_monthly_reports_status_check
    CHECK (status = ANY (ARRAY['rascunho'::text, 'finalizado'::text])),
  CONSTRAINT distribution_monthly_reports_unique_periodo
    UNIQUE (project_id, mes_referencia)
);

COMMENT ON COLUMN public.distribution_monthly_reports.custos_por_evento IS
  'Array de custos manuais por evento do período. Formato:
   [{"event_id":"uuid","nome_evento":"...","valor":47831.00}, ...].';

CREATE INDEX IF NOT EXISTS idx_distribution_monthly_reports_project
  ON public.distribution_monthly_reports(project_id);

ALTER TABLE public.distribution_monthly_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monthly_reports_select" ON public.distribution_monthly_reports;
CREATE POLICY "monthly_reports_select" ON public.distribution_monthly_reports
FOR SELECT TO authenticated
USING (organization_id = public.current_user_org_id());

DROP POLICY IF EXISTS "monthly_reports_insert" ON public.distribution_monthly_reports;
CREATE POLICY "monthly_reports_insert" ON public.distribution_monthly_reports
FOR INSERT TO authenticated
WITH CHECK (organization_id = public.current_user_org_id());

DROP POLICY IF EXISTS "monthly_reports_update" ON public.distribution_monthly_reports;
CREATE POLICY "monthly_reports_update" ON public.distribution_monthly_reports
FOR UPDATE TO authenticated
USING (organization_id = public.current_user_org_id());

-- 3. Verificação
SELECT column_name FROM information_schema.columns
WHERE table_name = 'distribution_events'
  AND column_name IN ('resumo_evento', 'publico_por_dia', 'relatorio_status',
                       'relatorio_evento_file_path', 'relatorio_evento_gerado_em');

SELECT table_name FROM information_schema.tables
WHERE table_name = 'distribution_monthly_reports';

SELECT tablename, policyname FROM pg_policies
WHERE tablename = 'distribution_monthly_reports';
