-- ═══════════════════════════════════════════════════════════════════
-- migration_documents_rls.sql
--
-- Habilita RLS na tabela documents e alinha as policies ao padrão
-- multi-tenant do M1 (migration_m2_rls_align_m1.sql):
--   organization_id = public.current_user_org_id()  → gestores/analistas
--   user_id = auth.uid()                            → solicitantes (fornecedores)
--
-- INVARIANTES respeitados:
--   INV-01  organization_id preenchido antes das policies (backfill abaixo)
--   INV-02  org_id vem do JWT app_metadata.org_id
--   INV-04  usuário pertence a UMA organização
--   INV-05  gestor nunca vê dados de outra org
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.
-- ═══════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────
-- 1. BACKFILL — garante organization_id nos registros antigos
--    que o M1 inseriu com organization_id NULL
-- ───────────────────────────────────────────────────────────────────
UPDATE public.documents d
SET organization_id = p.organization_id
FROM public.projects p
WHERE d.project_id = p.id
  AND d.organization_id IS NULL;


-- ───────────────────────────────────────────────────────────────────
-- 2. ÍNDICE — melhora performance das policies via organization_id
-- ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_org_id
  ON public.documents(organization_id);

CREATE INDEX IF NOT EXISTS idx_documents_project_id
  ON public.documents(project_id);


-- ───────────────────────────────────────────────────────────────────
-- 3. HABILITAR RLS
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;


-- ───────────────────────────────────────────────────────────────────
-- 4. LIMPAR POLICIES ANTIGAS (idempotência)
-- ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "documents_select"                   ON public.documents;
DROP POLICY IF EXISTS "documents_insert"                   ON public.documents;
DROP POLICY IF EXISTS "documents_update"                   ON public.documents;
DROP POLICY IF EXISTS "documents_delete"                   ON public.documents;
DROP POLICY IF EXISTS "Users can view own documents"       ON public.documents;
DROP POLICY IF EXISTS "Users can insert documents"         ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents"     ON public.documents;
DROP POLICY IF EXISTS "Allow authenticated insert"         ON public.documents;
DROP POLICY IF EXISTS "Allow view own documents"           ON public.documents;


-- ───────────────────────────────────────────────────────────────────
-- 5. POLICIES
-- ───────────────────────────────────────────────────────────────────

-- SELECT
--   Gestores/analistas: vêem todos os documentos da organização
--   Solicitantes (fornecedores): vêem apenas os seus próprios docs
CREATE POLICY "documents_select" ON public.documents
FOR SELECT TO authenticated
USING (
  organization_id = public.current_user_org_id()
  OR user_id = auth.uid()
);

-- INSERT
--   Qualquer autenticado pode inserir, desde que seja o próprio user_id
CREATE POLICY "documents_insert" ON public.documents
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE
--   Apenas gestores e analistas da mesma org (ex: alterar status, protocolo SALIC)
CREATE POLICY "documents_update" ON public.documents
FOR UPDATE TO authenticated
USING (
  organization_id = public.current_user_org_id()
  AND public.has_any_role('gestor', 'analista')
);

-- DELETE
--   Apenas gestores (operação destrutiva)
CREATE POLICY "documents_delete" ON public.documents
FOR DELETE TO authenticated
USING (
  organization_id = public.current_user_org_id()
  AND public.has_role('gestor')
);


-- ───────────────────────────────────────────────────────────────────
-- 6. VERIFICAÇÃO FINAL
-- ───────────────────────────────────────────────────────────────────
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'documents'
ORDER BY cmd;
