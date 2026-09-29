-- ==============================================================
-- MIGRATION: Responsável SALIC (herança de credencial p/ analista)
-- ==============================================================
-- JÁ APLICADA em produção em 2026-09-28 (via Supabase CLI, arquivo
-- supabase/migrations/20260928120000_salic_credential_owner.sql).
-- Este arquivo espelha o conteúdo aplicado, no padrão migration_*.sql
-- da raiz do repo, para o histórico de mudanças ficar completo aqui.
--
-- Um analista pode usar a credencial SALIC de um admin/gestor da mesma
-- organização. A senha não é duplicada; guardamos somente o
-- responsável (organization_users.salic_credential_owner_id).
-- ==============================================================

ALTER TABLE public.organization_users
    ADD COLUMN IF NOT EXISTS salic_credential_owner_id uuid
    REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.documents
    ADD COLUMN IF NOT EXISTS salic_credential_owner_id uuid;

CREATE OR REPLACE FUNCTION public.validate_salic_credential_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE owner_role text;
BEGIN
    IF NEW.salic_credential_owner_id IS NULL THEN RETURN NEW; END IF;

    -- Permite que admin/gestor aponte para si mesmo na própria inserção.
    IF NEW.salic_credential_owner_id = NEW.user_id
       AND NEW.role IN ('admin', 'gestor') THEN
        RETURN NEW;
    END IF;

    SELECT role INTO owner_role
      FROM public.organization_users
     WHERE organization_id = NEW.organization_id
       AND user_id = NEW.salic_credential_owner_id;

    IF owner_role IS NULL THEN
        RAISE EXCEPTION 'Responsável SALIC não pertence à mesma organização';
    END IF;
    IF owner_role NOT IN ('admin', 'gestor') THEN
        RAISE EXCEPTION 'Responsável SALIC deve ser admin ou gestor';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_salic_credential_owner ON public.organization_users;
CREATE TRIGGER trg_validate_salic_credential_owner
BEFORE INSERT OR UPDATE OF organization_id, salic_credential_owner_id
ON public.organization_users
FOR EACH ROW EXECUTE FUNCTION public.validate_salic_credential_owner();

UPDATE public.organization_users
   SET salic_credential_owner_id = user_id
 WHERE role IN ('admin', 'gestor')
   AND salic_credential_owner_id IS NULL;

CREATE OR REPLACE FUNCTION public.has_external_credential(p_service_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.external_credentials ec
         WHERE ec.service_name = p_service_name AND ec.user_id = auth.uid()
    ) OR EXISTS (
        SELECT 1
          FROM public.organization_users analyst
          JOIN public.organization_users owner
            ON owner.organization_id = analyst.organization_id
           AND owner.user_id = analyst.salic_credential_owner_id
           AND owner.role IN ('admin', 'gestor')
          JOIN public.external_credentials ec
            ON ec.user_id = owner.user_id
           AND ec.service_name = p_service_name
         WHERE analyst.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.has_external_credential(text) FROM public;
GRANT EXECUTE ON FUNCTION public.has_external_credential(text) TO authenticated;
