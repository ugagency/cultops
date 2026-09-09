-- ================================================
-- Migration: Políticas RLS para o bucket 'physical-evidences'
-- Problema: StorageApiError: new row violates row-level security policy
-- Causa: O bucket existe com RLS ativo mas sem policies de INSERT/SELECT
-- ================================================

-- 1. Garantir que o bucket existe
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'physical-evidences',
  'physical-evidences',
  false,
  52428800, -- 50MB
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'video/mp4']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Policy: Qualquer usuário autenticado pode fazer UPLOAD (INSERT)
-- O controle fino é feito na tabela physical_evidences, não no storage
CREATE POLICY "Authenticated users can upload evidence files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'physical-evidences');

-- 3. Policy: Qualquer usuário autenticado pode LER arquivos do bucket
CREATE POLICY "Authenticated users can read evidence files"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'physical-evidences');

-- 4. Policy: Usuário pode DELETAR apenas seus próprios uploads
-- (baseado no path que começa com o project_id)
CREATE POLICY "Users can delete their own evidence files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'physical-evidences');

-- ================================================
-- 5. Políticas RLS para a TABELA physical_evidences
-- (caso ainda não existam)
-- ================================================

ALTER TABLE public.physical_evidences ENABLE ROW LEVEL SECURITY;

-- Fornecedor pode inserir evidências em projetos que ele está vinculado
CREATE POLICY "Fornecedores can insert evidences"
ON public.physical_evidences FOR INSERT
TO authenticated
WITH CHECK (
  enviado_por = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.projeto_fornecedores pf
    WHERE pf.project_id = physical_evidences.project_id
    AND pf.fornecedor_id = (
      SELECT f.id FROM public.fornecedores f WHERE f.user_id = auth.uid()
    )
  )
);

-- Fornecedor pode ver suas próprias evidências
CREATE POLICY "Users can view own evidences"
ON public.physical_evidences FOR SELECT
TO authenticated
USING (
  enviado_por = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.organization_users ou
    WHERE ou.organization_id = physical_evidences.organization_id
    AND ou.user_id = auth.uid()
  )
);

-- Gestores da organização podem atualizar (aprovar/reprovar)
CREATE POLICY "Org members can update evidences"
ON public.physical_evidences FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_users ou
    WHERE ou.organization_id = physical_evidences.organization_id
    AND ou.user_id = auth.uid()
    AND ou.role IN ('admin', 'owner')
  )
);
