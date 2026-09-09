-- ================================================
-- RODAR AGORA NO SQL EDITOR DO SUPABASE
-- Fix definitivo para aprovação de evidências
-- ================================================

-- 1. Limpar TODAS as políticas da tabela
DROP POLICY IF EXISTS "evidences_select" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_insert" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_update" ON public.physical_evidences;
DROP POLICY IF EXISTS "evidences_delete" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow view own or org evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow authenticated insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow org admins update evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Org members can update evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow delete own pending evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Fornecedores can insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Users can view own evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow view own, org or project owner evidences" ON public.physical_evidences;

-- 2. RLS ativo
ALTER TABLE public.physical_evidences ENABLE ROW LEVEL SECURITY;

-- 3. SELECT: Eu enviei OU sou dono do projeto vinculado
CREATE POLICY "evidences_select"
ON public.physical_evidences FOR SELECT
TO authenticated
USING (
  enviado_por = auth.uid()
  OR project_id IN (
    SELECT id FROM public.projects WHERE user_id = auth.uid()
  )
);

-- 4. INSERT: Qualquer autenticado que se identifique
CREATE POLICY "evidences_insert"
ON public.physical_evidences FOR INSERT
TO authenticated
WITH CHECK (enviado_por = auth.uid());

-- 5. UPDATE: Dono do projeto pode aprovar/reprovar QUALQUER evidência do projeto
--    (independente de quem enviou ou do organization_id)
CREATE POLICY "evidences_update"
ON public.physical_evidences FOR UPDATE
TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects WHERE user_id = auth.uid()
  )
);

-- 6. DELETE: Quem enviou pode deletar se ainda pendente
CREATE POLICY "evidences_delete"
ON public.physical_evidences FOR DELETE
TO authenticated
USING (
  enviado_por = auth.uid()
  AND status_validacao = 'pendente'
);

-- VERIFICAÇÃO: Rodar após o script para conferir
SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'physical_evidences';
