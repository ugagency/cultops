-- ================================================
-- FIX: RLS da tabela physical_evidences
-- Erro: 42501 - new row violates row-level security policy
-- ================================================

-- 1. Remover políticas existentes que podem estar conflitando
DROP POLICY IF EXISTS "Fornecedores can insert evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Users can view own evidences" ON public.physical_evidences;
DROP POLICY IF EXISTS "Org members can update evidences" ON public.physical_evidences;

-- 2. Garantir que RLS está ativo
ALTER TABLE public.physical_evidences ENABLE ROW LEVEL SECURITY;

-- 3. INSERT: Qualquer usuário autenticado pode inserir,
--    desde que se identifique como o remetente (enviado_por = auth.uid())
CREATE POLICY "Allow authenticated insert evidences"
ON public.physical_evidences FOR INSERT
TO authenticated
WITH CHECK (enviado_por = auth.uid());

-- 4. SELECT: Usuário pode ver evidências que ele enviou
--    OU que pertencem à sua organização
CREATE POLICY "Allow view own or org evidences"
ON public.physical_evidences FOR SELECT
TO authenticated
USING (
  enviado_por = auth.uid()
  OR organization_id IN (
    SELECT ou.organization_id FROM public.organization_users ou
    WHERE ou.user_id = auth.uid()
  )
);

-- 5. UPDATE: Membros admin/owner da organização podem aprovar/reprovar
CREATE POLICY "Allow org admins update evidences"
ON public.physical_evidences FOR UPDATE
TO authenticated
USING (
  organization_id IN (
    SELECT ou.organization_id FROM public.organization_users ou
    WHERE ou.user_id = auth.uid()
    AND ou.role IN ('admin', 'owner')
  )
);

-- 6. DELETE: Apenas quem enviou pode deletar (se ainda pendente)
CREATE POLICY "Allow delete own pending evidences"
ON public.physical_evidences FOR DELETE
TO authenticated
USING (
  enviado_por = auth.uid()
  AND status_validacao = 'pendente'
);
