-- ============================================================
-- migration_org.sql
-- S0 — Multi-tenant por Organização (CHG-09)
-- Idempotente. Pode ser executado múltiplas vezes com segurança.
-- ============================================================

-- ============================================================
-- 1. Estruturas base de organização (idempotente)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        TEXT NOT NULL,
    slug        TEXT UNIQUE,
    modulos     TEXT[] DEFAULT '{}',
    ativo       BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_users (
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 'admin' | 'membro' = papel NA org. NÃO confundir com app_metadata.role (gestor/analista/fornecedor)
    role            TEXT NOT NULL DEFAULT 'membro',
    created_at      TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);

-- Caso a tabela tenha sido criada previamente sem essas colunas (via Dashboard), garante o schema
ALTER TABLE public.organization_users ADD COLUMN IF NOT EXISTS role       TEXT NOT NULL DEFAULT 'membro';
ALTER TABLE public.organization_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
UPDATE public.organization_users SET created_at = now() WHERE created_at IS NULL;

ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_users ENABLE ROW LEVEL SECURITY;

-- Coluna organization_id nas tabelas de domínio (idempotente)
ALTER TABLE public.documents          ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.projects           ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.rubricas           ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.extratos             ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_org_id ON public.documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_id  ON public.projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_rubricas_org_id  ON public.rubricas(organization_id);
CREATE INDEX IF NOT EXISTS idx_extratos_org_id  ON public.extratos(organization_id);

-- ============================================================
-- 2. Helpers de org
-- ============================================================

CREATE OR REPLACE FUNCTION public.user_organization_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM public.organization_users WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata'  ->> 'org_id')::uuid,
    (auth.jwt() -> 'user_metadata' ->> 'org_id')::uuid
  );
$$;

CREATE OR REPLACE FUNCTION public.same_org(target_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.current_user_org_id() = target_org_id;
$$;

-- ============================================================
-- 3. RLS em organizations e organization_users
-- ============================================================

DROP POLICY IF EXISTS organizations_member_read ON public.organizations;
CREATE POLICY organizations_member_read ON public.organizations
  FOR SELECT
  USING (id IN (SELECT public.user_organization_ids()));

DROP POLICY IF EXISTS org_users_self_read ON public.organization_users;
CREATE POLICY org_users_self_read ON public.organization_users
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR organization_id IN (SELECT public.user_organization_ids())
  );

-- Permite o INSERT do bootstrap em handleRegister (cliente cria a própria linha após signUp)
DROP POLICY IF EXISTS org_users_self_insert ON public.organization_users;
CREATE POLICY org_users_self_insert ON public.organization_users
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 4. Trigger: copia role de user_metadata -> app_metadata no INSERT em auth.users
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_role_to_app_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role text;
BEGIN
  v_role := NEW.raw_user_meta_data ->> 'role';
  IF v_role IS NOT NULL THEN
    NEW.raw_app_meta_data :=
      coalesce(NEW.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', v_role);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_role_on_register ON auth.users;
CREATE TRIGGER sync_role_on_register
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_role_to_app_metadata();

-- ============================================================
-- 5. DROP policies legacy (nomes literais conforme setup.sql)
-- ============================================================

-- documents
DROP POLICY IF EXISTS "Gestor ve docs do projeto"            ON public.documents;
DROP POLICY IF EXISTS "Gestor acessa docs do projeto"        ON public.documents;
DROP POLICY IF EXISTS "Usuarios inserem documentos"          ON public.documents;
DROP POLICY IF EXISTS "Usuarios atualizam documentos"        ON public.documents;
DROP POLICY IF EXISTS "Usuarios deletam documentos"          ON public.documents;
DROP POLICY IF EXISTS documents_gestor_all                   ON public.documents;
DROP POLICY IF EXISTS documents_analista                     ON public.documents;
-- (Mantém: "Solicitante acessa seus proprios docs", "Solicitante insere doc")

-- projects
DROP POLICY IF EXISTS "Gestores inserem projetos"            ON public.projects;
DROP POLICY IF EXISTS "Gestores veem seus projetos"          ON public.projects;
DROP POLICY IF EXISTS "Gestores atualizam seus projetos"     ON public.projects;
DROP POLICY IF EXISTS "Gestores deletam seus projetos"       ON public.projects;
-- (Mantém: "Fornecedor ve projetos convidado")

-- ============================================================
-- 6. Policies novas org-aware
-- ============================================================

-- documents
DROP POLICY IF EXISTS documents_gestor_org           ON public.documents;
CREATE POLICY documents_gestor_org ON public.documents
  FOR ALL
  USING      (public.has_role('gestor')   AND organization_id = public.current_user_org_id())
  WITH CHECK (public.has_role('gestor')   AND organization_id = public.current_user_org_id());

DROP POLICY IF EXISTS documents_analista_org        ON public.documents;
CREATE POLICY documents_analista_org ON public.documents
  FOR ALL
  USING      (public.has_role('analista') AND auth.uid() = user_id AND organization_id = public.current_user_org_id())
  WITH CHECK (public.has_role('analista') AND auth.uid() = user_id AND organization_id = public.current_user_org_id());

-- Compat: gestor que é dono do projeto também acessa, sempre dentro da org
DROP POLICY IF EXISTS documents_gestor_projeto_org  ON public.documents;
CREATE POLICY documents_gestor_projeto_org ON public.documents
  FOR ALL
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE user_id = auth.uid()
        AND organization_id = public.current_user_org_id()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT id FROM public.projects
      WHERE user_id = auth.uid()
        AND organization_id = public.current_user_org_id()
    )
  );

-- projects
DROP POLICY IF EXISTS projects_select_org ON public.projects;
CREATE POLICY projects_select_org ON public.projects
  FOR SELECT USING (organization_id = public.current_user_org_id());

DROP POLICY IF EXISTS projects_insert_org ON public.projects;
CREATE POLICY projects_insert_org ON public.projects
  FOR INSERT WITH CHECK (organization_id = public.current_user_org_id());

DROP POLICY IF EXISTS projects_update_org ON public.projects;
CREATE POLICY projects_update_org ON public.projects
  FOR UPDATE
  USING      (auth.uid() = user_id AND organization_id = public.current_user_org_id())
  WITH CHECK (auth.uid() = user_id AND organization_id = public.current_user_org_id());

DROP POLICY IF EXISTS projects_delete_org ON public.projects;
CREATE POLICY projects_delete_org ON public.projects
  FOR DELETE
  USING (auth.uid() = user_id AND organization_id = public.current_user_org_id());
