-- SPEC-II09 — Exportações
-- Tabela para rastrear exportações geradas (CSV, Excel, ZIP, Auditoria).

CREATE TABLE IF NOT EXISTS public.exportacoes_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL
    CHECK (tipo IN ('csv','excel','zip','auditoria')),
  status          TEXT NOT NULL DEFAULT 'gerando'
    CHECK (status IN ('gerando','pronto','erro')),
  file_path       TEXT,
  gerado_por      UUID REFERENCES auth.users(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exportacoes_log_project_criado
  ON public.exportacoes_log (project_id, criado_em DESC);

ALTER TABLE public.exportacoes_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exportacoes_select" ON public.exportacoes_log;
CREATE POLICY "exportacoes_select" ON public.exportacoes_log
FOR SELECT TO authenticated
USING (project_id IN (
  SELECT id FROM public.projects WHERE user_id = auth.uid()
));

DROP POLICY IF EXISTS "exportacoes_insert" ON public.exportacoes_log;
CREATE POLICY "exportacoes_insert" ON public.exportacoes_log
FOR INSERT TO authenticated
WITH CHECK (project_id IN (
  SELECT id FROM public.projects WHERE user_id = auth.uid()
));

DROP POLICY IF EXISTS "exportacoes_update" ON public.exportacoes_log;
CREATE POLICY "exportacoes_update" ON public.exportacoes_log
FOR UPDATE TO authenticated
USING (project_id IN (
  SELECT id FROM public.projects WHERE user_id = auth.uid()
))
WITH CHECK (project_id IN (
  SELECT id FROM public.projects WHERE user_id = auth.uid()
));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.exportacoes_log;

-- Storage: bucket 'reports' SELECT (idempotente — já criada na sessão anterior)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can read reports'
  ) THEN
    CREATE POLICY "Authenticated users can read reports"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'reports');
  END IF;
END$$;
