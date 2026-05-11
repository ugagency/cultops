-- ============================================================
-- migration_perfis_role.sql
-- S1-B: Helpers de role + policies RLS diferenciadas por perfil
-- ============================================================

-- 1. Helpers de leitura de role
-- Lê app_metadata (escrita só por service_role) e cai em user_metadata por compat.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role'
  )::text;
$$;

CREATE OR REPLACE FUNCTION public.has_role(required text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.current_user_role() = required;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(VARIADIC required text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.current_user_role() = ANY(required);
$$;

-- 2. Policies por role em `documents`
-- Mantemos as policies existentes (setup.sql:177-186); estas são adicionais (OR).
-- Coluna real de owner em documents é `user_id` (setup.sql:23), não `uploaded_by`.

DROP POLICY IF EXISTS documents_gestor_all ON public.documents;
CREATE POLICY documents_gestor_all ON public.documents
  FOR ALL
  USING (public.has_role('gestor'))
  WITH CHECK (public.has_role('gestor'));

DROP POLICY IF EXISTS documents_analista ON public.documents;
CREATE POLICY documents_analista ON public.documents
  FOR ALL
  USING (public.has_role('analista') AND auth.uid() = user_id)
  WITH CHECK (public.has_role('analista') AND auth.uid() = user_id);

-- 3. Policy auxiliar em audit_log para que o gestor leia mudanças de role
-- (a policy existente em migration_fase2.sql:188-196 filtra por owner do projeto,
-- então logs de tabela='auth.users' não seriam visíveis sem isto).
DROP POLICY IF EXISTS audit_log_gestor_role_changes ON public.audit_log;
CREATE POLICY audit_log_gestor_role_changes ON public.audit_log
  FOR SELECT
  USING (public.has_role('gestor') AND tabela = 'auth.users');
