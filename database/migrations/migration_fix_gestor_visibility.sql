-- ================================================
-- Migration: Corrigir visibilidade do Gestor nas evidências físicas
-- Problema: Gestores não conseguem ver evidências enviadas se o organization_id estiver nulo
-- ================================================

-- 1. Atualizar registros existentes que estão sem organization_id
-- Buscamos o organization_id da tabela de projetos
UPDATE public.physical_evidences ev
SET organization_id = p.organization_id
FROM public.projects p
WHERE ev.project_id = p.id
AND ev.organization_id IS NULL;

-- 2. Melhorar a política de visualização (SELECT)
-- Agora permite ver se:
--   - Foi quem enviou
--   - OU se pertence à sua organização (via organization_id)
--   - OU se é o gestor responsável pelo projeto (via projects.user_id)
DROP POLICY IF EXISTS "Allow view own or org evidences" ON public.physical_evidences;

CREATE POLICY "Allow view own, org or project owner evidences"
ON public.physical_evidences FOR SELECT
TO authenticated
USING (
  enviado_por = auth.uid()
  OR organization_id IN (
    SELECT ou.organization_id FROM public.organization_users ou
    WHERE ou.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = physical_evidences.project_id
    AND p.user_id = auth.uid()
  )
);

-- 3. Garantir que uploads via portal do solicitante (app.js) ou gestor sempre tenham o ID do usuário
-- (A policy de INSERT já exige enviado_por = auth.uid())
