-- ================================================
-- FIX FINAL: Políticas completas para physical_evidences
-- Roda uma vez no SQL Editor do Supabase
-- ================================================

-- 1. Limpar todas as políticas anteriores
DROP POLICY IF EXISTS "evidences_select" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow view own or org evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow view own, org or project owner evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow authenticated insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Fornecedores can insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow org admins update evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Org members can update evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Allow delete own pending evidences" ON public.physical_evidences;

-- 2. Garantir RLS ativo
ALTER TABLE public.physical_evidences ENABLE ROW LEVEL SECURITY;

-- 3. SELECT: Eu enviei OU sou dono do projeto
CREATE POLICY "evidences_select"
ON public.physical_evidences FOR SELECT
TO authenticated
USING (
  enviado_por = auth.uid()
  OR project_id IN (
    SELECT id FROM public.projects WHERE user_id = auth.uid()
  )
);

-- 4. INSERT: Qualquer autenticado pode inserir se se identificar
CREATE POLICY "evidences_insert"
ON public.physical_evidences FOR INSERT
TO authenticated
WITH CHECK (enviado_por = auth.uid());

-- 5. UPDATE: Dono do projeto pode aprovar/reprovar
CREATE POLICY "evidences_update"
ON public.physical_evidences FOR UPDATE
TO authenticated
USING (
  project_id IN (
    SELECT id FROM public.projects WHERE user_id = auth.uid()
  )
);

-- 6. DELETE: Quem enviou pode deletar se pendente
CREATE POLICY "evidences_delete"
ON public.physical_evidences FOR DELETE
TO authenticated
USING (
  enviado_por = auth.uid()
  AND status_validacao = 'pendente'
);
